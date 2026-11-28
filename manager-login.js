"use strict";
(()=>{
 const staff=document.getElementById("staffLogin");
 const otp=document.getElementById("otpLogin");
 const message=document.getElementById("message");
 const hint=document.getElementById("otpHint");
 const toggle=document.getElementById("togglePassword");
 // Avoid carrying a stale saved password into a fresh diagnostic attempt.
 staff.elements.password.value="";
 window.addEventListener("pageshow",event=>{
   if(event.persisted && !staff.hidden){staff.elements.password.value="";showInputDiagnostics();}
 });
 toggle.addEventListener("click",()=>{
   const field=staff.elements.password;
   const visible=field.type==="password";
   field.type=visible?"text":"password";
   toggle.textContent=visible?"مخفی کردن رمز عبور":"نمایش رمز عبور";
   toggle.setAttribute("aria-pressed",String(visible));
   field.focus();
 });

 const passwordProbeButton=document.getElementById("passwordProbeButton");
 const passwordProbeNonce=document.getElementById("passwordProbeNonce");
 const passwordProbeResult=document.getElementById("passwordProbeResult");
 passwordProbeButton.addEventListener("click",async()=>{
   const raw=passwordProbeNonce.value.trim();
   const normalized=raw.replace(/^NONCE\s*:\s*/i,"").replace(/[\s\u200e\u200f]/g,"").toLowerCase();
   const nonce=normalized;
   if(!/^[a-f0-9]{32}$/.test(nonce)){
     passwordProbeResult.textContent="NONCE نامعتبر است (طول مقدار واردشده: "+normalized.length+" نویسه). فقط مقدار NONCE با طول ۳۲ را وارد کنید؛ PASSWORD_CHECK شانزده‌نویسه‌ای را اینجا نگذارید.";
     return;
   }
   const password=staff.elements.password.value;
   if(!password){passwordProbeResult.textContent="ابتدا رمز را در فیلد رمز وارد کنید.";return;}
   const bytes=new TextEncoder().encode(nonce+String.fromCharCode(10)+password);
   const digest=await crypto.subtle.digest("SHA-256",bytes);
   const hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
   passwordProbeResult.textContent="BROWSER_PASSWORD_CHECK: "+hex.slice(0,16).toUpperCase();
 });
 const inputDiagnostics=document.getElementById("inputDiagnostics");
 function safeInputSummary(){
   const username=staff.elements.username.value;
   const password=staff.elements.password.value;
   const usernameExact=username==="transit-admin";
   const passwordCodePoints=Array.from(password);
   const asciiPrintable=passwordCodePoints.every(char=>/^[\x21-\x7e]$/.test(char));
   const spaces=password!==password.trim();
   const controls=passwordCodePoints.some(char=>/[\x00-\x1f\x7f]/.test(char));
   return {usernameExact,passwordLength:passwordCodePoints.length,asciiPrintable,spaces,controls};
 }
 function showInputDiagnostics(){
   const v=safeInputSummary();
   inputDiagnostics.textContent=
     "بررسی ورودی (بدون نمایش رمز): نام کاربری دقیق: "+(v.usernameExact?"بله":"خیر")+
     " | طول رمز: "+v.passwordLength+
     " | نویسه‌های انگلیسی قابل چاپ: "+(v.asciiPrintable?"بله":"خیر")+
     " | فاصله ابتدا/انتها: "+(v.spaces?"دارد":"ندارد")+
     " | نویسه کنترلی: "+(v.controls?"دارد":"ندارد");
 }
 staff.elements.username.addEventListener("input",showInputDiagnostics);
 staff.elements.password.addEventListener("input",showInputDiagnostics);
 showInputDiagnostics();
 let challenge=null;
 async function send(route,body){
   const response=await fetch("/api/"+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",credentials:"same-origin"});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||"server_error");
   return data;
 }
 const errors={
  invalid_credentials:"نام کاربری یا رمز عبور نادرست است.",
  sms_unavailable:"ارسال پیامک آزمایشی ناموفق بود.",
  try_later:"تعداد تلاش‌ها زیاد است. کمی بعد دوباره امتحان کنید.",
  phone_required:"شماره موبایل برای این حساب ثبت نشده است.",
  invalid_otp:"کد اشتباه یا منقضی شده است.",
  invalid_challenge:"درخواست کد منقضی شده است؛ دوباره وارد شوید."
 };
 function showError(error){message.textContent=errors[error.message]||"ورود انجام نشد ("+error.message+").";}
 staff.addEventListener("submit",async event=>{
   event.preventDefault();
   const button=staff.querySelector('button[type="submit"]');
   showInputDiagnostics();
   button.disabled=true;
   message.textContent="در حال بررسی رمز و درخواست کد...";
   try{
     const response=await send("login",Object.fromEntries(new FormData(staff)));
     staff.elements.password.value="";
     if(response.mfaRequired!==true||!response.challengeId)throw Error("unexpected_login_response");
     challenge=response.challengeId;
     hint.textContent="کد یک‌بارمصرف به "+response.phoneMasked+" درخواست شد؛ اعتبار ۳ دقیقه.";
     staff.hidden=true;
     otp.hidden=false;
     message.textContent="کد جدید را از پنجره PowerShell سرور آزمایشی بخوانید و فقط اینجا وارد کنید.";
     otp.elements.code.focus();
   }catch(error){showError(error);staff.elements.password.value="";}
   finally{button.disabled=false;}
 });
 otp.addEventListener("submit",async event=>{
   event.preventDefault();
   const button=otp.querySelector('button[type="submit"]');
   button.disabled=true;message.textContent="در حال بررسی کد...";
   try{
     await send("auth/verify",{challengeId:challenge,code:otp.elements.code.value});
     challenge=null;
     message.textContent="ورود تأیید شد. انتقال به سامانه...";
     window.location.replace("/?manager-login-complete=1");
   }catch(error){showError(error);otp.elements.code.value="";}
   finally{button.disabled=false;}
 });
 // Local diagnostic handoff: first factor is verified by the local CLI.
 // A challenge never creates a session without the existing six-digit OTP.
 function acceptLocalDiagnosticChallenge(){
   const params=new URLSearchParams(window.location.hash.slice(1));
   const value=params.get("challenge");
   if(!value)return;
   // Clear the challenge from history immediately, including on malformed links.
   history.replaceState(null,"",window.location.pathname+window.location.search);
   if(!/^[a-f0-9]{64}$/.test(value)){
     message.textContent="لینک کد تأیید نامعتبر است؛ دوباره درخواست ورود بدهید.";
     return;
   }
   challenge=value;
   staff.hidden=true;
   otp.hidden=false;
   hint.textContent="کد شش‌رقمی جدیدِ درخواست‌شده از PowerShell، با اعتبار ۳ دقیقه";
   message.textContent="کد را فقط از پنجره PowerShell سرور آزمایشی بخوانید و اینجا وارد کنید.";
   otp.elements.code.focus();
 }
 acceptLocalDiagnosticChallenge();
 document.getElementById("back").addEventListener("click",()=>{
   challenge=null;otp.reset();otp.hidden=true;staff.hidden=false;message.textContent="";staff.elements.password.focus();
 });
})();
