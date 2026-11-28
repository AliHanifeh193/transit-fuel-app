"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {localPreviewEnabled}=require("../server/sandbox-preview");
const safeEnv={
  TRANSIT_SANDBOX_SHOW_OTP:"1",
  TRANSIT_SMS_ENV:"sandbox",
  TRANSIT_SMS_PROVIDER:"smsir",
  TRANSIT_SMSIR_TEMPLATE_ID:"123456",
  TRANSIT_AUTH_MODE:"sms",
  TRANSIT_COUNTRY_SCOPE:"iran"
};
const options={
  env:safeEnv,
  filename:"I:\\TransitFuel-SMS-Test\\data\\transit-sms-test.sqlite",
  origin:"http://localhost:8112",
  secure:false,
  host:"127.0.0.1",
  port:"8112"
};
test("OTP console preview disabled by default",()=>{
  assert.equal(localPreviewEnabled({...options,env:{...safeEnv,TRANSIT_SANDBOX_SHOW_OTP:undefined}}),false);
});
test("OTP console preview enabled only for exact isolated local Sandbox",()=>{
  assert.equal(localPreviewEnabled(options),true);
  for (const patch of [
    {origin:"https://transitfuel.ir",secure:true},
    {host:"0.0.0.0"},
    {port:"8100"},
    {filename:"C:\\HeavyDriver\\users.sqlite"},
    {env:{...safeEnv,TRANSIT_SMS_ENV:"production"}},
    {env:{...safeEnv,TRANSIT_SMSIR_TEMPLATE_ID:"488043"}},
    {env:{...safeEnv,TRANSIT_COUNTRY_SCOPE:"iran-and-turkey"}},
  ]) {
    assert.throws(()=>localPreviewEnabled({...options,...patch}),/SANDBOX_OTP_PREVIEW_REFUSED/);
  }
});
