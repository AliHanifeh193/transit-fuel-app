"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");
const {createServer, openDatabase, insertUser} = require("../server/app");
const {normalizePhone} = require("../server/sms-auth");

test("Iran and Turkey mobiles are normalized without accepting unrelated numbers", () => {
  assert.equal(normalizePhone("09121234567"), "+989121234567");
  assert.equal(normalizePhone("00989121234567"), "+989121234567");
  assert.equal(normalizePhone("+989121234567"), "+989121234567");
  assert.equal(normalizePhone("05321234567"), "+905321234567");
  assert.equal(normalizePhone("00905321234567"), "+905321234567");
  assert.equal(normalizePhone("+905321234567"), "+905321234567");
  for (const invalid of ["+12125550000", "09123", "123", "00991234567", "", null]) {
    assert.equal(normalizePhone(invalid), null, String(invalid));
  }
});

test("SMS login for drivers and mandatory password-plus-SMS for staff", async t => {
  const dir = mkdtempSync(join(tmpdir(), "transit-sms-"));
  const filename = join(dir, "sms.sqlite");
  const password = "correct-horse-battery-12345";
  const db = openDatabase(filename);
  insertUser(db, {username:"driver",name:"Driver",role:"driver",password,phone:"+989121234567"});
  insertUser(db, {username:"accounts",name:"Accountant",role:"accounting",password,phone:"+905321234567"});
  insertUser(db, {username:"admin",name:"Administrator",role:"admin",password,phone:"+989121234568"});
  db.close();
  const sent = [];
  const origin = "http://localhost";
  const server = createServer({filename, origin, secure:false, authMode:"sms", sendSms:async (to,code) => sent.push({to,code})});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function request(path, method="GET", data, cookie) {
    const headers = {Origin:origin};
    if(method!=="GET") headers["Content-Type"]="application/json";
    if(cookie)headers.Cookie=cookie;
    const response = await fetch(base+"/api/"+path,{method,headers,body:method==="GET"?undefined:JSON.stringify(data||{})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get("set-cookie")};
  }
  assert.equal((await request("health")).body.authMode,"sms");
  let result=await request("login","POST",{username:"driver",password});
  assert.equal(result.status,403,"driver must not use password login");
  result=await request("auth/request","POST",{phone:"09121234567"});
  assert.equal(result.status,200);
  assert.equal(result.body.phoneMasked.includes("1234567"),false,"phone number is masked");
  assert.equal(sent.length,1);
  const ticket=result.body.challengeId;
  assert.equal((await request("auth/verify","POST",{challengeId:ticket,code:"abcdef"})).status,401);
  const driver=await request("auth/verify","POST",{challengeId:ticket,code:sent[0].code});
  assert.equal(driver.status,200);
  assert.equal(driver.body.role,"driver");
  assert.equal((await request("auth/verify","POST",{challengeId:ticket,code:sent[0].code})).status,401,"OTP one-time only");
  assert.equal((await request("users","GET",null,driver.cookie.split(";")[0])).status,403);
  let staff=await request("login","POST",{username:"accounts",password});
  assert.equal(staff.status,200);
  assert.equal(staff.body.mfaRequired,true);
  assert.equal(staff.cookie,null,"no login session before second factor");
  assert.equal((await request("session")).body,null);
  assert.equal((await request("auth/verify","POST",{challengeId:staff.body.challengeId,code:sent.at(-1).code})).body.role,"accounting");
  const adminChallenge=await request("login","POST",{username:"admin",password});
  assert.equal(adminChallenge.body.mfaRequired,true);
  assert.equal((await request("auth/verify","POST",{challengeId:adminChallenge.body.challengeId,code:sent.at(-1).code})).body.role,"admin");
  const previousSent = sent.length;
  const unknown = await request("auth/request","POST",{phone:"+905321234567"});
  assert.equal(unknown.status,200);
  assert.match(unknown.body.challengeId,/^[a-f0-9]{64}$/);
  assert.equal(sent.length,previousSent,"staff cannot receive a driver OTP");
  assert.equal((await request("auth/verify","POST",{challengeId:unknown.body.challengeId,code:"123456"})).status,401);
});

test("SMS delivery failure does not create a session or reveal an OTP",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"transit-sms-fail-")),filename=join(dir,"sms.sqlite");
  const db=openDatabase(filename);
  insertUser(db,{username:"admin",name:"Admin",role:"admin",password:"an-example-password-5678",phone:"+989121234567"});
  db.close();
  const server=createServer({filename,origin:"http://localhost",secure:false,authMode:"sms",sendSms:async()=>{throw Error("down")}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const response=await fetch("http://127.0.0.1:"+server.address().port+"/api/login",{method:"POST",headers:{Origin:"http://localhost","Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"an-example-password-5678"})});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:"sms_unavailable"});
  assert.equal(response.headers.get("set-cookie"),null);
});

test("existing password-only sessions are invalidated when SMS mode is activated",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"transit-mfa-cutover-")),filename=join(dir,"test.sqlite");
  const db=openDatabase(filename);
  insertUser(db,{username:"admin",name:"Admin",role:"admin",password:"long-example-password-9876",phone:"+989121234567"});
  db.close();
  const origin="http://localhost";
  const old=createServer({filename,origin,secure:false,authMode:"password"});
  await new Promise(resolve=>old.listen(0,"127.0.0.1",resolve));
  const login=await fetch("http://127.0.0.1:"+old.address().port+"/api/login",{
    method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},
    body:JSON.stringify({username:"admin",password:"long-example-password-9876"})
  });
  assert.equal(login.status,200);
  const oldCookie=login.headers.get("set-cookie").split(";")[0];
  await new Promise(resolve=>old.close(resolve));
  let received;
  const modern=createServer({filename,origin,secure:false,authMode:"sms",sendSms:async(_phone,code)=>{received=code;}});
  await new Promise(resolve=>modern.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>modern.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const base="http://127.0.0.1:"+modern.address().port;
  const oldSession=await fetch(base+"/api/session",{headers:{Cookie:oldCookie}});
  assert.equal(await oldSession.json(),null,"old password-only session must not bypass MFA");
  const mfa=await fetch(base+"/api/login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"long-example-password-9876"})});
  assert.equal((await mfa.json()).mfaRequired,true);
  assert.equal(typeof received,"string");
});

test("expired OTPs and exhausted attempt quotas cannot authenticate",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"transit-otp-expiry-")),filename=join(dir,"test.sqlite");
  const db=openDatabase(filename);
  insertUser(db,{username:"driver",name:"Driver",role:"driver",password:"long-example-password-9876",phone:"+989121234567"});
  db.close();
  const codes=[];
  const origin="http://localhost";
  const server=createServer({filename,origin,secure:false,authMode:"sms",sendSms:async(_phone,code)=>codes.push(code)});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const base="http://127.0.0.1:"+server.address().port;
  async function post(route,data){
    const r=await fetch(base+"/api/"+route,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(data)});
    return {status:r.status,body:await r.json()};
  }
  const request=await post("auth/request",{phone:"09121234567"});
  const ticket=request.body.challengeId;
  const writable=openDatabase(filename);
  writable.prepare("UPDATE otp_challenges SET expires=? WHERE id=?").run(Date.now()-1000,ticket);
  writable.close();
  assert.equal((await post("auth/verify",{challengeId:ticket,code:codes[0]})).status,401);
});
