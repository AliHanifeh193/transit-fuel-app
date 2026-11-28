"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {DatabaseSync}=require("node:sqlite");
const {scryptSync,timingSafeEqual}=require("node:crypto");
const {updateAdmin}=require("../scripts/reset-sandbox-admin.cjs");
test("isolated admin reset retains other users, phone association and requires MFA",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"transit-admin-test-"));
  const filename=path.join(dir,"test.sqlite");
  const db=new DatabaseSync(filename);
  try{
    db.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT, role TEXT, active INTEGER, credential TEXT);
      CREATE TABLE phone_accounts(user_id TEXT, phone TEXT);
      CREATE TABLE sessions(token TEXT, user_id TEXT);
      CREATE TABLE otp_challenges(id TEXT,user_id TEXT);
      INSERT INTO users VALUES ('a','transit-admin','admin',1,'old');
      INSERT INTO users VALUES ('b','driver-demo','driver',1,'driver-unchanged');
      INSERT INTO phone_accounts VALUES ('a','+989121234567');
      INSERT INTO sessions VALUES ('s','a');
      INSERT INTO otp_challenges VALUES ('c','a');
    `);
    updateAdmin(db,"NewExamplePassword!2026");
    const admin=db.prepare("SELECT credential FROM users WHERE id='a'").get().credential;
    const [salt,hash]=admin.split(":");
    assert.ok(timingSafeEqual(scryptSync("NewExamplePassword!2026",salt,64),Buffer.from(hash,"hex")));
    assert.equal(db.prepare("SELECT credential FROM users WHERE id='b'").get().credential,"driver-unchanged");
    assert.equal(db.prepare("SELECT phone FROM phone_accounts WHERE user_id='a'").get().phone,"+989121234567");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM otp_challenges").get().n,0);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
