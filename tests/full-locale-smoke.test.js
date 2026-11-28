"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
function locale(lang){
  const window={};
  const document={readyState:"loading",addEventListener(){}};
  const localStorage={getItem(){return lang;}};
  const context=vm.createContext({window,document,localStorage});
  for(const file of ["i18n-catalog.js","i18n-catalog-extra.js","i18n-catalog-dynamic.js","i18n.js"]){
    vm.runInContext(read(file),context,{filename:file});
  }
  return window.TransitI18n;
}
test("all four languages initialize with stable financial data",()=>{
  for(const lang of ["fa","en","tr","ar"]){
    const i=locale(lang);
    assert.equal(i.language,lang);
    assert.equal(i.t("شماره سفر")===undefined,false);
    assert.equal(i.digits(1240).length,4);
  }
});
test("English dynamic UI uses English labels and Latin digits",()=>{
  const i=locale("en");
  assert.equal(i.t("عنوان / مسیر سفر"),"Trip title / route");
  assert.equal(i.t("توضیحات بازبینی و تسویه برای راننده"),"Review & settlement notes for driver");
  assert.equal(i.t("مانده باک: ۴۰۸.۸۰ لیتر").includes("Fuel remaining:"),true);
  assert.equal(i.digits("۴۰۸.۸۰"),"408.80");
  assert.match(i.report("📌 عنوان سفر: Example\n• مصرف کل سوخت: ۴۰۸.۸۰ لیتر"),/Trip title: Example\n• Total fuel consumed: 408.80 L/);
});
test("Turkish and Arabic texts and numeral formats",()=>{
  const tr=locale("tr"),ar=locale("ar");
  assert.equal(tr.t("شماره سفر"),"Sefer numarası");
  assert.equal(tr.t("تومان"),"tümen");
  assert.equal(tr.digits("۱۲۳"),"123");
  assert.equal(ar.t("شماره سفر"),"رقم الرحلة");
  assert.equal(ar.digits("123"),"١٢٣");
  assert.match(ar.report("📌 عنوان سفر: Example"),/عنوان الرحلة: Example/);
});
test("translated report leaves user-entered trip title unchanged",()=>{
  const i=locale("en");
  assert.match(i.report("📌 عنوان سفر: بازرگان ➔ مرسین"),/Trip title: بازرگان ➔ مرسین/);
});
test("localized assets are served and cached",()=>{
  const index=read("index.html");
  const server=read("server/app.js");
  const worker=read("sw.js");
  for(const asset of ["i18n.js","i18n-catalog.js","i18n-catalog-extra.js","i18n-catalog-dynamic.js"]){
    assert.ok(index.includes('src="'+asset+'"'));
    assert.ok(server.includes('"'+asset+'":'));
    assert.ok(worker.includes("./"+asset));
  }
});
