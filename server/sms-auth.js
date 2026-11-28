"use strict";
const {randomInt, randomBytes, scryptSync, timingSafeEqual} = require("node:crypto");

// Accept numbers entered using Persian/Arabic digit keyboards.
function latinDigits(value) {
  return value.replace(/[۰-۹٠-٩]/g, char => {
    const n = char.charCodeAt(0);
    return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660);
  });
}
// Iranian and Turkish mobile numbers in canonical E.164 notation.
function normalizePhone(input) {
  if (typeof input !== "string") return null;
  let p = latinDigits(input.trim()).replace(/[\s()-]/g, "");
  if (p.startsWith("0098")) p = "+98" + p.slice(4);
  else if (p.startsWith("0090")) p = "+90" + p.slice(4);
  else if (/^09\d{9}$/.test(p)) p = "+98" + p.slice(1);
  else if (/^05\d{9}$/.test(p)) p = "+90" + p.slice(1);
  else if (/^98\d{10}$/.test(p) || /^90\d{10}$/.test(p)) p = "+" + p;
  return /^\+989\d{9}$/.test(p) || /^\+905\d{9}$/.test(p) ? p : null;
}
function maskPhone(p) { return p ? p.slice(0, 4) + "•••••" + p.slice(-3) : ""; }
function otpCode() { return String(randomInt(0, 1_000_000)).padStart(6, "0"); }
function hashCode(code, salt) { return scryptSync(code, salt, 32).toString("hex"); }
function verifyCode(code, challenge) {
  if (typeof code !== "string" || !/^\d{6}$/.test(latinDigits(code))) return false;
  const actual = Buffer.from(hashCode(latinDigits(code), challenge.salt), "hex");
  const expected = Buffer.from(challenge.code_hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
function newChallenge(db, userId, purpose) {
  const id = randomBytes(32).toString("hex");
  const code = otpCode();
  const salt = randomBytes(16).toString("hex");
  const now = Date.now();
  db.prepare("DELETE FROM otp_challenges WHERE expires < ?").run(now);
  db.prepare("DELETE FROM otp_challenges WHERE user_id=? AND purpose=?").run(userId, purpose);
  db.prepare("INSERT INTO otp_challenges (id,user_id,purpose,salt,code_hash,expires,attempts,created) VALUES (?,?,?,?,?,?,0,?)")
    .run(id, userId, purpose, salt, hashCode(code, salt), now + 180_000, now);
  return {id, code};
}
async function webhookSms(phone, code) {
  const url = process.env.TRANSIT_SMS_WEBHOOK_URL;
  const secret = process.env.TRANSIT_SMS_WEBHOOK_TOKEN;
  if (!url || !secret || !/^https:\/\//i.test(url)) throw Error("sms_not_configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + secret},
      body: JSON.stringify({to: phone, template: "transit-login", code, ttlSeconds: 180}),
      signal: controller.signal
    });
    if (!response.ok) throw Error("sms_delivery_failed");
  } finally { clearTimeout(timeout); }
}
module.exports = {normalizePhone, maskPhone, newChallenge, verifyCode, webhookSms};
