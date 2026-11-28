"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.join(__dirname,"..");
test("app loads localization and PWA caches it",()=>{
  const index=fs.readFileSync(path.join(root,"index.html"),"utf8");
  const worker=fs.readFileSync(path.join(root,"sw.js"),"utf8");
  const server=fs.readFileSync(path.join(root,"server/app.js"),"utf8");
  assert.match(index,/<script src="i18n\.js" defer><\/script>/);
  assert.match(worker,/\.\/i18n\.js/);
  assert.match(server,/"i18n\.js":/);
});
test("four-language UI translation maps and writing directions are present",()=>{
  const code=fs.readFileSync(path.join(root,"i18n.js"),"utf8");
  new vm.Script(code);
  for(const lang of ["fa","en","tr","ar"])assert.match(code,new RegExp(lang+":"));
  for(const token of ["نام کاربری","رمز عبور","تأیید کد یک‌بارمصرف"]) assert.ok(code.includes(token));
  for(const lang of ["en","tr","ar"]){
    for(const prefix of ["index","privacy"]){
      const file=fs.readFileSync(path.join(root,"public-site",prefix+"."+lang+".html"),"utf8");
      assert.match(file,new RegExp('lang="'+lang+'"'));
      assert.match(file,/privacy|Gizlilik|الخصوصية|gizlilik/i);
      assert.doesNotMatch(file,/<script\b|<form\b/i);
    }
  }
});
test("Persian prelaunch pages offer all language choices",()=>{
  for(const page of ["index.html","privacy.html"]){
    const html=fs.readFileSync(path.join(root,"public-site",page),"utf8");
    for(const lang of ["en","tr","ar"])assert.ok(html.includes("."+lang+".html"));
  }
});
