"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"..","server","app.js"),"utf8");
test("SMS-auth account creation persists normalized phone in same transaction",()=>{
 const start=source.indexOf('if (method === "POST" && route === "/api/users")');
 const end=source.indexOf('const phoneUpdate=',start);
 const route=source.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(route,/if \(authMode === "sms"\) requireCondition\(normalizePhone\(body\.phone\)/);
 assert.match(route,/return atomic\(db, \(\) => \{/);
 assert.match(route,/const id = insertUser\(db, body\)/);
 assert.match(route,/INSERT INTO phone_accounts\(user_id,phone\) VALUES\(\?,\?\)/);
 assert.match(route,/\.run\(id, phone\)/);
 assert.ok(route.indexOf('INSERT INTO phone_accounts')<route.indexOf('audit(db, user.id, id, "user_created")'));
});
