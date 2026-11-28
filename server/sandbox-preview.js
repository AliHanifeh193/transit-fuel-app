"use strict";
const path = require("node:path");
// An opt-in local development utility. Never reveal OTP for operational users.
function localPreviewEnabled({env=process.env,filename,origin,secure=false,host=env.TRANSIT_HOST,port=env.TRANSIT_PORT}={}) {
  if(env.TRANSIT_SANDBOX_SHOW_OTP !== "1") return false;
  const ok = env.TRANSIT_SMS_ENV==="sandbox"
    && env.TRANSIT_SMS_PROVIDER==="smsir"
    && env.TRANSIT_SMSIR_TEMPLATE_ID==="123456"
    && env.TRANSIT_AUTH_MODE==="sms"
    && env.TRANSIT_COUNTRY_SCOPE==="iran"
    && host==="127.0.0.1"
    && String(port)==="8112"
    && origin==="http://localhost:8112"
    && secure===false
    && filename
    && path.resolve(filename).toLowerCase()===path.resolve("I:\\TransitFuel-SMS-Test\\data\\transit-sms-test.sqlite").toLowerCase();
  if(!ok) throw Error("SANDBOX_OTP_PREVIEW_REFUSED_UNSAFE_CONFIGURATION");
  return true;
}
module.exports={localPreviewEnabled};
