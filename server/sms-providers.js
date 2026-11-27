"use strict";

/**
 * Production SMS dispatch: Iranian phone numbers use SMS.ir verification templates;
 * Turkish phones use a separately configured HTTPS gateway.
 * Never embed vendor credentials or OTPs in browser-visible code/logs.
 */

function assertSmsSettings(env = process.env) {
  const apiKey = env.TRANSIT_SMSIR_API_KEY;
  const templateId = Number(env.TRANSIT_SMSIR_TEMPLATE_ID);
  const param = env.TRANSIT_SMSIR_PARAMETER || "Code";
  if (typeof apiKey !== "string" || !apiKey.trim()
      || !Number.isSafeInteger(templateId) || templateId <= 0
      || !/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(param)) {
    throw Error("smsir_not_configured");
  }
  // Turkey is intentionally independent. Never silently send Turkish OTPs to SMS.ir.
  return {apiKey, templateId, param};
}

async function withTimeout(fetchFn, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetchFn(url, {...options, signal:controller.signal, redirect:"error"});
  } finally { clearTimeout(timeout); }
}

async function sendViaSmsIr(phone, code, {env=process.env, fetchFn=fetch} = {}) {
  if (!/^\+989\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) throw Error("smsir_invalid_recipient");
  const {apiKey, templateId, param} = assertSmsSettings(env);
  const response = await withTimeout(fetchFn, "https://api.sms.ir/v1/send/verify", {
    method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json","X-API-KEY":apiKey},
    body:JSON.stringify({
      mobile:phone.slice(3), // SMS.ir verify API expects 9xxxxxxxxx (without +98).
      templateId,
      parameters:[{name:param,value:code}]
    })
  });
  if (!response.ok) throw Error("smsir_http_error");
  const result = await response.json();
  if (Number(result?.status) !== 1 || !result?.data?.messageId) {
    throw Error("smsir_delivery_not_accepted");
  }
}

async function sendViaTurkeyGateway(phone, code, {env=process.env, fetchFn=fetch} = {}) {
  if (!/^\+905\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) throw Error("turkey_invalid_recipient");
  const url = env.TRANSIT_TURKEY_SMS_WEBHOOK_URL;
  const secret = env.TRANSIT_TURKEY_SMS_WEBHOOK_TOKEN;
  if (!url || !secret || !/^https:\/\//i.test(url)) throw Error("turkey_sms_not_configured");
  const response = await withTimeout(fetchFn, url, {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+secret},
    body:JSON.stringify({to:phone,template:"transit-login",code,ttlSeconds:180})
  });
  if (!response.ok) throw Error("turkey_sms_unavailable");
}

async function providerSms(phone, code, options) {
  if (phone.startsWith("+98")) return sendViaSmsIr(phone,code,options);
  if (phone.startsWith("+90")) return sendViaTurkeyGateway(phone,code,options);
  throw Error("sms_country_not_supported");
}

module.exports = {assertSmsSettings,sendViaSmsIr,sendViaTurkeyGateway,providerSms};
