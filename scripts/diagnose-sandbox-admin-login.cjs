"use strict";
const fs=require("node:fs");
const {DatabaseSync}=require("node:sqlite");
const {scryptSync,timingSafeEqual}=require("node:crypto");
const dbPath="I:\\TransitFuel-SMS-Test\\data\\transit-sms-test.sqlite";
const base="http://localhost:8112";
async function main(){
  let password=fs.readFileSync(0,"utf8").replace(/\r?\n$/,"");
  if(!password){console.log("CHECK: EMPTY_PASSWORD");process.exitCode=2;return;}
  let matched=false;
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    const admin=db.prepare("SELECT credential FROM users WHERE username=? AND role='admin' AND active=1").get("transit-admin");
    if(!admin){console.log("CHECK: ADMIN_NOT_FOUND");return;}
    const [salt,hash]=admin.credential.split(":");
    const actual=scryptSync(password,salt,64), expected=Buffer.from(hash,"hex");
    matched=actual.length===expected.length&&timingSafeEqual(actual,expected);
  }finally{db.close();}
  console.log("DATABASE_PASSWORD_MATCH:",matched?"YES":"NO");
  if(!matched)return;
  const response=await fetch(base+"/api/login",{
    method:"POST",
    headers:{"Content-Type":"application/json","Origin":base},
    body:JSON.stringify({username:"transit-admin",password}),
    signal:AbortSignal.timeout(12000)
  });
  password="";
  let result={};
  try{result=await response.json();}catch{}
  console.log("LOGIN_HTTP_STATUS:",response.status);
  if(response.status===200&&result.mfaRequired===true&&/^[a-f0-9]{64}$/.test(result.challengeId||"")){
    console.log("LOGIN_RESULT: MFA_REQUIRED");
    console.log("NEXT: Check the existing server PowerShell window for LOCAL_SANDBOX_OTP; do not share the code.");
  }else if(response.status===200)console.log("LOGIN_RESULT: RESPONSE_UNEXPECTED");
  else{
    const allowed=new Set(["invalid_credentials","invalid_origin","sms_unavailable","phone_required","try_later","invalid_text","internal_error"]);
    console.log("LOGIN_RESULT:",allowed.has(result.error)?result.error:"HTTP_"+response.status);
  }
}
main().catch(error=>{console.log("LOGIN_CHECK_FAILED:",error.name==="TimeoutError"?"SERVER_TIMEOUT":error.cause?.code||error.code||"CONNECTION_OR_SCRIPT_ERROR");process.exitCode=1;});
