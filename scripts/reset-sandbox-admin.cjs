"use strict";
// Local-only administrator password recovery for the isolated Transit Fuel test database.
// The password is read from stdin, never from a CLI argument or an environment variable.
const fs=require("node:fs");
const path=require("node:path");
const {randomBytes,scryptSync,timingSafeEqual}=require("node:crypto");
const {DatabaseSync,backup}=require("node:sqlite");
const TEST_DB="I:\\TransitFuel-SMS-Test\\data\\transit-sms-test.sqlite";
const TEST_ROOT="I:\\TransitFuel-SMS-Test";
function inTestArea(file){
  return path.win32.resolve(file).toLowerCase() === path.win32.resolve(TEST_DB).toLowerCase();
}
function updateAdmin(db,password){
  const admin=db.prepare("SELECT id,role,active FROM users WHERE username=?").get("transit-admin");
  if(!admin || admin.role!=="admin" || admin.active!==1) throw Error("EXPECTED_ACTIVE_TEST_ADMIN_NOT_FOUND");
  const phone=db.prepare("SELECT 1 AS found FROM phone_accounts WHERE user_id=?").get(admin.id);
  if(!phone)throw Error("ADMIN_PHONE_NOT_REGISTERED");
  const salt=randomBytes(16).toString("hex");
  const credential=salt+":"+scryptSync(password,salt,64).toString("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const result=db.prepare("UPDATE users SET credential=? WHERE id=? AND role='admin' AND active=1").run(credential,admin.id);
    if(result.changes!==1)throw Error("ADMIN_UPDATE_FAILED");
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(admin.id);
    db.prepare("DELETE FROM otp_challenges WHERE user_id=?").run(admin.id);
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
  const newRecord=db.prepare("SELECT credential FROM users WHERE id=?").get(admin.id).credential;
  const [storedSalt,hash]=newRecord.split(":");
  if(!timingSafeEqual(scryptSync(password,storedSalt,64),Buffer.from(hash,"hex")))throw Error("POST_RESET_PASSWORD_VERIFICATION_FAILED");
}
async function main(){
  const filename=TEST_DB;
  // Hardcoded path and account; never run against an arbitrary DB.
  if(process.argv.length!==2 || !inTestArea(filename))throw Error("LOCAL_TEST_ONLY");
  const password=fs.readFileSync(0,"utf8").replace(/\r?\n$/,"");
  if(password.length<12||password.length>128||/[\r\n\x00]/.test(password))throw Error("PASSWORD_MUST_BE_12_TO_128_CHARS_SINGLE_LINE");
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())throw Error("ISOLATED_TEST_DB_MISSING");
  const backupDir=path.win32.join(TEST_ROOT,"backups");
  fs.mkdirSync(backupDir,{recursive:true});
  const file="transit-admin-before-reset-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+process.pid+".sqlite";
  const dest=path.win32.join(backupDir,file);
  const db=new DatabaseSync(filename);
  try{
    const integrity=db.prepare("PRAGMA integrity_check").get().integrity_check;
    if(integrity!=="ok")throw Error("SOURCE_DB_INTEGRITY_FAILURE");
    const admin=db.prepare("SELECT id,role,active FROM users WHERE username=?").get("transit-admin");
    if(!admin || admin.role!=="admin"||admin.active!==1)throw Error("EXPECTED_ACTIVE_TEST_ADMIN_NOT_FOUND");
    if(!db.prepare("SELECT 1 FROM phone_accounts WHERE user_id=?").get(admin.id))throw Error("ADMIN_PHONE_NOT_REGISTERED");
    await backup(db,dest);
    const verify=new DatabaseSync(dest,{readOnly:true});
    try{
      if(verify.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw Error("BACKUP_INTEGRITY_FAILURE");
    }finally{verify.close();}
    updateAdmin(db,password);
    console.log("SANDBOX_ADMIN_PASSWORD_RESET: PASS");
    console.log("ACCOUNT: transit-admin");
    console.log("OTP_SMS_MFA: STILL_REQUIRED");
    console.log("BACKUP_PATH: "+dest);
    console.log("NO_OTHER_ACCOUNTS_CHANGED");
  }finally{db.close();}
}
if(require.main===module) main().catch(error=>{console.error("SANDBOX_ADMIN_PASSWORD_RESET: FAILED "+error.message);process.exitCode=1;});
module.exports={updateAdmin};
