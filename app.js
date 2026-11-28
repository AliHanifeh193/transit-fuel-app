"use strict";

const STORAGE_CURRENT_KEY = "transit_fuel_app_current_v5";
const STORAGE_ARCHIVE_KEY = "transit_fuel_app_archive_v5";

const CURRENCY_LABELS = {
  IRT: "تومان",
  TRY: "لیر",
  USD: "دلار",
  EUR: "یورو",
  AZN: "مانات"
};

let deferredInstallPrompt = null;
let pendingReceiptDataUrl = "";
let pendingReceiptName = "";
let receiptGeneration = 0;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById("installHintText").textContent =
    "امکان نصب مستقیم روی دستگاه آماده است. دکمه «نصب روی گوشی» را بزنید.";
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  const hint = document.getElementById("installHintText");
  if (hint) {
    hint.textContent = "اپلیکیشن با موفقیت روی دستگاه نصب شد.";
  }
  if (typeof showToast === "function") {
    showToast("اپلیکیشن نصب شد");
  }
});

function triggerInstallPrompt() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then((choiceResult) => {
      if (choiceResult && choiceResult.outcome === "accepted" && typeof showToast === "function") {
        showToast("نصب برنامه آغاز شد");
      }
      deferredInstallPrompt = null;
    }).catch(() => {
      deferredInstallPrompt = null;
      openInstallGuideModal();
    });
  } else {
    if (typeof showToast === "function") {
      showToast("در صورت عدم نمایش پنجره نصب، از منوی مرورگر گزینه نصب را بزنید");
    }
    openInstallGuideModal();
  }
}

function openInstallGuideModal() {
  document.getElementById("installGuideModal").classList.add("open");
}

function closeInstallGuideModal() {
  document.getElementById("installGuideModal").classList.remove("open");
}


function localTripDate(now) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function newTripDates(now = new Date()) {
  return {tripDate: localTripDate(now), createdAt: now.toISOString()};
}

function getDefaultState(dates = newTripDates()) {
  return {
    tripTitle: "نمونه آموزشی: بازرگان ➔ مرسین ➔ رازی",
    plateNo: "نمونه آموزشی",
    ...dates,
    initialFuel: 1240,
    companyQuota: 1100,
    extraOutboundFuel: 20,
    extraReturnFuel: 0,
    fuelSellPriceTry: 55,
    outboundKm: 1220,
    outboundWeight: 23,
    outboundRate: 34,
    returnKm: 1100,
    returnWeight: 24,
    returnRate: 35,
    emptyKm: 60,
    emptyRate: 24,
    idleFuel: 17,
    rates: {
      IRT: 1,
      TRY: 5300,
      USD: 195000,
      EUR: 210000,
      AZN: 115000
    },
    borderFuelItems: [],
    tripExpenses: []
  };
}

let state = getDefaultState();
let archiveEntries = [];
let feedbackEntries = [];
let storageReady = false;
let editedArchiveId = null;
const FEEDBACK_STORAGE_KEY = "transit_fuel_user_feedbacks_v1";


function normalizeDraft(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Invalid draft");
  const defaults = getDefaultState({tripDate: "", createdAt: null});
  const draft = {...defaults, ...data, rates: {...defaults.rates, ...data.rates}};
  for (const key of ["borderFuelItems", "tripExpenses"]) {
    if (!Array.isArray(draft[key]) || draft[key].some(item => !item || typeof item !== "object")) {
      throw Error("Invalid records: " + key);
    }
  }
  return draft;
}

function loadCurrentState() {
  const raw = localStorage.getItem(STORAGE_CURRENT_KEY);
  return raw === null ? getDefaultState() : normalizeDraft(JSON.parse(raw));
}

function migrateArchive() {
  return readLegacyList(STORAGE_ARCHIVE_KEY).map(entry => {
    if (typeof entry?.archiveId !== "string") throw Error("Invalid archived trip");
    return {...entry, data: normalizeDraft(entry.data)};
  });
}

function readLegacyList(key) {
  const raw = localStorage.getItem(key);
  const value = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(value)) throw Error("Invalid legacy list");
  return value;
}

function loadArchive() {
  return structuredClone(archiveEntries);
}

async function saveArchive(list, changes = {}) {
  await TransitStorage.save({archive: list, ...changes});
  archiveEntries = list;
  updateArchiveCountBadge();
}

function storageError(error) {
  console.error(error);
  document.getElementById("storageStatus").textContent =
    "ذخیره یا بازیابی انجام نشد. پیش از بستن صفحه، پشتیبان بگیرید و وضعیت حافظه را بررسی کنید.";
}

function backupPayload() {
  return {format: "transit-fuel-backup", version: 1, draft: state, archive: archiveEntries, feedback: feedbackEntries, editedArchiveId};
}

function exportWorkspace() {
  const file = new Blob([JSON.stringify(backupPayload(), null, 2)], {type: "application/json"});
  shareOrDownloadFile(file, "transit-fuel-backup.json");
}

function validateDraft(draft) {
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  if (!object(draft) || !object(draft.rates) || typeof draft.tripTitle !== "string"
      || TransitCalc.fields.some(field => typeof draft[field] !== "number" || !Number.isFinite(draft[field]))
      || !Array.isArray(draft.borderFuelItems) || !Array.isArray(draft.tripExpenses)) return false;
  return [...draft.borderFuelItems, ...draft.tripExpenses].every(item =>
    object(item) && typeof item.id === "string" && Number.isFinite(Number(item.amount))
    && TransitCalc.currencies.includes(item.currency) && (!item.receiptImage || validReceipt(item.receiptImage)));
}

async function restoreWorkspace(input) {
  if (!storageReady || workspaceBusy || !input.files[0]) return;
  workspaceBusy = true;
  try {
    const backup = JSON.parse(await input.files[0].text());
    if (backup.format !== "transit-fuel-backup" || backup.version !== 1
      || !validateDraft(backup.draft) || !Array.isArray(backup.archive)
      || !backup.archive.every(entry => entry && typeof entry.archiveId === "string" && validateDraft(entry.data))
      || new Set(backup.archive.map(entry => entry.archiveId)).size !== backup.archive.length
      || !Array.isArray(backup.feedback) || !backup.feedback.every(entry => entry && typeof entry.id === "string")) {
      throw Error("Invalid backup");
    }
    if (!confirmLocalized("بازیابی، اطلاعات این دستگاه را جایگزین می‌کند. ابتدا از داده‌های فعلی پشتیبان بگیرید. ادامه می‌دهید؟")) return;
    await TransitStorage.save({draft: backup.draft, archive: backup.archive, feedback: backup.feedback, editedArchiveId: backup.editedArchiveId || null});
    applyWorkspace(backup);
    showToast("پشتیبان بازیابی شد");
  } catch (error) {
    storageError(error);
  } finally {
    workspaceBusy = false;
    input.value = "";
  }
}

function applyWorkspace(record) {
  state = record.draft;
  archiveEntries = record.archive;
  feedbackEntries = record.feedback;
  editedArchiveId = archiveEntries.some(entry => entry.archiveId === record.editedArchiveId) ? record.editedArchiveId : null;
  editingTarget = null;
  clearPendingReceipt();
  populateFormFromState();
  updateArchiveCountBadge();
  renderAll();
  renderUserFeedbacks();
}

async function initializeWorkspace() {
  try {
    const record = await TransitStorage.open(() => ({
      draft: loadCurrentState(), archive: migrateArchive(),
      feedback: readLegacyList(FEEDBACK_STORAGE_KEY)
    }));
    storageReady = true;
    applyWorkspace(record);
    document.dispatchEvent(new CustomEvent("transit-storage-ready", {detail: record.company || {}}));
  } catch (error) {
    storageError(error);
  }
}

function updateArchiveCountBadge() {
  document.getElementById("archiveCountBadge").textContent = toPersianDigits(archiveEntries.length);
}

function toPersianDigits(val) {
  return window.TransitI18n?.digits(val) ?? String(val).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

function formatNum(num, decimals = 2) {
  const n = Number(num) || 0;
  const fixed = Number.isInteger(n) && decimals === 0
    ? n.toString()
    : n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
  return toPersianDigits(fixed);
}

function formatToman(amount) {
  return formatNum(Math.round(Number(amount) || 0), 0) + " " + (window.TransitI18n?.t("تومان") || "تومان");
}

function convertToToman(amount, currency) {
  return TransitCalc.convert(state, amount, currency);
}

// Date presentation follows the selected UI language. Stored ISO timestamps are unchanged.
const displayLocale = ({fa:"fa-IR",en:"en-GB",tr:"tr-TR",ar:"ar-EG"})[window.TransitI18n?.language || "fa"] || "fa-IR";
const persianTimestamp = new Intl.DateTimeFormat(displayLocale, {
  dateStyle: "medium", timeStyle: "medium"
});
const persianTripDate = new Intl.DateTimeFormat(displayLocale, {
  dateStyle: "medium", timeZone: "UTC"
});

function formatTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value || "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? persianTimestamp.format(date) : value;
}

function formatTripDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "";
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? persianTripDate.format(date) : value;
}

let editingTarget = null;

function applyEditedRecordIfAny(type, newItem) {
  if (!editingTarget || editingTarget.type !== type) return false;
  const arr = type === "border" ? state.borderFuelItems : type === "expense" ? state.tripExpenses : null;
  if (!Array.isArray(arr) || !arr[editingTarget.index]) {
    editingTarget = null;
    return false;
  }
  const oldItem = arr[editingTarget.index];
  arr[editingTarget.index] = {
    ...oldItem,
    ...newItem,
    id: oldItem.id,
    createdAt: oldItem.createdAt,
    updatedAt: new Date().toISOString()
  };
  editingTarget = null;
  persistCurrentState();
  renderAll();
  showToast("آیتم با موفقیت ویرایش شد");
  return true;
}

function editRecordByType(type, index) {
  if (type === "border" && Array.isArray(state.borderFuelItems) && state.borderFuelItems[index]) {
    const it = state.borderFuelItems[index];
    editingTarget = { type, index };
    if (document.getElementById("bfZone")) document.getElementById("bfZone").value = it.zone || "exit";
    if (document.getElementById("bfType")) document.getElementById("bfType").value = it.type || "official";
    if (document.getElementById("bfBorderName")) document.getElementById("bfBorderName").value = it.borderName || "";
    if (document.getElementById("bfLiters")) document.getElementById("bfLiters").value = it.liters || "";
    if (document.getElementById("bfAmount")) document.getElementById("bfAmount").value = it.amount || "";
    if (document.getElementById("bfCurrency")) document.getElementById("bfCurrency").value = it.currency || "IRT";
    showToast("مورد سوخت مرزی در فرم قرار گرفت؛ پس از اصلاح ثبت کنید");
  } else if (type === "expense" && Array.isArray(state.tripExpenses) && state.tripExpenses[index]) {
    const it = state.tripExpenses[index];
    editingTarget = { type, index };
    clearPendingReceipt();
    if (document.getElementById("expScope")) document.getElementById("expScope").value = it.scope || "INSIDE_IRAN";
    if (document.getElementById("expTitle")) document.getElementById("expTitle").value = it.title || "";
    if (document.getElementById("expAmount")) document.getElementById("expAmount").value = it.amount || "";
    if (document.getElementById("expCurrency")) document.getElementById("expCurrency").value = it.currency || "IRT";
    showToast("مورد هزینه در فرم قرار گرفت؛ پس از اصلاح ثبت کنید");
  }
}

function cancelEditMode() {
  editingTarget = null;
  showToast("حالت ویرایش لغو شد");
}



function getCurrencyRateToToman(currency) {
  return TransitCalc.rate(state, currency);
}

function toTomanAmount(amount, currency) {
  return convertToToman(amount, currency);
}

function updateApprovalAndPayoutBanner(metrics) {
  const netToman = metrics.netPayoutToman;
  const tripNo = (state && state.tripNumber) ? state.tripNumber : "---";
  const status = state.approvalStatus ? "سابقه محلی: " + state.approvalStatus : "پیش‌نویس محلی";
  const approver = (state && state.approvedBy) ? " | تأییدکننده: " + state.approvedBy : "";
  const appDate = (state && state.approvedAt) ? " | تاریخ: " + formatTimestamp(state.approvedAt) : "";
  const note = (state && state.approvalNote) ? " | یادداشت: " + state.approvalNote : "";

  const badge = document.getElementById("approvalBadge");
  if (badge) badge.textContent = status;

  const banner = document.getElementById("driverNetPayoutBanner");
  if (banner) {
    const formattedNet = typeof formatToman === "function" ? formatToman(netToman) : String(Math.round(netToman)) + " تومان";
    banner.innerHTML =
      "<strong>خالص دریافتی سفر شماره " + escapeHtml(tripNo) + ":</strong> " +
      "<span style='color:#34d399; font-weight:800;'>" + formattedNet + "</span>" +
      " — وضعیت: <strong>" + escapeHtml(status) + "</strong>" +
      escapeHtml(approver + appDate + note);
  }
}

function askDriverPrivateDataPermission() {
  const cb = document.getElementById("hidePrivateDriverData");
  const currentlyHidden = cb?.checked !== false;
  if (!currentlyHidden) {
    return true;
  }
  const allowPrivate = confirmLocalized(
    "آیا مایل هستید بخش‌های خصوصی راننده (مقدار اضافه سوخت و درآمد / سهم از فروش) در گزارش ارسالی گنجانده شوند؟\n\n" +
    "• تأیید (OK): اطلاعات خصوصی در گزارش ارسال می‌شوند.\n" +
    "• لغو (Cancel): اطلاعات خصوصی ارسال نمی‌شوند و محرمانه می‌مانند."
  );
  return allowPrivate;
}

function getSanitizedTextForPrivacy(rawText, allowPrivate) {
  if (allowPrivate) return rawText;
  return rawText
    .split("\n")
    .map(line => {
      if (
        line.includes("سوخت اضافی") ||
        line.includes("اضافه سوخت") ||
        line.includes("سهم شخصی") || line.includes("سهم سوخت شخصی") ||
        line.includes("درآمد") || line.includes("سهمیه محاسباتی") || line.includes("مازاد / کسری") || line.includes("اضافه‌سوخت") ||
        line.includes("خالص دریافتی")
      ) {
        const labelPart = "بخش خصوصی راننده";
        return labelPart + ": [محرمانه - عدم ارسال به درخواست راننده]";
      }
      return line;
    })
    .join("\n");
}

function getReportTextContent() {
  const m = calculateMetrics();
  const title = (state && state.tripTitle) || "سفر ترانزیتی";
  const dateStr = formatTripDate(state.tripDate) || "نامشخص";
  const nowStr = formatTimestamp(new Date().toISOString());
  const rates = (state && state.rates) || {};

  const lines = [
    "========================================",
    "🚛 گزارش کامل تسویه و سوخت ترانزیت",
    "========================================",
    "📌 عنوان سفر: " + title,
    "📅 تاریخ سفر: " + dateStr,
    "زمان ایجاد سفر: " + (formatTimestamp(state.createdAt) || "ثبت نشده"),
    "🕒 زمان تهیه گزارش: " + nowStr,
    "----------------------------------------",
    "⛽ خلاصه وضعیت سوخت:",
    "• مصرف کل سوخت: " + formatNum(m.totalConsumed || 0, 2) + " لیتر",
    "• سهمیه کل شرکت: " + formatNum(state.companyQuota || 0, 2) + " لیتر",
    "• سوخت اضافی مسیر (رفت: " + formatNum(m.extraOutboundFuel || 0, 1) + "L | برگشت: " + formatNum(m.extraReturnFuel || 0, 1) + "L | جمع: " + formatNum(m.extraRouteFuel || 0, 1) + "L)",
    "• سهمیه محاسباتی شرکت: " + formatNum(m.effectiveCompanyQuota ?? state.companyQuota ?? 0, 2) + " لیتر",
    "• مازاد / کسری سوخت: " + formatNum(m.companySurplus || 0, 2) + " لیتر",
    "----------------------------------------",
    "💰 خلاصه مالی و هزینه‌ها:",
    "• جمع هزینه‌های سفر (تومان): " + formatToman(m.totalExpensesToman || 0),
    "• نرخ ارزها (تومان): لیر=" + formatNum(rates.TRY || 0, 0) + " | دلار=" + formatNum(rates.USD || 0, 0) + " | یورو=" + formatNum(rates.EUR || 0, 0) + " | منات=" + formatNum(rates.AZN || 0, 0),
    "----------------------------------------"
  ];

  const borders = Array.isArray(state.borderFuelItems) ? state.borderFuelItems : [];
  lines.push("🛂 سوخت‌های مرزی (" + borders.length + " مورد):");
  if (!borders.length) {
    lines.push("  موردی ثبت نشده است.");
  } else {
    borders.forEach((it, i) => {
      const cur = it.currency || "IRT";
      const curLabel = (typeof CURRENCY_LABELS !== "undefined" && CURRENCY_LABELS[cur]) || cur;
      const tomanVal = toTomanAmount(it.amount, cur);
      const timePart = it.createdAt ? " [" + formatTimestamp(it.createdAt) + "]" : "";
      lines.push(`  ${i + 1}. ${it.borderName || "مرز"} | ${formatNum(it.liters || 0, 2)} لیتر | ${formatNum(it.amount || 0, cur === "IRT" ? 0 : 2)} ${curLabel} (${formatToman(tomanVal)})${timePart}`);
    });
  }

  const expenses = Array.isArray(state.tripExpenses) ? state.tripExpenses : [];
  lines.push("----------------------------------------");
  lines.push("🧾 هزینه‌های سفر (" + expenses.length + " مورد):");
  if (!expenses.length) {
    lines.push("  موردی ثبت نشده است.");
  } else {
    expenses.forEach((it, i) => {
      const cur = it.currency || "IRT";
      const curLabel = (typeof CURRENCY_LABELS !== "undefined" && CURRENCY_LABELS[cur]) || cur;
      const tomanVal = toTomanAmount(it.amount, cur);
      const timePart = it.createdAt ? " [" + formatTimestamp(it.createdAt) + "]" : "";
      lines.push(`  ${i + 1}. ${it.title || "هزینه"} | ${formatNum(it.amount || 0, cur === "IRT" ? 0 : 2)} ${curLabel} (${formatToman(tomanVal)})${timePart}`);
    });
  }

  lines.push("========================================");
  return lines.join("\n");
}

async function shareOrDownloadFile(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: filename,
        text: "گزارش تسویه سفر ترانزیتی",
        files: [file]
      });
      showToast("فایل برای اشتراک‌گذاری آماده شد");
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast("فایل " + filename + " دانلود شد");
}

function shareOrDownloadTxtReport() {
  const allowPrivate = askDriverPrivateDataPermission();
  const safeText = getSanitizedTextForPrivacy(getReportTextContent(), allowPrivate);
  const txt = window.TransitI18n?.report(safeText) || safeText;
  const blob = new Blob(["\ufeff" + txt], { type: "text/plain;charset=utf-8" });
  shareOrDownloadFile(blob, "gozaresh-tasviye.txt");
}

function shareOrDownloadCsvReport() {
  const t = text => window.TransitI18n?.t(text) || text;
  const rows = [
    ["ردیف", "بخش", "شرح / مرز", "مقدار (لیتر)", "مبلغ اصلی", "واحد ارز", "نرخ به تومان", "معادل تومان", "زمان ثبت"].map(t)
  ];
  let rowNum = 1;
  (state.borderFuelItems || []).forEach(it => {
    const cur = it.currency || "IRT";
    const curLabel = (typeof CURRENCY_LABELS !== "undefined" && CURRENCY_LABELS[cur]) || cur;
    const rate = getCurrencyRateToToman(cur);
    const tomanVal = toTomanAmount(it.amount, cur);
    rows.push([
      rowNum++,
      t("سوخت مرزی"),
      it.borderName || "",
      Number(it.liters) || 0,
      Number(it.amount) || 0,
      t(curLabel),
      rate,
      Math.round(tomanVal),
      it.createdAt || ""
    ]);
  });
  (state.tripExpenses || []).forEach(it => {
    const cur = it.currency || "IRT";
    const curLabel = (typeof CURRENCY_LABELS !== "undefined" && CURRENCY_LABELS[cur]) || cur;
    const rate = getCurrencyRateToToman(cur);
    const tomanVal = toTomanAmount(it.amount, cur);
    rows.push([
      rowNum++,
      t("هزینه سفر"),
      it.title || "",
      "",
      Number(it.amount) || 0,
      curLabel,
      rate,
      Math.round(tomanVal),
      it.createdAt || ""
    ]);
  });
  const csv = rows.map(r => r.map(v => '"' + String(v ?? "").replace(/^([=+@-]|[\t\r\n])/, "'$1").replace(/"/g, '""') + '"').join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  shareOrDownloadFile(blob, "gozaresh-tasviye.csv");
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const testLine = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = words[i];
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

function shareOrDownloadPngReport() {
  const includePrivate = askDriverPrivateDataPermission();
  const m = calculateMetrics();
  const title = (state && state.tripTitle) || "سفر ترانزیتی";
  const dateStr = formatTripDate(state.tripDate) || "نامشخص";
  const nowStr = formatTimestamp(new Date().toISOString());

  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#132038";
  ctx.fillRect(36, 36, canvas.width - 72, 140);
  ctx.strokeStyle = "#1e3a5f";
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, canvas.width - 72, 140);

  ctx.textAlign = "right";
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 34px sans-serif";
  ctx.fillText("گزارش کامل تسویه و سوخت ترانزیت", canvas.width - 64, 92);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "21px sans-serif";
  ctx.fillText("سفر: " + title + "   |   تاریخ سفر: " + dateStr, canvas.width - 64, 138);

  const cards = [
    { label: "مصرف کل سوخت", val: formatNum(m.totalConsumed || 0, 2) + " L", color: "#38bdf8" },
    { label: "سهمیه شرکت", val: formatNum(state.companyQuota || 0, 2) + " L", color: "#34d399" },
    { label: "مازاد / کسری", val: includePrivate ? formatNum(m.companySurplus, 2) + " L" : "محرمانه", color: "#fbbf24" },
    { label: "جمع هزینه‌ها", val: formatToman(m.totalExpensesToman || 0), color: "#f87171" }
  ];
  const cardW = 204;
  const gap = 16;
  cards.forEach((c, idx) => {
    const xRight = canvas.width - 36 - idx * (cardW + gap);
    const xLeft = xRight - cardW;
    ctx.fillStyle = "#111c30";
    ctx.fillRect(xLeft, 200, cardW, 120);
    ctx.strokeStyle = "#243b5a";
    ctx.strokeRect(xLeft, 200, cardW, 120);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "18px sans-serif";
    ctx.fillText(c.label, xRight - 16, 236);

    ctx.fillStyle = c.color;
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(c.val, xRight - 16, 286);
  });

  let y = 370;
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 25px sans-serif";
  ctx.fillText("ریز آیتم‌های ثبت‌شده", canvas.width - 44, y);
  y += 42;

  const allItems = [];
  (state.borderFuelItems || []).forEach(it => {
    const cur = it.currency || "IRT";
    const curLabel = (typeof CURRENCY_LABELS !== "undefined" && CURRENCY_LABELS[cur]) || cur;
    allItems.push(`[مرز] ${it.borderName || "مرز"} — ${formatNum(it.liters || 0, 1)}L — ${formatNum(it.amount || 0, cur === "IRT" ? 0 : 2)} ${curLabel}`);
  });
  (state.tripExpenses || []).forEach(it => {
    const cur = it.currency || "IRT";
    const curLabel = (typeof CURRENCY_LABELS !== "undefined" && CURRENCY_LABELS[cur]) || cur;
    allItems.push(`[هزینه] ${it.title || "هزینه"} — ${formatNum(it.amount || 0, cur === "IRT" ? 0 : 2)} ${curLabel}`);
  });

  ctx.font = "21px sans-serif";
  if (!allItems.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("هیچ آیتم سوخت مرزی یا هزینه سفری ثبت نشده است.", canvas.width - 44, y);
    y += 36;
  } else {
    for (let i = 0; i < allItems.length && y < 1160; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#101a2d" : "#0e1728";
      ctx.fillRect(36, y - 24, canvas.width - 72, 38);
      ctx.fillStyle = "#f1f5f9";
      y = wrapCanvasText(ctx, `${i + 1}. ${allItems[i]}`, canvas.width - 52, y, canvas.width - 104, 34);
      y += 8;
    }
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "18px sans-serif";
  if (allItems.length > 15) {
    ctx.fillText("برای همه ردیف‌ها، گزارش متنی یا چاپی را بررسی کنید.", canvas.width - 44, canvas.height - 62);
  }
  ctx.fillText("ایجاد شده در: " + nowStr, canvas.width - 44, canvas.height - 32);

  canvas.toBlob(blob => {
    if (blob) shareOrDownloadFile(blob, "gozaresh-tasviye.png");
  }, "image/png");
}

function confirmLocalized(message) {
  return window.confirm(window.TransitI18n?.t(message) || message);
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = window.TransitI18n?.t(msg) || msg;
  toast.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function populateFormFromState() {
  document.getElementById("tripTitle").value = state.tripTitle;
  document.getElementById("plateNo").value = state.plateNo;
  document.getElementById("tripDate").value = state.tripDate ?? "";
  document.getElementById("initialFuel").value = state.initialFuel;
  document.getElementById("companyQuota").value = state.companyQuota;
  document.getElementById("fuelSellPriceTry").value = state.fuelSellPriceTry;
  document.getElementById("outboundKm").value = state.outboundKm;
  document.getElementById("outboundWeight").value = state.outboundWeight;
  document.getElementById("outboundRate").value = state.outboundRate;
  document.getElementById("returnKm").value = state.returnKm;
  document.getElementById("returnWeight").value = state.returnWeight;
  document.getElementById("returnRate").value = state.returnRate;
  document.getElementById("emptyKm").value = state.emptyKm;
  document.getElementById("emptyRate").value = state.emptyRate;
  document.getElementById("idleFuel").value = state.idleFuel;

  document.getElementById("rateTRY").value = state.rates.TRY;
  document.getElementById("rateUSD").value = state.rates.USD;
  document.getElementById("rateEUR").value = state.rates.EUR;
  document.getElementById("rateAZN").value = state.rates.AZN;
}

function readFormIntoState() {
  state.tripTitle = document.getElementById("tripTitle").value.trim() || "سفر بدون عنوان";
  state.plateNo = document.getElementById("plateNo").value.trim();
  state.tripDate = document.getElementById("tripDate").value;
  state.initialFuel = TransitCalc.amount(document.getElementById("initialFuel").value);
  state.extraOutboundFuel = TransitCalc.amount(document.getElementById("extraOutboundFuel")?.value);
  state.extraReturnFuel = TransitCalc.amount(document.getElementById("extraReturnFuel")?.value);
  state.extraRouteFuel = state.extraOutboundFuel + state.extraReturnFuel;
  state.companyQuota = TransitCalc.amount(document.getElementById("companyQuota").value);
  state.fuelSellPriceTry = TransitCalc.amount(document.getElementById("fuelSellPriceTry").value);
  state.outboundKm = TransitCalc.amount(document.getElementById("outboundKm").value);
  state.outboundWeight = TransitCalc.amount(document.getElementById("outboundWeight").value);
  state.outboundRate = TransitCalc.amount(document.getElementById("outboundRate").value);
  state.returnKm = TransitCalc.amount(document.getElementById("returnKm").value);
  state.returnWeight = TransitCalc.amount(document.getElementById("returnWeight").value);
  state.returnRate = TransitCalc.amount(document.getElementById("returnRate").value);
  state.emptyKm = TransitCalc.amount(document.getElementById("emptyKm").value);
  state.emptyRate = TransitCalc.amount(document.getElementById("emptyRate").value);
  state.idleFuel = TransitCalc.amount(document.getElementById("idleFuel").value);

  state.rates.TRY = TransitCalc.amount(document.getElementById("rateTRY").value);
  state.rates.USD = TransitCalc.amount(document.getElementById("rateUSD").value);
  state.rates.EUR = TransitCalc.amount(document.getElementById("rateEUR").value);
  state.rates.AZN = TransitCalc.amount(document.getElementById("rateAZN").value);
  state.rates.IRT = 1;
}

function persistCurrentState() {
  if (!storageReady || workspaceBusy) return;
  TransitStorage.save({draft: state, editedArchiveId}).then(() => {
    const time = new Date().toLocaleTimeString("fa-IR", {hour: "2-digit", minute: "2-digit", second: "2-digit"});
    document.getElementById("lastSavedLabel").textContent = "آخرین ذخیره خودکار: " + time;
  }).catch(storageError);
}

function calculateMetrics() {
  return TransitCalc.calculate(state);
}

function summarizeCurrencyMap(items) {
  const map = {};
  items.forEach(it => {
    const c = it.currency || "IRT";
    map[c] = (map[c] || 0) + (Number(it.amount) || 0);
  });
  const parts = Object.entries(map)
    .filter(([, amt]) => amt > 0)
    .map(([curr, amt]) => `${formatNum(amt, curr === "IRT" ? 0 : 2)} ${CURRENCY_LABELS[curr] || curr}`);
  return parts.length ? parts.join(" + ") : "—";
}

function renderAll() {
  document.getElementById("tripDateDisplay").textContent = formatTripDate(state.tripDate);
  document.getElementById("tripCreatedAt").textContent = formatTimestamp(state.createdAt) || "ثبت نشده";
  const m = calculateMetrics();
  const missingRates = TransitCalc.currencies.slice(1).filter(currency => !TransitCalc.rate(state, currency));
  document.getElementById("rateStatus").textContent = missingRates.length ? "نرخ وارد نشده: " + missingRates.join("، ") : "";

  document.getElementById("kpiTotalConsumed").textContent = formatNum(m.totalConsumed, 2) + " لیتر";
  document.getElementById("kpiConsumedBreakdown").textContent =
    `رفت ${formatNum(m.outboundFuel, 1)} + خالی ${formatNum(m.emptyFuel, 1)} + درجا ${formatNum(m.idleFuel, 1)} + برگشت ${formatNum(m.returnFuel, 1)}`;

  document.getElementById("kpiCompanySurplus").textContent = formatNum(m.companySurplus, 2) + " لیتر";
  document.getElementById("kpiCompanyValue").textContent =
    `${formatNum(m.companyValueTry, 0)} لیر | ${formatToman(m.companyValueToman)}`;

  document.getElementById("kpiPersonalFuel").textContent = formatNum(m.effectivePersonalLiters, 2) + " لیتر";
  document.getElementById("kpiPersonalValue").textContent =
    `${formatNum(m.personalValueTry, 0)} لیر | ${formatToman(m.personalValueToman)}`;

  document.getElementById("kpiRemainingFuel").textContent = formatNum(m.remainingFuel, 2) + " لیتر";
  document.getElementById("kpiRemainingValue").textContent =
    `ارزش کل باقیمانده: ${formatToman(m.totalRemainingValueToman)}`;

  const baseTank = Math.max(state.initialFuel, m.totalConsumed, 1);
  const usedPct = Math.min(100, Math.max(0, (m.totalConsumed / baseTank) * 100));
  const compPct = Math.min(100 - usedPct, Math.max(0, (m.sellableCompanyLiters / baseTank) * 100));
  const persPct = Math.min(100 - usedPct - compPct, Math.max(0, (m.effectivePersonalLiters / baseTank) * 100));

  document.getElementById("barUsed").style.width = usedPct + "%";
  document.getElementById("barCompany").style.width = compPct + "%";
  document.getElementById("barPersonal").style.width = persPct + "%";

  document.getElementById("tankSummaryText").textContent = `مانده باک: ${formatNum(m.remainingFuel, 2)} لیتر`;
  document.getElementById("legUsed").textContent = formatNum(m.totalConsumed, 2);
  document.getElementById("legCompany").textContent = formatNum(m.sellableCompanyLiters, 2);
  document.getElementById("legPersonal").textContent = formatNum(m.effectivePersonalLiters, 2);
  document.getElementById("legRemaining").textContent = formatNum(m.remainingFuel, 2);

  const alertBox = document.getElementById("fuelAlertBox");
  alertBox.className = "alert-box";
  if (m.remainingFuel < 0) {
    alertBox.classList.add("alert-danger");
    alertBox.textContent = `⚠️ هشدار کسری سوخت: مصرف کل (${formatNum(m.totalConsumed, 2)} لیتر) از کل گازوئیل موجود (${formatNum(state.initialFuel, 2)} لیتر) بیشتر شده است!`;
  } else if (m.companySurplus < 0) {
    alertBox.classList.add("alert-warn");
    alertBox.textContent = `⚠️ توجه: مصرف کل از سهمیه شرکت (${formatNum(state.companyQuota, 2)} لیتر) فراتر رفته و ${formatNum(Math.abs(m.companySurplus), 2)} لیتر از ذخیره باک برداشت شده است.`;
  }

  renderBorderFuelTable();
  renderTripExpenseTable();
  renderSeparateSummaries(m);
  updateApprovalAndPayoutBanner(m);
}

function handleInputChange() {
  if (!storageReady || workspaceBusy) return;
  readFormIntoState();
  persistCurrentState();
  renderAll();
}

function addBorderFuelItem() {
  const zone = document.getElementById("bfZone").value;
  const type = document.getElementById("bfType").value;
  const borderName = document.getElementById("bfBorderName").value.trim() || (zone === "IRAN" ? "مرز ایران" : "مرز خارج");
  const amount = TransitCalc.amount(document.getElementById("bfAmount").value);
  const currency = document.getElementById("bfCurrency").value;
  const liters = TransitCalc.amount(document.getElementById("bfLiters").value);

  if (!amount || amount <= 0) {
    showToast("لطفاً مبلغ معتبر وارد کنید");
    return;
  }

  if (applyEditedRecordIfAny('border', {
    zone,
    type,
    borderName,
    amount,
    currency,
    liters
  })) {
    document.getElementById("bfLiters").value = "";
    document.getElementById("bfAmount").value = "";
    return;
  }
  state.borderFuelItems.push({
    id: Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    zone,
    type,
    borderName,
    amount,
    currency,
    liters,
    createdAt: new Date().toISOString()
  });

  document.getElementById("bfBorderName").value = "";
  document.getElementById("bfAmount").value = "";
  document.getElementById("bfLiters").value = "";

  persistCurrentState();
  renderAll();
  showToast("مورد مرزی ثبت شد");
}

function deleteBorderFuelItem(id) {
  if (!confirmLocalized("سطر انتخاب‌شده حذف شود؟")) return;
  state.borderFuelItems = state.borderFuelItems.filter(x => x.id !== id);
  persistCurrentState();
  renderAll();
  showToast("مورد حذف شد");
}

function renderBorderFuelTable() {
  const tbody = document.getElementById("borderFuelTableBody");
  if (!state.borderFuelItems.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">هنوز خرید سوخت یا جریمه مرزی ثبت نشده است.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.borderFuelItems.map((item, idx) => {
    const tomanVal = convertToToman(item.amount, item.currency);
    const zoneBadge = item.zone === "IRAN"
      ? `<span class="tag tag-iran">مرز ایران</span>`
      : `<span class="tag tag-foreign">مرز خارج</span>`;
    const typeBadge = item.type === "FINE"
      ? `<span class="tag tag-fine">جریمه گازوئیل</span>`
      : `<span class="tag tag-buy">خرید سوخت</span>`;

    return `
      <tr>
        <td>${zoneBadge}</td>
        <td>${typeBadge}</td>
        <td>${escapeHtml(item.borderName)} <button type="button" data-action="editRecordByType" data-arg0="border" data-arg1="${idx}" style="margin-right:6px;padding:2px 6px;font-size:0.72rem;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#38bdf8;cursor:pointer;">✏️ ویرایش</button>${item.createdAt ? `<div style="font-size:0.7rem;color:#94a3b8;">🕒 ${escapeHtml(formatTimestamp(item.createdAt))}</div>` : ""}</td>
        <td class="num-ltr">${item.liters > 0 ? formatNum(item.liters, 2) + " L" : "—"}</td>
        <td class="num-ltr">${formatNum(item.amount, item.currency === "IRT" ? 0 : 2)} ${CURRENCY_LABELS[item.currency]}</td>
        <td class="num-ltr">${formatToman(tomanVal)}</td>
        <td><button type="button" class="btn btn-danger-soft" style="padding: 4px 8px; font-size: 0.74rem;" data-action="deleteBorderFuelItem" data-arg0="${actionArg(item.id)}">حذف</button></td>
      </tr>
    `;
  }).join("");
}

function handleReceiptUpload(event) {
  const file = event.target.files && event.target.files[0];
  const previewBox = document.getElementById("pendingReceiptPreview");
  if (!file) {
    clearPendingReceipt();
    return;
  }

  const reader = new FileReader();
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15_000_000) {
    clearPendingReceipt();
    showToast("تصویر JPG، PNG یا WebP تا ۱۵ مگابایت انتخاب کنید");
    return;
  }
  clearPendingReceipt();
  const generation = receiptGeneration;
  const failed = () => { if (generation === receiptGeneration) showToast("خواندن تصویر سند ناموفق بود"); };
  reader.onerror = failed;
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      if (generation !== receiptGeneration) return;
      const maxDim = 960;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      pendingReceiptDataUrl = canvas.toDataURL("image/jpeg", 0.72);
      pendingReceiptName = file.name;

      previewBox.innerHTML = `
        <img src="${pendingReceiptDataUrl}" class="receipt-thumb" alt="پیش‌نمایش سند" data-action="openImageModal" data-arg0="${actionArg(pendingReceiptName)}" data-arg1="${pendingReceiptDataUrl}" />
        <span style="font-size: 0.75rem; color: #6ee7b7;">سند آماده ثبت است</span>
        <button type="button" class="btn btn-danger-soft" style="padding: 3px 8px; font-size: 0.72rem;" data-action="clearPendingReceipt">حذف عکس</button>
      `;
    };
    img.onerror = failed;
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearPendingReceipt() {
  receiptGeneration++;
  pendingReceiptDataUrl = "";
  pendingReceiptName = "";
  const expInp = document.getElementById("expReceiptInput");
  const camInp = document.getElementById("cameraReceiptInput");
  if (expInp) expInp.value = "";
  if (camInp) camInp.value = "";
  document.getElementById("pendingReceiptPreview").innerHTML = "";
}

function addTripExpenseItem() {
  const scope = document.getElementById("expScope").value;
  const title = document.getElementById("expTitle").value.trim() || (scope === "INSIDE_IRAN" ? "هزینه داخل ایران" : "هزینه خارج از ایران");
  const currency = document.getElementById("expCurrency").value;
  const amount = TransitCalc.amount(document.getElementById("expAmount").value);

  if (!amount || amount <= 0) {
    showToast("لطفاً مبلغ هزینه را وارد کنید");
    return;
  }

  if (applyEditedRecordIfAny('expense', {
    scope,
    title,
    currency,
    amount,
    ...(pendingReceiptDataUrl ? {receiptImage: pendingReceiptDataUrl, receiptName: pendingReceiptName} : {})
  })) {
    clearPendingReceipt();
    document.getElementById("expTitle").value = "";
    document.getElementById("expAmount").value = "";
    return;
  }
  state.tripExpenses.push({
    id: Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    scope,
    title,
    currency,
    amount,
    createdAt: new Date().toISOString(),
    receiptImage: pendingReceiptDataUrl || "",
    receiptName: pendingReceiptName || "سند هزینه"
  });

  document.getElementById("expTitle").value = "";
  document.getElementById("expAmount").value = "";
  clearPendingReceipt();

  persistCurrentState();
  renderAll();
  showToast("هزینه سفر ثبت شد");
}

function deleteTripExpenseItem(id) {
  if (!confirmLocalized("هزینه انتخاب‌شده حذف شود؟")) return;
  state.tripExpenses = state.tripExpenses.filter(x => x.id !== id);
  persistCurrentState();
  renderAll();
  showToast("هزینه حذف شد");
}

function renderTripExpenseTable() {
  const tbody = document.getElementById("tripExpenseTableBody");
  if (!state.tripExpenses.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">هنوز هزینه سفر دستی ثبت نشده است.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.tripExpenses.map((item, idx) => {
    const tomanVal = convertToToman(item.amount, item.currency);
    const scopeBadge = item.scope === "INSIDE_IRAN"
      ? `<span class="tag tag-iran">داخل ایران</span>`
      : `<span class="tag tag-foreign">خارج از ایران</span>`;

    const receiptHtml = validReceipt(item.receiptImage)
      ? `<img src="${item.receiptImage}" class="receipt-thumb" alt="سند" data-action="openImageModal" data-arg0="${actionArg(item.title)}" data-arg1="${item.receiptImage}" />`
      : `<span style="color: var(--text-dim); font-size: 0.74rem;">بدون عکس</span>`;

    return `
      <tr>
        <td>${scopeBadge}</td>
        <td>${escapeHtml(item.title)} <button type="button" data-action="editRecordByType" data-arg0="expense" data-arg1="${idx}" style="margin-right:6px;padding:2px 6px;font-size:0.72rem;border-radius:6px;border:1px solid #475569;background:#1e293b;color:#38bdf8;cursor:pointer;">✏️ ویرایش</button>${item.createdAt ? `<div style="font-size:0.7rem;color:#94a3b8;">🕒 ${escapeHtml(formatTimestamp(item.createdAt))}</div>` : ""}</td>
        <td class="num-ltr">${formatNum(item.amount, item.currency === "IRT" ? 0 : 2)} ${CURRENCY_LABELS[item.currency]}</td>
        <td class="num-ltr">${formatToman(tomanVal)}</td>
        <td>${receiptHtml}</td>
        <td><button type="button" class="btn btn-danger-soft" style="padding: 4px 8px; font-size: 0.74rem;" data-action="deleteTripExpenseItem" data-arg0="${actionArg(item.id)}">حذف</button></td>
      </tr>
    `;
  }).join("");
}

function renderSeparateSummaries(m) {
  const metrics = m || calculateMetrics();
  const bfIran = state.borderFuelItems.filter(x => x.zone === "IRAN");
  const bfForeign = state.borderFuelItems.filter(x => x.zone === "FOREIGN");

  const bfIranToman = bfIran.reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const bfForeignToman = bfForeign.reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const bfTotalToman = bfIranToman + bfForeignToman;
  const bfTotalLiters = state.borderFuelItems.reduce((s, x) => s + (Number(x.liters) || 0), 0);

  document.getElementById("sumBfIranToman").textContent = formatToman(bfIranToman);
  document.getElementById("sumBfIranCurrencies").textContent = "ارزها: " + summarizeCurrencyMap(bfIran);

  document.getElementById("sumBfForeignToman").textContent = formatToman(bfForeignToman);
  document.getElementById("sumBfForeignCurrencies").textContent = "ارزها: " + summarizeCurrencyMap(bfForeign);

  document.getElementById("sumBfTotalToman").textContent = formatToman(bfTotalToman);
  document.getElementById("sumBfTotalCurrencies").textContent =
    `کل لیتر ثبت‌شده: ${formatNum(bfTotalLiters, 2)} لیتر | ارزها: ${summarizeCurrencyMap(state.borderFuelItems)}`;

  const expInside = state.tripExpenses.filter(x => x.scope === "INSIDE_IRAN");
  const expOutside = state.tripExpenses.filter(x => x.scope === "OUTSIDE_IRAN");

  const expInsideToman = expInside.reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const expOutsideToman = expOutside.reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const expTotalToman = expInsideToman + expOutsideToman;
  const receiptsCount = state.tripExpenses.filter(x => !!x.receiptImage).length;

  document.getElementById("sumExpInsideToman").textContent = formatToman(expInsideToman);
  document.getElementById("sumExpInsideCurrencies").textContent = "ارزها: " + summarizeCurrencyMap(expInside);

  document.getElementById("sumExpOutsideToman").textContent = formatToman(expOutsideToman);
  document.getElementById("sumExpOutsideCurrencies").textContent = "ارزها: " + summarizeCurrencyMap(expOutside);

  document.getElementById("sumExpTotalToman").textContent = formatToman(expTotalToman);
  document.getElementById("sumExpTotalCurrencies").textContent =
    `تعداد اسناد تصویری: ${toPersianDigits(receiptsCount)} عکس | ارزها: ${summarizeCurrencyMap(state.tripExpenses)}`;

  document.getElementById("sumGrandCostsToman").textContent = formatToman(bfTotalToman + expTotalToman);
  document.getElementById("sumGrandCostsSub").textContent =
    `مرزها: ${formatToman(bfTotalToman)} + هزینه‌ها: ${formatToman(expTotalToman)}`;

  document.getElementById("sumCompanySettlementToman").textContent = formatToman(metrics.companyValueToman);
  document.getElementById("sumCompanySettlementSub").textContent =
    `${formatNum(metrics.companyValueTry, 0)} لیر (${formatNum(metrics.sellableCompanyLiters, 2)} لیتر قابل فروش)`;
}

function emptyDraft() {
  return {
    ...Object.fromEntries(TransitCalc.fields.map(field => [field, 0])),
    tripTitle: "", plateNo: "", ...newTripDates(),
    rates: {IRT: 1, TRY: 0, USD: 0, EUR: 0, AZN: 0},
    borderFuelItems: [], tripExpenses: []
  };
}

let workspaceBusy = false;
async function saveCurrentTripToArchive() {
  if (!storageReady || workspaceBusy) return;
  readFormIntoState();
  const m = calculateMetrics();
  const bfTotalToman = state.borderFuelItems.reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const expTotalToman = state.tripExpenses.reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);

  const archive = loadArchive();
  const index = archive.findIndex(entry => entry.archiveId === editedArchiveId);
  const previous = archive[index];
  const snapshot = {
    ...previous,
    archiveId: editedArchiveId || crypto.randomUUID(),
    savedAt: previous ? previous.savedAt : new Date().toISOString(),
    summary: {
      totalConsumed: m.totalConsumed,
      companySurplus: m.companySurplus,
      companyValueTry: m.companyValueTry,
      companyValueToman: m.companyValueToman,
      personalFuel: m.effectivePersonalLiters,
      personalValueToman: m.personalValueToman,
      bfTotalToman,
      expTotalToman
    },
    data: JSON.parse(JSON.stringify(state))
  };

  if (index === -1) archive.unshift(snapshot);
  else archive.splice(index, 1, snapshot);
  workspaceBusy = true;
  const draft = emptyDraft();
  try {
    await saveArchive(archive, {draft, editedArchiveId: null});
    applyWorkspace({draft, archive, feedback: feedbackEntries});
    showToast("سفر در آرشیو ذخیره شد و فرم برای سفر بعدی آماده است");
  } catch (error) { storageError(error); }
  finally { workspaceBusy = false; }
}

function openArchiveModal() {
  const container = document.getElementById("archiveListContainer");
  const query = document.getElementById("archiveSearch")?.value.trim().toLocaleLowerCase("fa") || "";
  const list = loadArchive().filter(({data}) => [data?.tripTitle, data?.plateNo, data?.tripDate]
    .some(value => String(value || "").toLocaleLowerCase("fa").includes(query)));

  if (!list.length) {
    container.innerHTML = `<div class="empty-state">هنوز هیچ سفری در آرشیو ذخیره نشده است.</div>`;
  } else {
    container.innerHTML = list.map(entry => {
      const d = entry.data || {};
      const s = entry.summary || {};
      return `
        <div class="archive-item">
          <div>
            <div style="font-weight: 800; font-size: 0.94rem; color: #fff;">
              ${escapeHtml(d.tripTitle || "سفر")} <span style="font-size: 0.76rem; color: #94a3b8;">(${escapeHtml(d.plateNo || "")})</span>
            </div>
            <div style="font-size: 0.76rem; color: #94a3b8; margin-top: 3px;">
              تاریخ آرشیو: ${escapeHtml(formatTimestamp(entry.savedAt))} | مصرف: ${formatNum(s.totalConsumed || 0, 2)} لیتر
            </div>
            <div style="font-size: 0.78rem; color: #7dd3fc; margin-top: 3px;">
              تسویه شرکت: ${formatNum(s.companyValueTry || 0, 0)} لیر (${formatToman(s.companyValueToman || 0)}) | سهم شخصی: ${formatNum(s.personalFuel || 0, 2)} لیتر
            </div>
            <div style="font-size: 0.76rem; color: #fcd34d; margin-top: 2px;">
              مرزها: ${formatToman(s.bfTotalToman || 0)} | هزینه‌های سفر: ${formatToman(s.expTotalToman || 0)}
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn btn-primary" style="padding: 6px 10px; font-size: 0.78rem;" data-action="loadArchivedTrip" data-arg0="${actionArg(entry.archiveId)}">بارگذاری</button>
            <button type="button" class="btn btn-ghost" style="padding: 6px 10px; font-size: 0.78rem;" data-action="exportArchivedTrip" data-arg0="${actionArg(entry.archiveId)}" data-arg1="txt">TXT</button>
            <button type="button" class="btn btn-ghost" style="padding: 6px 10px; font-size: 0.78rem;" data-action="exportArchivedTrip" data-arg0="${actionArg(entry.archiveId)}" data-arg1="csv">CSV</button>
            <button type="button" class="btn btn-danger-soft" style="padding: 6px 10px; font-size: 0.78rem;" data-action="deleteArchivedTrip" data-arg0="${actionArg(entry.archiveId)}">حذف</button>
          </div>
        </div>
      `;
    }).join("");
  }

  document.getElementById("archiveModal").classList.add("open");
}

function closeArchiveModal() {
  document.getElementById("archiveModal").classList.remove("open");
}

function exportArchivedTrip(archiveId, format) {
  const list = typeof loadArchive === "function" ? loadArchive() : [];
  const found = list.find(item => String(item.archiveId) === String(archiveId));
  if (!found || !found.data) {
    if (typeof showToast === "function") showToast("اطلاعات سفر آرشیوشده یافت نشد");
    return;
  }
  const prevState = state;
  try {
    state = normalizeDraft(found.data);
    if (format === "csv" && typeof shareOrDownloadCsvReport === "function") {
      shareOrDownloadCsvReport();
    } else if (typeof shareOrDownloadTxtReport === "function") {
      shareOrDownloadTxtReport();
    }
  } finally {
    state = prevState;
  }
}

function loadArchivedTrip(archiveId) {
  const list = loadArchive();
  const found = list.find(x => x.archiveId === archiveId);
  if (!found || !found.data || !confirmLocalized("سفر انتخاب‌شده جایگزین فرم فعلی شود؟")) return;
  editedArchiveId = archiveId;
  state = normalizeDraft(found.data);
  editingTarget = null;
  clearPendingReceipt();
  populateFormFromState();
  persistCurrentState();
  renderAll();
  closeArchiveModal();
  showToast("سفر از آرشیو بارگذاری شد");
}

async function deleteArchivedTrip(archiveId) {
  if (!storageReady || workspaceBusy || !confirmLocalized("سفر انتخاب‌شده حذف شود؟")) return;
  workspaceBusy = true;
  try {
    const nextId = editedArchiveId === archiveId ? null : editedArchiveId;
    await saveArchive(loadArchive().filter(entry => entry.archiveId !== archiveId), {editedArchiveId: nextId});
    editedArchiveId = nextId;
    openArchiveModal();
    showToast("سفر از آرشیو حذف شد");
  } catch (error) { storageError(error); }
  finally { workspaceBusy = false; }

}

function resetDefaultTrip() {
  if (!confirmLocalized("آیا مطمئن هستید که می‌خواهید اطلاعات سفر فعلی را به حالت پیش‌فرض بازنشانی کنید؟")) return;
  editedArchiveId = null;
  state = getDefaultState();
  populateFormFromState();
  persistCurrentState();
  renderAll();
  showToast("اطلاعات به حالت پیش‌فرض بازگشت");
}

function openImageModal(title, src) {
  document.getElementById("imageModalTitle").textContent = title || "تصویر سند";
  document.getElementById("imageModalImg").src = src;
  document.getElementById("imageModal").classList.add("open");
}

function closeImageModal() {
  document.getElementById("imageModal").classList.remove("open");
  document.getElementById("imageModalImg").removeAttribute("src");
}

function copyFullReport() {
  readFormIntoState();
  const m = calculateMetrics();
  const bfIranToman = state.borderFuelItems.filter(x => x.zone === "IRAN").reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const bfForeignToman = state.borderFuelItems.filter(x => x.zone === "FOREIGN").reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const expInsideToman = state.tripExpenses.filter(x => x.scope === "INSIDE_IRAN").reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);
  const expOutsideToman = state.tripExpenses.filter(x => x.scope === "OUTSIDE_IRAN").reduce((s, x) => s + convertToToman(x.amount, x.currency), 0);

  const lines = [
    `🚛 گزارش تسویه سفر: ${state.tripTitle}`,
    `پلاک: ${state.plateNo} | تاریخ: ${formatTripDate(state.tripDate)}`,
    `────────────────────`,
    `⛽ سوخت اولیه: ${formatNum(state.initialFuel, 2)} لیتر | سهمیه شرکت: ${formatNum(state.companyQuota, 2)} لیتر`,
    `📉 مصرف کل: ${formatNum(m.totalConsumed, 2)} لیتر (رفت ${formatNum(m.outboundFuel, 1)} + خالی ${formatNum(m.emptyFuel, 1)} + درجا ${formatNum(m.idleFuel, 1)} + برگشت ${formatNum(m.returnFuel, 1)})`,
    `💼 اضافه‌سوخت شرکت: ${formatNum(m.companySurplus, 2)} لیتر ➔ ${formatNum(m.companyValueTry, 0)} لیر (${formatToman(m.companyValueToman)})`,
    `👤 سهم سوخت شخصی: ${formatNum(m.effectivePersonalLiters, 2)} لیتر (${formatToman(m.personalValueToman)})`,
    `🛢️ کل باقیمانده باک: ${formatNum(m.remainingFuel, 2)} لیتر`,
    `────────────────────`,
    `🚧 خرید و جرایم مرزی: مرز ایران ${formatToman(bfIranToman)} | مرز خارج ${formatToman(bfForeignToman)} | جمع: ${formatToman(bfIranToman + bfForeignToman)}`,
    `🧾 هزینه‌های سفر: داخل ایران ${formatToman(expInsideToman)} | خارج از ایران ${formatToman(expOutsideToman)} | جمع: ${formatToman(expInsideToman + expOutsideToman)}`
  ];

  const plain = getSanitizedTextForPrivacy(lines.join("\n"), askDriverPrivateDataPermission());
  const text = window.TransitI18n?.report(plain) || plain;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast("گزارش کامل کپی شد")).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  showToast("گزارش کامل کپی شد");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function actionArg(value) {
  return escapeHtml(String(value));
}

function validReceipt(value) {
  return typeof value === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

function printTripReport() {
  const safeReport = getSanitizedTextForPrivacy(getReportTextContent(), askDriverPrivateDataPermission());
  const report = window.TransitI18n?.report(safeReport) || safeReport;
  const frame = document.createElement("iframe");
  frame.title = "گزارش چاپی";
  frame.style.cssText = "position:fixed;width:1px;height:1px;border:0";
  frame.onload = () => {
    frame.contentWindow.addEventListener("afterprint", () => frame.remove(), {once: true});
    frame.contentWindow.print();
  };
  const locale = window.TransitI18n?.language || "fa";
  const direction = (locale === "en" || locale === "tr") ? "ltr" : "rtl";
  frame.srcdoc = '<!doctype html><html lang="' + locale + '" dir="' + direction + '"><meta charset="utf-8"><title>Transit Fuel Report</title>'
    + '<style>body{font:14px/1.8 sans-serif;margin:24px}pre{white-space:pre-wrap;font:inherit}</style>'
    + '<h1>' + escapeHtml(window.TransitI18n?.t("گزارش تسویه سفر ترانزیتی") || "گزارش تسویه سفر ترانزیتی") + '</h1><pre>' + escapeHtml(report) + '</pre></html>';
  document.body.appendChild(frame);
}


function loadUserFeedbacks() {
  return structuredClone(feedbackEntries);
}

async function saveUserFeedbacks(items) {
  await TransitStorage.save({feedback: items});
  feedbackEntries = items;
}

function renderUserFeedbacks() {
  const list = loadUserFeedbacks();
  const badge = document.getElementById("feedbackCountBadge");
  if (badge) badge.textContent = list.length + " مورد";

  const container = document.getElementById("feedbackListContainer");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="empty-state">هنوز انتقاد یا پیشنهادی ثبت نشده است.</div>`;
    return;
  }

  container.innerHTML = list.map(item => `
    <div class="archive-item">
      <div>
        <div style="font-weight: 800; font-size: 0.9rem; color: #fff;">
          [${escapeHtml(item.type || "پیشنهاد")}] ${escapeHtml(item.author || "کاربر")}
          ${item.tripNo ? `<span style="font-size: 0.76rem; color: #7dd3fc;">(سفر: ${escapeHtml(item.tripNo)})</span>` : ""}
        </div>
        <div style="font-size: 0.84rem; color: #e2e8f0; margin-top: 4px; white-space: pre-wrap;">${escapeHtml(item.message || "")}</div>
        <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 4px;">${escapeHtml(formatTimestamp(item.createdAt))}</div>
      </div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        <button type="button" class="btn btn-danger-soft" style="padding: 6px 10px; font-size: 0.78rem;" data-action="deleteUserFeedback" data-arg0="${actionArg(item.id)}">حذف</button>
      </div>
    </div>
  `).join("");
}

async function submitUserFeedback() {
  const typeEl = document.getElementById("fbType");
  const authorEl = document.getElementById("fbAuthor");
  const tripNoEl = document.getElementById("fbTripNo");
  const msgEl = document.getElementById("fbMessage");
  const message = (msgEl && msgEl.value ? msgEl.value : "").trim();

  if (!message) {
    if (typeof showToast === "function") showToast("لطفاً متن انتقاد یا پیشنهاد را وارد کنید");
    return;
  }

  const list = loadUserFeedbacks();
  list.unshift({
    id: "fb_" + Date.now(),
    type: (typeEl && typeEl.value) || "پیشنهاد",
    author: ((authorEl && authorEl.value) || "").trim() || "کاربر برنامه",
    tripNo: ((tripNoEl && tripNoEl.value) || "").trim(),
    message,
    createdAt: new Date().toISOString()
  });
  try { await saveUserFeedbacks(list); } catch (error) { storageError(error); return; }
  if (msgEl) msgEl.value = "";
  if (tripNoEl) tripNoEl.value = "";
  renderUserFeedbacks();
  if (typeof showToast === "function") showToast("انتقاد یا پیشنهاد شما ثبت شد");
}

async function deleteUserFeedback(id) {
  if (!confirmLocalized("بازخورد انتخاب‌شده حذف شود؟")) return;
  const next = loadUserFeedbacks().filter(x => String(x.id) !== String(id));
  try { await saveUserFeedbacks(next); } catch (error) { storageError(error); return; }
  renderUserFeedbacks();
  if (typeof showToast === "function") showToast("مورد انتخاب‌شده حذف شد");
}

function exportFeedbacksTxt() {
  const list = loadUserFeedbacks();
  if (!list.length) {
    if (typeof showToast === "function") showToast("موردی برای خروجی وجود ندارد");
    return;
  }
  const lines = ["گزارش انتقادات و پیشنهادات کاربران", "========================================"];
  list.forEach((it, idx) => {
    lines.push(`${idx + 1}. [${it.type}] ${it.author} | سفر: ${it.tripNo || "-"} | زمان: ${formatTimestamp(it.createdAt)}`);
    lines.push(`   متن: ${it.message}`);
    lines.push("----------------------------------------");
  });
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "user-feedbacks.txt";
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
  initializeWorkspace();
});

let currentActiveAppSection = "all";

function switchAppSection(sectionKey) {
  if (typeof handleInputChange === "function") {
    handleInputChange();
  } else if (typeof persistCurrentState === "function") {
    persistCurrentState();
  }

  currentActiveAppSection = sectionKey || "all";
  const targets = document.querySelectorAll("[data-app-section]");
  targets.forEach(el => {
    const key = el.getAttribute("data-app-section");
    if (currentActiveAppSection === "all" || key === currentActiveAppSection) {
      el.classList.remove("section-hidden-by-nav");
    } else {
      el.classList.add("section-hidden-by-nav");
    }
  });

  document.querySelectorAll("[data-sec-btn]").forEach(btn => {
    const isMatch = btn.getAttribute("data-sec-btn") === currentActiveAppSection;
    btn.classList.toggle("active", isMatch);
  });

  const navBar = document.getElementById("sectionNavBar");
  if (navBar) {
    navBar.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-sec-btn]").forEach(button => button.classList.toggle("active", button.dataset.secBtn === currentActiveAppSection));
});

const actions = Object.freeze(Object.assign(Object.create(null), {
  addBorderFuelItem,
  addTripExpenseItem,
  clearPendingReceipt,
  closeArchiveModal,
  closeImageModal,
  closeInstallGuideModal,
  copyFullReport,
  deleteArchivedTrip,
  deleteBorderFuelItem,
  deleteTripExpenseItem,
  deleteUserFeedback,
  editRecordByType,
  exportArchivedTrip,
  exportFeedbacksTxt,
  exportWorkspace,
  loadArchivedTrip,
  openArchiveModal,
  openImageModal,
  openInstallGuideModal,
  printTripReport,
  resetDefaultTrip,
  saveCurrentTripToArchive,
  shareOrDownloadCsvReport,
  shareOrDownloadPngReport,
  shareOrDownloadTxtReport,
  submitUserFeedback,
  triggerInstallPrompt,
  camera: () => document.getElementById("cameraReceiptInput").click()
}));

document.addEventListener("click", event => {
  const backdrop = event.target.dataset.backdrop;
  if (backdrop) {
    actions[backdrop]?.();
    return;
  }
  const control = event.target.closest("[data-action]");
  if (!control || workspaceBusy || !storageReady) return;
  const {action, secBtn, arg0, arg1} = control.dataset;
  if (action === "section") switchAppSection(secBtn);
  else actions[action]?.(arg0, arg1);
});

document.addEventListener("input", event => {
  if (event.target.dataset.input === "draft") handleInputChange();
  if (event.target.dataset.input === "archive") openArchiveModal();
});

document.addEventListener("change", event => {
  if (event.target.dataset.change === "draft") handleInputChange();
  if (workspaceBusy || !storageReady) return;
  if (event.target.dataset.change === "receipt") handleReceiptUpload(event);
  if (event.target.dataset.change === "restore") restoreWorkspace(event.target);
});
