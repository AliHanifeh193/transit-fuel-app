"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {sendViaSmsIr,sendViaTurkeyGateway,providerSms,assertSmsSettings} = require("../server/sms-providers");

const env = {
  TRANSIT_SMSIR_API_KEY: "fake-test-key-not-real",
  TRANSIT_SMSIR_TEMPLATE_ID: "723456",
  TRANSIT_SMSIR_PARAMETER: "Code",
  TRANSIT_TURKEY_SMS_WEBHOOK_URL: "https://sms-gateway.example/otp",
  TRANSIT_TURKEY_SMS_WEBHOOK_TOKEN: "fake-test-token-not-real"
};
test("SMS.ir verify endpoint accepts a correctly configured Iranian OTP", async () => {
  let calls = 0;
  const fetchFn = async (url, opts) => {
    calls++;
    assert.equal(url, "https://api.sms.ir/v1/send/verify");
    assert.equal(opts.method, "POST");
    assert.equal(opts.redirect, "error");
    assert.equal(opts.headers["X-API-KEY"], env.TRANSIT_SMSIR_API_KEY);
    const body = JSON.parse(opts.body);
    assert.deepEqual(body, {
      mobile: "9121234567",
      templateId: 723456,
      parameters: [{name:"Code",value:"123456"}]
    });
    return {ok:true,json:async () => ({status:1,data:{messageId:34567}})};
  };
  await sendViaSmsIr("+989121234567","123456",{env,fetchFn});
  assert.equal(calls,1);
});

test("SMS.ir fails closed if provider response says unsuccessful despite HTTP 200",async()=>{
  const fetchFn = async()=>({ok:true,json:async()=>({status:0,message:"error"})});
  await assert.rejects(sendViaSmsIr("+989121234567","123456",{env,fetchFn}),/not_accepted/);
  await assert.rejects(sendViaSmsIr("+905321234567","123456",{env,fetchFn}),/invalid_recipient/);
  assert.throws(()=>assertSmsSettings({...env,TRANSIT_SMSIR_TEMPLATE_ID:"x"}),/not_configured/);
});

test("Turkish SMS numbers never travel to SMS.ir",async()=>{
  let seen;
  const fetchFn = async(url,opts)=>{
    seen={url,opts};
    return{ok:true};
  };
  await providerSms("+905321234567","987654",{env,fetchFn});
  assert.equal(seen.url,env.TRANSIT_TURKEY_SMS_WEBHOOK_URL);
  assert.equal(seen.opts.headers.Authorization,"Bearer "+env.TRANSIT_TURKEY_SMS_WEBHOOK_TOKEN);
  assert.deepEqual(JSON.parse(seen.opts.body),{
    to:"+905321234567",template:"transit-login",code:"987654",ttlSeconds:180
  });
  await assert.rejects(sendViaTurkeyGateway("+905321234567","987654",{
    env:{TRANSIT_TURKEY_SMS_WEBHOOK_URL:"",TRANSIT_TURKEY_SMS_WEBHOOK_TOKEN:""},
    fetchFn
  }),/not_configured/);
});

test("SMS.ir Sandbox requires explicit sandbox mode and reserved template", async () => {
  const sandbox = {...env, TRANSIT_SMSIR_TEMPLATE_ID:"123456", TRANSIT_SMS_ENV:"sandbox"};
  assert.throws(() => assertSmsSettings({...env, TRANSIT_SMSIR_TEMPLATE_ID:"123456"}), /sandbox_requires_explicit_mode/);
  assert.throws(() => assertSmsSettings({...env, TRANSIT_SMS_ENV:"sandbox"}), /sandbox_template_mismatch/);
  const fetchFn = async (url, options) => {
    assert.equal(url, "https://api.sms.ir/v1/send/verify");
    const body = JSON.parse(options.body);
    assert.equal(body.templateId, 123456);
    assert.equal(body.parameters[0].name,"Code");
    return {ok:true, json:async () => ({status:1, message:"موفق",data:{messageId:42,cost:0}})};
  };
  await sendViaSmsIr("+989121234567","482731",{env:sandbox,fetchFn});
});
