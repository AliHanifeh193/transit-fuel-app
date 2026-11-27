"use strict";
// Test-only fixture. Never deploy this program or expose it beyond loopback.
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createServer,openDatabase,insertUser}=require("../server/app");
const folder=fs.mkdtempSync(path.join(os.tmpdir(),"transit-firefox-"));
const filename=path.join(folder,"test.sqlite");
const capture=process.env.TEST_SMS_CAPTURE_FILE;
if(!capture)throw Error("TEST_SMS_CAPTURE_FILE is required");
const db=openDatabase(filename);
const password="fixture-password-123456";
for(const [username,name,role,phone] of [
  ["driver","Test Driver","driver","+989121234567"],
  ["accounts","Test Accountant","accounting","+905321234567"],
  ["admin","Test Administrator","admin","+989121234568"]
]){
  insertUser(db,{username,name,role,password,phone});
}
db.close();
const codes={};
const server=createServer({
  filename,
  origin:"http://localhost:"+process.env.TEST_SMS_PORT,
  secure:false,
  authMode:"sms",
  sendSms:async (phone,code)=>{
    codes[phone]=code;
    fs.writeFileSync(capture,JSON.stringify(codes),{mode:0o600});
  }
});
server.listen(Number(process.env.TEST_SMS_PORT),"127.0.0.1",()=>{
  console.log("Fixture started");
});
process.on("SIGTERM",()=>server.close(()=>{fs.rmSync(folder,{recursive:true,force:true});process.exit(0);}));
