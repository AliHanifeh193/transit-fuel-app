"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
test("standalone manager page provides staff password and OTP forms",()=>{
 const html=fs.readFileSync(path.join(root,"manager-login.html"),"utf8");
 assert.match(html,/id="staffLogin"/);
 assert.match(html,/id="otpLogin" hidden/);
 assert.match(html,/name="username"/);
 assert.match(html,/name="password"/);
 assert.match(html,/name="code"/);
 assert.match(html,/src="\/manager-login\.js"/);
});
test("standalone manager entry is served without service-worker asset caching",()=>{
 const server=fs.readFileSync(path.join(root,"server","app.js"),"utf8");
 const worker=fs.readFileSync(path.join(root,"sw.js"),"utf8");
 assert.match(server,/"manager-login\.html": "text\/html/);
 assert.match(server,/"manager-login\.js": "text\/javascript/);
 assert.doesNotMatch(worker,/"\.\/manager-login\.html"/);
 assert.doesNotMatch(worker,/"\.\/manager-login\.js"/);
});
test("standalone manager login maintains two-factor server verification",()=>{
 const js=fs.readFileSync(path.join(root,"manager-login.js"),"utf8");
 assert.match(js,/send\("login",/);
 assert.match(js,/send\("auth\/verify",/);
 assert.match(js,/challengeId:challenge/);
 assert.match(js,/staff\.hidden=true/);
 assert.match(js,/otp\.hidden=false/);
 assert.match(js,/window\.location\.replace/);
 assert.doesNotThrow(()=>new (require("node:vm").Script)(js));
});
