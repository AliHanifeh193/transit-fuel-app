"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
test("successful staff login displays OTP immediately without waiting for a refresh",()=>{
  const src=fs.readFileSync(path.join(root,"company.js"),"utf8");
  const begin=src.indexOf('if (result.mfaRequired) {');
  const end=src.indexOf('} catch (error)',begin);
  const first=src.slice(begin,end);
  assert.ok(begin>=0);
  assert.match(first,/revealOtpStep\(result\.challengeId, result\.phoneMasked\)/);
  const mfaBranch=first.slice(first.indexOf("if (result.mfaRequired) {"),first.indexOf("} else {"));
  assert.doesNotMatch(mfaBranch,/await refresh\(\)/);
  assert.match(src,/otpForm\.hidden = false/);
  assert.match(src,/otpForm\.removeAttribute\("hidden"\)/);
  assert.match(src,/otpForm\.scrollIntoView/);
  assert.match(src,/otpForm\.elements\.code\?\.focus/);
});
test("PWA asks network for current login scripts rather than keeping stale cached form",()=>{
  const worker=fs.readFileSync(path.join(root,"sw.js"),"utf8");
  assert.match(worker,/fetch\(event\.request, \{cache:"no-store"\}\)/);
  assert.match(worker,/cache\.match\(event\.request/);
});
