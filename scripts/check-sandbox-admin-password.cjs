"use strict";
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { scryptSync, timingSafeEqual } = require("node:crypto");
const filename = "I:\\TransitFuel-SMS-Test\\data\\transit-sms-test.sqlite";
let password = "";
try {
  password = fs.readFileSync(0,"utf8").replace(/\r?\n$/,"");
  const db = new DatabaseSync(filename,{readOnly:true});
  try {
    const user = db.prepare("SELECT credential FROM users WHERE username=? AND role='admin' AND active=1").get("transit-admin");
    if (!user) { console.log("ADMIN_ACCOUNT: NOT_FOUND"); process.exitCode=2; }
    else {
      const record = user.credential.split(":");
      if (record.length!==2 || !/^[a-f0-9]{32}$/.test(record[0]) || !/^[a-f0-9]{128}$/.test(record[1])) {
        console.log("ADMIN_PASSWORD_RECORD: INVALID"); process.exitCode=2;
      } else {
        const actual = scryptSync(password,record[0],64);
        const expected = Buffer.from(record[1],"hex");
        console.log("ADMIN_PASSWORD_MATCH:",timingSafeEqual(actual,expected)?"YES":"NO");
      }
    }
  } finally { db.close(); }
} catch(error) {
  console.error("ADMIN_PASSWORD_CHECK: FAILED",error.code || error.message);
  process.exitCode=2;
} finally {
  password="";
}
