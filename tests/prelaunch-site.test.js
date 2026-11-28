"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
test("prelaunch website is standalone, truthful, and has privacy policy",()=>{
  const home=fs.readFileSync(path.join(root,"public-site/index.html"),"utf8");
  const privacy=fs.readFileSync(path.join(root,"public-site/privacy.html"),"utf8");
  assert.match(home,/lang="fa"/);
  assert.match(home,/در مرحله آماده‌سازی و آزمون/);
  assert.match(home,/privacy\.html/);
  assert.match(privacy,/حریم خصوصی/);
  assert.doesNotMatch(home,/<form\b|api[_-]?key|password/i);
  assert.doesNotMatch(home,/<script\b|<iframe\b/i);
});
