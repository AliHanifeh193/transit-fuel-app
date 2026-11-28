"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {isDeepStrictEqual} = require("node:util");
const {randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash} = require("node:crypto");
const {DatabaseSync} = require("node:sqlite");
const {normalizePhone,maskPhone,newChallenge,verifyCode,webhookSms} = require("./sms-auth");
const {providerSms,assertSmsSettings} = require("./sms-providers");
const {localPreviewEnabled} = require("./sandbox-preview");
const {calculate, fields, currencies} = require("../calculations");
const root = path.resolve(__dirname, "..");
const assets = new Map(Object.entries({
  "index.html": "text/html; charset=utf-8",
  "manager-login.html": "text/html; charset=utf-8",
  "manager-login.js": "text/javascript; charset=utf-8",
  "privacy.html": "text/html; charset=utf-8",
  "calculations.js": "text/javascript; charset=utf-8",
  "storage.js": "text/javascript; charset=utf-8",
  "company.js": "text/javascript; charset=utf-8",
  "i18n.js": "text/javascript; charset=utf-8",
  "i18n-catalog.js": "text/javascript; charset=utf-8",
  "i18n-catalog-extra.js": "text/javascript; charset=utf-8",
  "i18n-catalog-dynamic.js": "text/javascript; charset=utf-8",
  "i18n-catalog-app.js": "text/javascript; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "sw.js": "text/javascript; charset=utf-8",
  "manifest.json": "application/manifest+json",
  "icon-192.svg": "image/svg+xml", "icon-512.svg": "image/svg+xml",
  "icon-192.png": "image/png", "icon-512.png": "image/png"
}));

function openDatabase(filename) {
  fs.mkdirSync(path.dirname(path.resolve(filename)), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('driver','admin','accounting')),
      credential TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS auth_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS phone_accounts (user_id TEXT PRIMARY KEY REFERENCES users(id),phone TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS otp_challenges (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,salt TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY, plate TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY, driver_id TEXT NOT NULL REFERENCES users(id),
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id), revision INTEGER NOT NULL,
      status TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, actor TEXT NOT NULL, entity TEXT NOT NULL, action TEXT NOT NULL,
      revision INTEGER, at TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS audit_trip_events ON audit (entity, action, id);
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES users(id), message TEXT NOT NULL, at TEXT NOT NULL
    );
  `);
  return db;
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireCondition(condition, status, message) {
  if (!condition) throw new RequestError(status, message);
}

function text(value, max, required = false) {
  requireCondition(typeof value === "string" && value.length <= max && (!required || value.trim()), 400, "invalid_text");
  return value.trim();
}

function credential(password, salt) {
  return scryptSync(password, salt, 64);
}

function passwordRecord(password) {
  requireCondition(typeof password === "string" && password.length >= 12 && password.length <= 128, 400, "invalid_password");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + credential(password, salt).toString("hex");
}

function matchesPassword(password, record) {
  const [salt, expected] = record?.split(":") || ["00".repeat(16), "00".repeat(64)];
  return timingSafeEqual(credential(password, salt), Buffer.from(expected, "hex"));
}

function insertUser(db, entry) {
  const username = text(entry.username, 64, true).toLowerCase();
  const name = text(entry.name, 120, true);
  requireCondition(/^[a-z0-9_.-]{3,64}$/.test(username), 400, "invalid_username");
  requireCondition(["driver", "admin", "accounting"].includes(entry.role), 400, "invalid_role");
  requireCondition(!db.prepare("SELECT id FROM users WHERE username=?").get(username), 409, "username_exists");
  const id = randomUUID();
  db.prepare("INSERT INTO users (id,username,name,role,credential) VALUES (?,?,?,?,?)")
    .run(id, username, name, entry.role, passwordRecord(entry.password));
  if(entry.phone){const phone=normalizePhone(entry.phone);requireCondition(phone,400,"invalid_phone");db.prepare("INSERT INTO phone_accounts(user_id,phone) VALUES(?,?)").run(id,phone);}
  return id;
}

function audit(db, actor, entity, action, revision = null, note = "", at = new Date().toISOString()) {
  db.prepare("INSERT INTO audit (actor,entity,action,revision,at,note) VALUES (?,?,?,?,?,?)")
    .run(actor, entity, action, revision, at, note);
}

function atomic(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function canonicalTimestamp(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    const date = new Date(value);
    const expected = value.length === 20 ? value.replace(/Z$/, ".000Z") : value;
    if (Number.isFinite(date.getTime()) && date.toISOString() === expected) return expected;
  }
  throw new RequestError(400, "invalid_timestamp");
}

function validatedTrip(data) {
  const validAmount = n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e12;
  requireCondition(data && fields.every(field => validAmount(data[field])), 400, "invalid_amount");
  const clean = Object.fromEntries(fields.map(field => [field, data[field]]));
  clean.tripTitle = text(data.tripTitle, 250, true);
  clean.tripDate = textLength(data.tripDate ?? "", 40);
  if (data.createdAt != null) clean.createdAt = canonicalTimestamp(data.createdAt);
  clean.rates = {IRT: 1};
  for (const currency of currencies.slice(1)) {
    requireCondition(validAmount(data.rates?.[currency]) && data.rates[currency] > 0, 400, "invalid_rate");
    clean.rates[currency] = data.rates[currency];
  }
  for (const kind of ["borderFuelItems", "tripExpenses"]) {
    requireCondition(Array.isArray(data[kind]) && data[kind].length <= 250, 400, "invalid_items");
    clean[kind] = data[kind].map(item => {
      requireCondition(item && validAmount(item.amount) && item.amount > 0 && currencies.includes(item.currency), 400, "invalid_item");
      const common = {amount: item.amount, currency: item.currency};
      if (kind === "borderFuelItems") {
        requireCondition(["IRAN", "FOREIGN"].includes(item.zone) && ["PURCHASE", "FINE"].includes(item.type)
          && validAmount(item.liters), 400, "invalid_border_item");
        return {...common, zone: item.zone, type: item.type, liters: item.liters, borderName: text(item.borderName, 250)};
      }
      requireCondition(["INSIDE_IRAN", "OUTSIDE_IRAN"].includes(item.scope), 400, "invalid_expense");
      const receiptImage = item.receiptImage || "";
      requireCondition(typeof receiptImage === "string" && receiptImage.length <= 1_000_000
        && (!receiptImage || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(receiptImage)), 400, "invalid_receipt");
      return {...common, scope: item.scope, title: text(item.title, 250), receiptImage};
    });
  }
  return clean;
}

function visibleTrip(db, row) {
  const data = JSON.parse(row.data);
  const eventTime = db.prepare("SELECT at FROM audit WHERE entity=? AND action=? ORDER BY id DESC LIMIT 1");
  return {
    ...row, data, totals: calculate(data),
    createdAt: data.createdAt ?? null,
    submissionRequestedAt: data.submissionRequestedAt ?? null,
    submittedAt: eventTime.get(row.id, "submitted")?.at ?? null,
    approvedAt: eventTime.get(row.id, "approved")?.at ?? null,
    settledAt: eventTime.get(row.id, "settled")?.at ?? null
  };
}

async function getBody(req) {
  requireCondition(req.headers["content-type"]?.split(";")[0] === "application/json", 415, "json_required");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= 8_000_000) chunks.push(chunk);
  }
  requireCondition(size <= 8_000_000, 413, "too_large");
  try {
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch {
    throw new RequestError(400, "invalid_json");
  }
}

function createServer({filename, origin, secure = true, authMode = "password", sendSms = webhookSms}) {
  const sandboxOtpPreview=localPreviewEnabled({filename,origin,secure,env:process.env});
  const db = openDatabase(filename);
  requireCondition(["password","sms"].includes(authMode),500,"invalid_auth_mode");
  if (authMode === "sms" && sendSms === webhookSms) {
    const provider = process.env.TRANSIT_SMS_PROVIDER || "webhook";
    requireCondition(["webhook","smsir"].includes(provider),500,"sms_provider_invalid");
    if (provider === "webhook") {
      requireCondition(/^https:\/\//i.test(process.env.TRANSIT_SMS_WEBHOOK_URL || "") &&
        Boolean(process.env.TRANSIT_SMS_WEBHOOK_TOKEN),500,"sms_not_configured");
    } else {
      try {assertSmsSettings();} catch {throw new RequestError(500,"smsir_not_configured");}
      sendSms = providerSms;
    }
  }
  // Sessions granted under password-only mode must never survive an SMS-MFA cutover.
  const previousMode=db.prepare("SELECT value FROM auth_settings WHERE key='mode'").get()?.value;
  if(previousMode!==authMode) atomic(db,()=>{
    db.prepare("DELETE FROM sessions").run();
    db.prepare("INSERT INTO auth_settings(key,value) VALUES('mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(authMode);
  });
  const attempts=new Map(), otpRequests=new Map();
  const hash = token => createHash("sha256").update(token).digest("hex");
  const cookie = secure ? "__Host-transit" : "transit";
  function setCookie(res, token, age) {
    res.setHeader("Set-Cookie", `${cookie}=${token}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`);
  }

  function startSession(res,account,token){
    const now=Date.now(),sid=randomBytes(32).toString("hex"),age=28800;
    db.prepare("DELETE FROM sessions WHERE expires<=?").run(now);
    if(token)db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(hash(sid),account.id,now+age*1000);
    setCookie(res,sid,age);return{id:account.id,name:account.name,role:account.role};
  }
  function throttle(key, minGap = 60000, max = 5){
    const now=Date.now();let state=otpRequests.get(key);
    if(!state||state.until<now){state={count:0,last:0,until:now+600000};}
    requireCondition(state.count<max&&now-state.last>=minGap,429,"try_later");
    state.count++;state.last=now;otpRequests.set(key,state);
  }
  async function issueOtp(account,purpose){
    const phone=db.prepare("SELECT phone FROM phone_accounts WHERE user_id=?").get(account.id)?.phone;
    requireCondition(phone,409,"phone_required");
    const {id,code}=newChallenge(db,account.id,purpose);
    try{await sendSms(phone,code);}catch{
      db.prepare("DELETE FROM otp_challenges WHERE id=?").run(id);
      throw new RequestError(503,"sms_unavailable");
    }
    // Show the code only on the isolated localhost Sandbox console, never in an HTTP response.
    if(sandboxOtpPreview) console.log("LOCAL_SANDBOX_OTP:",code,"VALID_FOR_SECONDS: 180");
    return{challengeId:id,phoneMasked:maskPhone(phone),expiresIn:180};
  }
  async function api(req, res, route) {
    const method = req.method;
    if (method !== "GET") requireCondition(req.headers.origin === origin, 403, "invalid_origin");
    const token = req.headers.cookie?.split(/;\s*/).find(value => value.startsWith(cookie + "="))?.split("=")[1];
    if (method === "GET" && route === "/api/health") {
      db.prepare("SELECT 1").get();
      return {status: "ok", version: "1.0.0", authMode};
    }
    if (method === "POST" && route === "/api/login") {
      const now = Date.now();
      for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
      const ip = req.socket.remoteAddress;
      const attempt = attempts.get(ip) || {count: 0, until: now + 300_000};
      requireCondition(attempt.count < 20, 429, "try_later");
      attempts.set(ip, attempt);
      attempt.count++;
      const body = await getBody(req);
      const username = text(body.username, 64).toLowerCase();
      const password = textLength(body.password, 128);
      const user = db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(username);
      const match = matchesPassword(password, user?.credential);
      requireCondition(match && user, 401, "invalid_credentials");
      attempts.delete(ip);
      if(authMode==="sms"){
        requireCondition(user.role!=="driver",403,"driver_otp_only");
        throttle("all:"+ip, 0, 30);
        throttle("staff:"+ip+":"+user.id);
        return {...(await issueOtp(user,"staff")),mfaRequired:true};
      }
      return startSession(res,user,token);
    }
    if(authMode==="sms"&&method==="POST"&&route==="/api/auth/request"){
      const body=await getBody(req),phone=normalizePhone(body.phone);
      requireCondition(phone,400,"invalid_phone");
      throttle("all:"+req.socket.remoteAddress, 0, 30);
      throttle("driver:"+req.socket.remoteAddress+":"+phone);
      const account=db.prepare(`SELECT u.id,u.name,u.role FROM users u JOIN phone_accounts p ON p.user_id=u.id WHERE p.phone=? AND u.role='driver' AND u.active=1`).get(phone);
      if(!account)return{requested:true,challengeId:randomBytes(32).toString("hex"),phoneMasked:maskPhone(phone),expiresIn:180};
      return{...(await issueOtp(account,"driver")),requested:true};
    }
    if(authMode==="sms"&&method==="POST"&&route==="/api/auth/verify"){
      const body=await getBody(req);
      requireCondition(typeof body.challengeId==="string"&&/^[a-f0-9]{64}$/.test(body.challengeId),400,"invalid_challenge");
      const c=db.prepare(`SELECT c.*,u.id AS account_id,u.name,u.role,u.active FROM otp_challenges c JOIN users u ON c.user_id=u.id WHERE c.id=?`).get(body.challengeId);
      requireCondition(c&&c.active&&c.expires>Date.now()&&c.attempts<5,401,"invalid_otp");
      db.prepare("UPDATE otp_challenges SET attempts=attempts+1 WHERE id=?").run(c.id);
      requireCondition(verifyCode(body.code,c),401,"invalid_otp");
      requireCondition(c.purpose===(c.role==="driver"?"driver":"staff"),403,"forbidden");
      db.prepare("DELETE FROM otp_challenges WHERE id=?").run(c.id);
      return startSession(res,{id:c.account_id,name:c.name,role:c.role},token);
    }
    const user = token && db.prepare(`
      SELECT u.id,u.name,u.role FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token=? AND s.expires>? AND u.active=1
    `).get(hash(token), Date.now());
    if (method === "GET" && route === "/api/session") return user || null;
    requireCondition(user, 401, "login_required");
    if (method === "POST" && route === "/api/logout") {
      db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
      setCookie(res, "", 0);
      return {};
    }
    if (method === "POST" && route === "/api/password") {
      const body = await getBody(req);
      const current = textLength(body.current, 128);
      const account = db.prepare("SELECT credential FROM users WHERE id=? AND active=1").get(user.id);
      requireCondition(account && matchesPassword(current, account.credential), 403, "invalid_credentials");
      const record = passwordRecord(body.next);
      return atomic(db, () => {
        db.prepare("UPDATE users SET credential=? WHERE id=?").run(record, user.id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        audit(db, user.id, user.id, "password_changed");
        setCookie(res, "", 0);
        return {};
      });
    }
    if (method === "GET" && route === "/api/vehicles") {
      return db.prepare("SELECT * FROM vehicles WHERE active=1 OR ?='admin' ORDER BY plate").all(user.role);
    }
    if (method === "GET" && route === "/api/users") {
      requireCondition(user.role === "admin", 403, "forbidden");
      return db.prepare("SELECT u.id,u.username,u.name,u.role,u.active,p.phone FROM users u LEFT JOIN phone_accounts p ON p.user_id=u.id ORDER BY u.username").all();
    }
    if (method === "POST" && route === "/api/users") {
      requireCondition(user.role === "admin", 403, "forbidden");
      const body = await getBody(req);
      if (authMode === "sms") requireCondition(normalizePhone(body.phone), 400, "invalid_phone");
      return atomic(db, () => {
        const id = insertUser(db, body);
        if (authMode === "sms") {
          const phone = normalizePhone(body.phone);
          db.prepare("INSERT INTO phone_accounts(user_id,phone) VALUES(?,?)").run(id, phone);
        }
        audit(db, user.id, id, "user_created");
        return {id};
      });
    }
    const phoneUpdate=/^\/api\/users\/([a-f0-9-]{36})\/phone$/.exec(route);
    if(method==="PATCH"&&phoneUpdate){
      requireCondition(user.role==="admin"&&user.id!==phoneUpdate[1],403,"forbidden");
      const body=await getBody(req),phone=normalizePhone(body.phone);
      requireCondition(phone,400,"invalid_phone");
      return atomic(db,()=>{
        const target=db.prepare("SELECT id FROM users WHERE id=?").get(phoneUpdate[1]);
        requireCondition(target,404,"not_found");
        db.prepare("INSERT INTO phone_accounts(user_id,phone) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone").run(target.id,phone);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
        db.prepare("DELETE FROM otp_challenges WHERE user_id=?").run(target.id);
        audit(db,user.id,target.id,"phone_updated");return{};
      });
    }
    const managed = /^\/api\/(users|vehicles)\/([a-f0-9-]{36})$/.exec(route);
    if (method === "PATCH" && managed) {
      requireCondition(user.role === "admin", 403, "forbidden");
      const body = await getBody(req);
      const [, table, id] = managed;
      requireCondition(typeof body.active === "boolean" && id !== user.id, 400, "invalid_status");
      return atomic(db, () => {
        const changed = db.prepare(`UPDATE ${table} SET active=? WHERE id=?`).run(Number(body.active), id);
        requireCondition(changed.changes === 1, 404, "not_found");
        if (table === "users" && !body.active) {
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
          db.prepare("DELETE FROM otp_challenges WHERE user_id=?").run(id);
        }
        audit(db, user.id, id, body.active ? "enabled" : "disabled");
        return {};
      });
    }
    if (method === "POST" && route === "/api/vehicles") {
      requireCondition(user.role === "admin", 403, "forbidden");
      const body = await getBody(req);
      const plate = text(body.plate, 100, true);
      return atomic(db, () => {
        requireCondition(!db.prepare("SELECT id FROM vehicles WHERE plate=?").get(plate), 409, "plate_exists");
        const id = randomUUID();
        db.prepare("INSERT INTO vehicles (id,plate) VALUES (?,?)").run(id, plate);
        audit(db, user.id, id, "vehicle_created");
        return {id};
      });
    }
    if (method === "GET" && route === "/api/trips") {
      return db.prepare(`
        SELECT t.id,t.updated,t.status,t.revision,t.driver_id,t.vehicle_id,u.name AS driver,v.plate
        FROM trips t JOIN vehicles v ON v.id=t.vehicle_id JOIN users u ON u.id=t.driver_id
        WHERE ? <> 'driver' OR t.driver_id=? ORDER BY t.updated DESC
      `).all(user.role, user.id);
    }
    const trip = /^\/api\/trips\/([a-f0-9-]{36})$/.exec(route);
    if (trip) {
      const id = trip[1];
      if (method === "GET") {
        requireCondition(user.role !== "admin", 403, "forbidden");
        const row = db.prepare("SELECT * FROM trips WHERE id=? AND (? != 'driver' OR driver_id=?)").get(id, user.role, user.id);
        requireCondition(row, 404, "not_found");
        return visibleTrip(db, row);
      }
      if (method === "PUT") {
        requireCondition(user.role === "driver", 403, "forbidden");
        const body = await getBody(req);
        const draft = validatedTrip(body.data);
        if (body.requestedAt != null) draft.submissionRequestedAt = canonicalTimestamp(body.requestedAt);
        const vehicle = text(body.vehicleId, 36, true);
        return atomic(db, () => {
          const row = db.prepare("SELECT * FROM trips WHERE id=?").get(id);
          if (row) {
            requireCondition(row.driver_id === user.id, 404, "not_found");
            const original = JSON.parse(row.data);
            if (original.createdAt == null) delete draft.createdAt;
            else draft.createdAt = original.createdAt;
            if (row.status === "submitted" && row.revision === body.revision + 1 && row.vehicle_id === vehicle && isDeepStrictEqual(original, draft)) {
              return visibleTrip(db, row);
            }
          }
          requireCondition((row?.revision || 0) === body.revision && (!row || row.status === "rejected"), 409, "trip_conflict");
          requireCondition(db.prepare("SELECT id FROM vehicles WHERE id=? AND active=1").get(vehicle), 400, "invalid_vehicle");
          const revision = body.revision + 1;
          const now = new Date().toISOString();
          const data = JSON.stringify(draft);
          if (row) db.prepare("UPDATE trips SET vehicle_id=?,revision=?,status='submitted',data=?,updated=? WHERE id=?")
            .run(vehicle, revision, data, now, id);
          else db.prepare("INSERT INTO trips (id,driver_id,vehicle_id,revision,status,data,updated) VALUES (?,?,?,?,'submitted',?,?)")
            .run(id, user.id, vehicle, revision, data, now);
          audit(db, user.id, id, "submitted", revision, "", now);
          return visibleTrip(db, db.prepare("SELECT * FROM trips WHERE id=?").get(id));
        });
      }
      if (method === "PATCH") {
        requireCondition(user.role === "accounting", 403, "forbidden");
        const body = await getBody(req);
        const next = {review: ["submitted", "reviewed"], approve: ["reviewed", "approved"],
          reject: ["reviewed", "rejected"], settle: ["approved", "settled"]}[body.action];
        requireCondition(Array.isArray(next), 400, "invalid_action");
        const note = text(body.note || "", 1000, ["reject", "settle"].includes(body.action));
        return atomic(db, () => {
          const row = db.prepare("SELECT * FROM trips WHERE id=?").get(id);
          requireCondition(row, 404, "not_found");
          requireCondition(row.revision === body.revision && row.status === next[0], 409, "trip_conflict");
          const revision = row.revision + 1;
          const now = new Date().toISOString();
          db.prepare("UPDATE trips SET status=?,revision=?,updated=?,note=? WHERE id=?")
            .run(next[1], revision, now, note, id);
          audit(db, user.id, id, next[1], revision, note, now);
          return visibleTrip(db, db.prepare("SELECT * FROM trips WHERE id=?").get(id));
        });
      }
    }
    if (method === "GET" && route === "/api/audit") {
      requireCondition(user.role !== "driver", 403, "forbidden");
      const url = new URL(req.url, origin);
      const after = Number(url.searchParams.get("after") || 0);
      requireCondition(Number.isSafeInteger(after) && after >= 0, 400, "invalid_cursor");
      return db.prepare("SELECT * FROM audit WHERE id>? ORDER BY id LIMIT 250").all(after);
    }
    if (route === "/api/feedback" && method === "POST") {
      const body = await getBody(req);
      const message = text(body.message, 4000, true);
      const id = randomUUID();
      db.prepare("INSERT INTO feedback VALUES (?,?,?,?)").run(id, user.id, message, new Date().toISOString());
      return {id};
    }
    if (route === "/api/feedback" && method === "GET") {
      requireCondition(user.role === "admin", 403, "forbidden");
      return db.prepare("SELECT * FROM feedback ORDER BY at DESC LIMIT 250").all();
    }
    throw new RequestError(404, "not_found");
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    try {
      const route = new URL(req.url, origin).pathname;
      if (route.startsWith("/api/")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(await api(req, res, route)));
        return;
      }
      const file = route === "/" ? "index.html" : route.slice(1);
      requireCondition(["GET", "HEAD"].includes(req.method) && assets.has(file), 404, "not_found");
      res.setHeader("Content-Type", assets.get(file));
      res.setHeader("Cache-Control", "no-cache");
      res.end(req.method === "HEAD" ? undefined : fs.readFileSync(path.join(root, file)));
    } catch (error) {
      if (!error.status) console.error(error);
      res.statusCode = error.status || 500;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({error: error.status ? error.message : "internal_error"}));
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on("close", () => db.close());
  return server;
}

function textLength(value, max) {
  requireCondition(typeof value === "string" && value.length <= max, 400, "invalid_text");
  return value;
}

if (require.main === module) {
  const filename = process.env.TRANSIT_DB || path.join(root, "data", "transit.sqlite");
  if (process.argv[2] === "init-admin") {
    const db = openDatabase(filename);
    if (db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) throw Error("Administrator already exists");
    const password = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
    atomic(db, () => {
      const id = insertUser(db, {username: process.argv[3], name: process.argv[4], password, role: "admin"});
      audit(db, id, id, "initial_admin_created");
    });
    db.close();
  } else if (process.argv[2] === "set-phone") {
    const username = process.argv[3], phone = normalizePhone(process.argv[4]);
    requireCondition(username && phone, 400, "invalid_phone");
    const db = openDatabase(filename);
    try {
      const account = db.prepare("SELECT id FROM users WHERE username=?").get(username);
      requireCondition(account, 404, "not_found");
      atomic(db, () => {
        db.prepare("INSERT INTO phone_accounts(user_id,phone) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone").run(account.id, phone);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(account.id);
        db.prepare("DELETE FROM otp_challenges WHERE user_id=?").run(account.id);
        audit(db, account.id, account.id, "phone_provisioned");
      });
      console.log("Phone registered for:", username);
    } finally { db.close(); }
  } else {
    const port = Number(process.env.TRANSIT_PORT || 8100);
    const host = process.env.TRANSIT_HOST || "127.0.0.1";
    const origin = new URL(process.env.TRANSIT_ORIGIN || `http://localhost:${port}`).origin;
    const secure = origin.startsWith("https://");
    if (!secure && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
      throw Error("A non-loopback public origin requires HTTPS");
    }
    const server = createServer({filename, origin, secure, authMode: process.env.TRANSIT_AUTH_MODE || "password"});
    server.listen(port, host, () => console.log(`Transit Fuel V1.0.0 on ${host}:${port}`));
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close());
  }
}

module.exports = {createServer, openDatabase, insertUser};
