"use strict";

(() => {
  const login = document.getElementById("companyLogin");
  const workspace = document.getElementById("companyWorkspace");
  const driverForm = document.getElementById("driverPhoneLogin");
  const otpForm = document.getElementById("companyOtp");
  const otpHint = document.getElementById("otpHint");
  const cancelOtp = document.getElementById("cancelOtp");
  const status = document.getElementById("companyStatus");
  let activeUser;
  let authMode = "password";
  let pendingChallenge = null;
  let local = {};
  let ready = false;
  let syncing = false;
  let addingSubmission = false;
  const roles = {driver: "راننده", admin: "مدیر شرکت", accounting: "حسابداری"};
  const states = {submitted: "ارسال‌شده", reviewed: "بازبینی‌شده", rejected: "ردشده", approved: "تأییدشده", settled: "تسویه‌شده"};
  const errors = {
    invalid_credentials: "نام کاربری یا رمز عبور نادرست است",
    forbidden: "دسترسی مجاز نیست",
    trip_conflict: "نسخه سفر تغییر کرده است. وضعیت سرور را بررسی کنید. نسخه محلی حفظ شده است.",
    invalid_rate: "نرخ تمام ارزها باید مثبت باشد",
    sync_in_progress: "ارسال دیگری در حال انجام است. چند لحظه بعد دوباره تلاش کنید.",
    invalid_amount: "مقادیر سفر باید عدد معتبر و نامنفی باشند",
    invalid_password: "رمز عبور باید ۱۲ تا ۱۲۸ نویسه داشته باشد",
    invalid_vehicle: "وسیله نقلیه فعال نیست",
    try_later: "تلاش‌های ورود زیاد است. بعداً دوباره امتحان کنید.",
    invalid_phone: "شماره موبایل ایران یا ترکیه معتبر نیست.",
    invalid_otp: "کد نامعتبر یا منقضی شده است.",
    invalid_challenge: "درخواست تأیید نامعتبر است. دوباره کد بخواهید.",
    phone_required: "شماره موبایل این حساب ثبت نشده است. با مدیر سامانه تماس بگیرید.",
    sms_unavailable: "ارسال پیامک در حال حاضر در دسترس نیست.",
    driver_otp_only: "رانندگان باید از ورود پیامکی استفاده کنند."
  };

  function element(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }

  async function api(route, method = "GET", data = {}) {
    const options = {method, cache: "no-store"};
    if (method !== "GET") {
      options.headers = {"Content-Type": "application/json"};
      options.body = JSON.stringify(data);
    }
    const response = await fetch("./api/" + route, options);
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error), {status: response.status});
    return result;
  }

  function report(error) {
    status.textContent = errors[error.message] ||
      (error.status ? "عملیات انجام نشد (" + (error.message || error.status) + ")" :
        "ارتباط برقرار نشد. درخواست‌های ذخیره‌شده پس از اتصال دوباره ارسال می‌شوند.");
  }

  function button(label, action) {
    const node = element("button", label);
    node.className = "btn btn-ghost";
    node.type = "button";
    node.addEventListener("click", async () => {
      node.disabled = true;
      try { await action(); } catch (error) { report(error); }
      finally { node.disabled = false; }
    });
    return node;
  }

  function field(label, input) {
    const wrapper = element("label", label + " ");
    wrapper.append(input);
    return wrapper;
  }

  function input(type = "text", maxLength = 250) {
    const node = document.createElement("input");
    node.type = type;
    node.maxLength = maxLength;
    return node;
  }

  function select(options) {
    const node = document.createElement("select");
    for (const [value, label] of options) node.add(new Option(label, value));
    return node;
  }

  async function storeLocal(next) {
    if (!ready) throw Error("storage_unavailable");
    await TransitStorage.save({company: next});
    local = next;
  }

  async function synchronize() {
    if (syncing || addingSubmission || !activeUser || activeUser.role !== "driver") return;
    syncing = true;
    try {
      const pending = (local.pending || []).filter(entry => entry.userId === activeUser.id);
      for (const entry of pending) {
        try {
          await api("trips/" + entry.id, "PUT", entry.payload);
          await storeLocal({...local, pending: local.pending.filter(item => item.id !== entry.id)});
          status.textContent = "سفر در سامانه شرکت ثبت شد";
        } catch (error) {
          report(error);
          if (!error.status || error.status === 401 || error.status >= 500) break;
        }
      }
    } finally {
      syncing = false;
    }
  }

  async function submit(vehicle, existing) {
    if (!confirm("اطلاعات مالی، سوخت اضافی و تصاویر اسناد این سفر برای حسابداری شرکت ارسال شوند؟")) return;
    readFormIntoState();
    if ([...document.querySelectorAll("input[type=number]")].some(control => !control.validity.valid)) {
      throw Error("invalid_amount");
    }
    if (!vehicle) throw Error("invalid_vehicle");
    const id = existing?.id || crypto.randomUUID();
    const pending = local.pending || [];
    if (pending.some(entry => entry.id === id)) throw Error("trip_conflict");
    if (addingSubmission || syncing) throw Error("sync_in_progress");
    const data = structuredClone(state);
    addingSubmission = true;
    try {
      await storeLocal({...local, pending: [...pending, {id, userId: activeUser.id, payload: {
        vehicleId: vehicle, revision: existing?.revision || 0, data, requestedAt: new Date().toISOString()
      }}]});
    } finally { addingSubmission = false; }
    status.textContent = "سفر برای ارسال ذخیره شد";
    await refresh();
  }

  function describeTrip(view, trip) {
    view.replaceChildren(element("h3", trip.data.tripTitle), element("p", states[trip.status]),
      element("p", "خالص دریافتی راننده: " + formatToman(trip.totals.netPayoutToman)),
      element("p", "مصرف کل: " + formatNum(trip.totals.totalConsumed) + " لیتر"),
      element("p", "جمع خرید و جریمه مرزی: " + formatToman(trip.totals.borderCostsToman)),
      element("p", "جمع هزینه سفر: " + formatToman(trip.totals.totalExpensesToman)));
    for (const [label, value] of [
      ["تاریخ شروع سفر", formatTripDate(trip.data.tripDate)],
      ["زمان ایجاد سفر", formatTimestamp(trip.createdAt)],
      ["زمان درخواست ارسال از دستگاه", formatTimestamp(trip.submissionRequestedAt)],
      ["زمان دریافت ارسال", formatTimestamp(trip.submittedAt)],
      ["زمان تأیید حسابداری", formatTimestamp(trip.approvedAt)],
      ["زمان ثبت تسویه", formatTimestamp(trip.settledAt)]
    ]) {
      if (value) view.append(element("p", label + " • " + value));
    }
    for (const item of [...trip.data.borderFuelItems, ...trip.data.tripExpenses]) {
      const row = element("p", (item.title || item.borderName) + " | " + item.amount + " " + item.currency);
      if (item.receiptImage) row.append(button("تصویر سند", () => openImageModal(item.title, item.receiptImage)));
      view.append(row);
    }
    if (trip.note) view.append(element("p", trip.note));
    if (activeUser.role === "accounting") {
      const actions = {submitted: [["review", "بازبینی"]], reviewed: [["approve", "تأیید"], ["reject", "رد"]],
        approved: [["settle", "ثبت تسویه"]]}[trip.status] || [];
      const note = input("text", 1000);
      if (actions.length) view.append(field("یادداشت حسابداری", note));
      for (const [action, label] of actions) {
        view.append(button(label, async () => {
          if (!confirm(label + " این سفر؟")) return;
          await api("trips/" + trip.id, "PATCH", {action, revision: trip.revision, note: note.value});
          await refresh();
        }));
      }
    }
    if (activeUser.role === "driver" && trip.status === "rejected") {
      view.append(button("بارگذاری برای اصلاح", () => {
        if (!confirm("فرم محلی با نسخه ارسالی جایگزین شود؟")) return;
        state = normalizeDraft(trip.data);
        state.plateNo = "";
        for (const entry of [...state.borderFuelItems, ...state.tripExpenses]) entry.id = crypto.randomUUID();
        editedArchiveId = null;
        populateFormFromState();
        persistCurrentState();
        renderAll();
      }), button("ارسال فرم اصلاح‌شده", () => submit(trip.vehicle_id, trip)));
    }
  }

  async function administration(vehicles) {
    const section = element("section", "");
    const username = input("text", 64), name = input("text", 120), password = input("password", 128);
    const role = select(Object.entries(roles)), phone = input("tel", 20);
    phone.placeholder = "+989121234567 / +905321234567";
    const plate = input("text", 100);
    section.append(element("h3", "مدیریت کاربران و ناوگان"),
      field("نام کاربری", username), field("نام", name), field("رمز اولیه مدیر/حسابدار", password),
       field("نقش", role), field("شماره موبایل ثبت‌شده", phone),
      button("ایجاد کاربر", async () => {
        await api("users", "POST", {
           username: username.value, name: name.value, role: role.value, phone: phone.value,
           password: authMode === "sms" && role.value === "driver" ? crypto.randomUUID() : password.value
         });
        password.value = "";
        await refresh();
      }), field("پلاک", plate), button("ثبت خودرو", async () => {
        await api("vehicles", "POST", {plate: plate.value});
        await refresh();
      }));
    for (const [resource, entries] of [["users", await api("users")], ["vehicles", vehicles]]) {
      for (const entry of entries) {
        const line = element("p", entry.plate || entry.name + " (" + roles[entry.role] + ")" +
           (entry.phone ? " | " + entry.phone : ""));
        if (resource === "users" && entry.id !== activeUser.id) {
          const newPhone = input("tel", 20);
          newPhone.placeholder = "+989121234567 / +905321234567";
          line.append(field("اصلاح شماره", newPhone), button("ثبت شماره جدید", async () => {
            if (!confirm("شماره تلفن تغییر کند؟ تمام نشست‌های فعلی این کاربر خارج خواهند شد.")) return;
            await api("users/" + entry.id + "/phone", "PATCH", {phone: newPhone.value});
            await refresh();
          }));
        }
        if (entry.id !== activeUser.id) line.append(button(entry.active ? "غیرفعال" : "فعال", async () => {
          if (!confirm("وضعیت تغییر کند؟")) return;
          await api(resource + "/" + entry.id, "PATCH", {active: !entry.active});
          await refresh();
        }));
        section.append(line);
      }
    }
    const feedback = element("div", "");
    section.append(button("صندوق بازخورد", async () => {
      feedback.replaceChildren(...(await api("feedback")).map(entry => element("p", entry.at + " | " + entry.message)));
    }), feedback);
    return section;
  }

  async function refresh() {
    workspace.hidden = !activeUser;
    login.hidden = Boolean(activeUser) || Boolean(pendingChallenge);
    driverForm.hidden = Boolean(activeUser) || authMode !== "sms" || Boolean(pendingChallenge);
    otpForm.hidden = Boolean(activeUser) || !pendingChallenge;
    if (!activeUser) { workspace.replaceChildren(); return; }
    await synchronize();
    let vehicles, trips;
    try {
      [vehicles, trips] = await Promise.all([api("vehicles"), api("trips")]);
      if (activeUser.role === "driver" && ready) {
        await storeLocal({...local, vehicles, owner: activeUser.id});
      }
    } catch (error) {
      report(error);
      if (error.status === 401) {
        activeUser = undefined;
        return refresh();
      }
      vehicles = local.owner === activeUser.id ? local.vehicles || [] : [];
      trips = [];
    }
    const heading = element("h3", activeUser.name + " | " + roles[activeUser.role]);
    workspace.replaceChildren(heading, button("به‌روزرسانی", refresh),
      button("خروج", async () => {
        await api("logout", "POST");
        activeUser = undefined;
        status.textContent = "";
        await refresh();
      }));
    const credentials = element("details", "");
    const current = input("password", 128);
    const next = input("password", 128);
    current.autocomplete = "current-password";
    next.autocomplete = "new-password";
    credentials.append(element("summary", "تغییر رمز عبور"), field("رمز فعلی", current), field("رمز جدید", next),
      button("ذخیره رمز", async () => {
        try {
          await api("password", "POST", {current: current.value, next: next.value});
        } finally {
          current.value = "";
          next.value = "";
        }
        activeUser = undefined;
        status.textContent = "رمز عبور تغییر کرد. دوباره وارد شوید.";
        await refresh();
      }));
    workspace.append(credentials);
    if (activeUser.role === "driver") {
      const vehicle = select(vehicles.filter(entry => entry.active).map(row => [row.id, row.plate]));
      workspace.append(field("خودرو", vehicle), button("ارسال سفر فعلی", () => submit(vehicle.value)));
      for (const entry of (local.pending || []).filter(item => item.userId === activeUser.id)) {
        const row = element("p", "در صف ارسال: " + entry.payload.data.tripTitle);
        row.append(button("حذف از صف", async () => {
          if (syncing || !confirm("درخواست از صف ارسال حذف شود؟")) return;
          await storeLocal({...local, pending: local.pending.filter(item => item.id !== entry.id)});
          await refresh();
        }));
        workspace.append(row);
      }
    }
    if (activeUser.role === "admin") workspace.append(await administration(vehicles));
    const details = element("section", "");
    for (const trip of trips) {
      const label = [trip.plate, trip.driver, states[trip.status], formatTimestamp(trip.updated)].join(" | ");
      workspace.append(activeUser.role === "admin" ? element("p", label) : button(label, async () =>
        describeTrip(details, await api("trips/" + trip.id))));
    }
    workspace.append(details);
    if (activeUser.role !== "driver") {
      const log = element("div", "");
      let after = 0;
      workspace.append(button("نمایش رویدادهای حسابرسی", async () => {
        for (const entry of await api("audit?after=" + after)) {
          log.append(element("p", [formatTimestamp(entry.at), entry.action, entry.entity, entry.note].join(" | ")));
          after = entry.id;
        }
      }), log);
    }
    const message = document.createElement("textarea");
    message.maxLength = 4000;
    workspace.append(field("پیام برای شرکت", message), button("ارسال بازخورد", async () => {
      await api("feedback", "POST", {message: message.value});
      message.value = "";
      status.textContent = "بازخورد به شرکت ارسال شد";
    }));
  }

  login.addEventListener("submit", async event => {
    event.preventDefault();
    const values = new FormData(login);
    login.querySelector("button").disabled = true;
    try {
      const result = await api("login", "POST", Object.fromEntries(values));
      login.reset();
      if (result.mfaRequired) {
        pendingChallenge = result.challengeId;
        otpHint.textContent = "کد تأیید به " + result.phoneMasked + " ارسال شد؛ اعتبار: ۳ دقیقه";
        status.textContent = "برای تکمیل ورود مدیر یا حسابدار، کد پیامکی را وارد کنید.";
      } else {
        activeUser = result;
        status.textContent = "";
      }
      await refresh();
    } catch (error) {
      login.elements.password.value = "";
      report(error);
    } finally {
      login.querySelector("button").disabled = false;
    }
  });
  driverForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = driverForm.querySelector("button");
    button.disabled = true;
    try {
      const result = await api("auth/request", "POST", Object.fromEntries(new FormData(driverForm)));
      if (result.challengeId) {
        pendingChallenge = result.challengeId;
        otpHint.textContent = "کد تأیید به " + result.phoneMasked + " ارسال شد؛ اعتبار: ۳ دقیقه";
        status.textContent = "";
        await refresh();
      } else {
        status.textContent = "اگر شماره در سامانه ثبت شده باشد، پیامک ورود ارسال می‌شود.";
      }
    } catch (error) { report(error); }
    finally { button.disabled = false; }
  });
  otpForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = otpForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      activeUser = await api("auth/verify", "POST", {
        challengeId: pendingChallenge,
        code: otpForm.elements.code.value
      });
      pendingChallenge = null;
      otpForm.reset();
      status.textContent = "";
      await refresh();
    } catch (error) { otpForm.elements.code.value = ""; report(error); }
    finally { button.disabled = false; }
  });
  cancelOtp.addEventListener("click", async () => {
    pendingChallenge = null;
    otpForm.reset();
    status.textContent = "";
    await refresh();
  });
  document.addEventListener("transit-storage-ready", async event => {
    local = event.detail;
    ready = true;
    try {
      authMode = (await api("health")).authMode === "sms" ? "sms" : "password";
      activeUser = await api("session");
      await refresh();
    } catch {
      status.textContent = "برای ورود، برنامه را از نشانی سامانه شرکت باز کنید";
    }
  });
  window.addEventListener("online", async () => {
    try {
      if (!activeUser) activeUser = await api("session");
      await refresh();
    } catch (error) { report(error); }
  });
})();
