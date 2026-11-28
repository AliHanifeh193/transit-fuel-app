"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {createHash}=require("node:crypto");
test("Firefox and PowerShell password probes use the same LF separator",()=>{
 const browser=fs.readFileSync(path.join(__dirname,"..","manager-login.js"),"utf8");
 const shell=fs.readFileSync(path.join(__dirname,"..","scripts","compare-firefox-password.ps1"),"utf8");
 assert.match(browser,/nonce\+String\.fromCharCode\(10\)\+password/);
 assert.match(shell,/\$payload=\$nonce\+\[char\]10\+\$plain/);
 const nonce="0123456789abcdef0123456789abcdef",password="LocalProbeOnly!2026";
 const browserPayload=nonce+String.fromCharCode(10)+password;
 const powerShellPayload=nonce+"\n"+password;
 assert.deepEqual(Buffer.from(browserPayload,"utf8"),Buffer.from(powerShellPayload,"utf8"));
 assert.equal(createHash("sha256").update(browserPayload).digest("hex").slice(0,16),createHash("sha256").update(powerShellPayload).digest("hex").slice(0,16));
});
