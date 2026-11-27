"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mkdtempSync, rmSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");
const {randomUUID} = require("node:crypto");
const {createServer, insertUser, openDatabase} = require("../server/app");
const {backupDatabase} = require("../server/backup");
const {fields} = require("../calculations");

test("company workflow with isolated accounts, idempotent submission, conflict detection and durable audit", async t => {
  const directory = mkdtempSync(join(tmpdir(), "transit-api-"));
  const filename = join(directory, "test.sqlite");
  const password = randomUUID();
  const bootstrap = openDatabase(filename);
  insertUser(bootstrap, {username: "admin", name: "مدیر آزمایش", role: "admin", password});
  bootstrap.close();
  const origin = "http://localhost";
  const server = createServer({filename, origin, secure: false});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, {recursive: true, force: true});
  });
  let admin, driver, other, accounts;
  async function call(route, status, {method = "GET", cookie, data, requestOrigin = origin} = {}) {
    const headers = {origin: requestOrigin};
    if (cookie) headers.cookie = cookie;
    if (method !== "GET") headers["content-type"] = "application/json";
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/" + route, {
      method, headers, body: method !== "GET" ? JSON.stringify(data || {}) : undefined
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return {value, cookie: response.headers.get("set-cookie")};
  }
  const post = (route, data, cookie, status = 200) => call(route, status, {method: "POST", data, cookie});
  const logIn = async username => {
    const response = await post("login", {username, password});
    assert.match(response.cookie, /HttpOnly; SameSite=Strict/);
    return response.cookie.split(";")[0];
  };
  await call("health", 200);
  await call("trips", 401);
  await call("login", 403, {method: "POST", data: {username: "admin", password}, requestOrigin: "https://another.example"});
  await post("login", {username: "admin", password: "invalid password"}, undefined, 401);
  admin = await logIn("admin");
  const ids = {};
  for (const [username, role] of [["driver", "driver"], ["other", "driver"], ["accounts", "accounting"]]) {
    ids[username] = (await post("users", {username, name: username, role, password}, admin)).value.id;
  }
  const vehicleId = (await post("vehicles", {plate: "خودروی آزمایش"}, admin)).value.id;
  driver = await logIn("driver");
  other = await logIn("other");
  accounts = await logIn("accounts");
  await call("users", 403, {cookie: driver});
  await post("vehicles", {plate: "Forbidden"}, accounts, 403);
  const id = randomUUID(), route = "trips/" + id;
  const data = Object.fromEntries(fields.map(field => [field, 0]));
  Object.assign(data, {initialFuel: 100, companyQuota: 60, idleFuel: 20, fuelSellPriceTry: 10,
    tripTitle: "آزمایش", tripDate: "", rates: {TRY: 100, USD: 200, EUR: 300, AZN: 50},
    borderFuelItems: [{type: "FINE", zone: "IRAN", amount: 1, currency: "TRY", liters: 0, borderName: "مرز"}],
    tripExpenses: [{scope: "INSIDE_IRAN", title: "رسید", amount: 5, currency: "TRY", receiptImage: "data:image/png;base64,AAAA"}]});
  const put = (revision, status = 200, input = data, cookie = driver) =>
    call(route, status, {method: "PUT", cookie, data: {revision, data: input, vehicleId}});
  const action = (action, revision, status = 200, cookie = accounts, note = "") =>
    call(route, status, {method: "PATCH", cookie, data: {action, revision, note}});
  await put(0, 400, {...data, idleFuel: -1});
  await put(0, 400, {...data, rates: {...data.rates, TRY: 0}});
  const submitted = (await put(0)).value;
  assert.equal(submitted.totals.netPayoutToman, 39_500);
  assert.match(submitted.data.tripExpenses[0].receiptImage, /^data:image\/png/);
  assert.equal((await put(0)).value.revision, 1);
  await put(0, 404, data, other);
  assert.deepEqual((await call("trips", 200, {cookie: other})).value, []);
  await call(route, 404, {cookie: other});
  await call(route, 403, {cookie: admin});
  await action("review", 1, 403, driver);
  await action("review", 1);
  await action("approve", 1, 409);
  await action("reject", 2, 200, accounts, "اصلاح");
  await put(3);
  await action("review", 4);
  await action("approve", 5);
  await action("settle", 6, 400);
  assert.equal((await action("settle", 6, 200, accounts, "مرجع ۱۲۳")).value.status, "settled");
  await put(7, 409);
  const audit = (await call("audit", 200, {cookie: accounts})).value.filter(row => row.entity === id);
  assert.deepEqual(audit.map(row => row.revision), [1, 2, 3, 4, 5, 6, 7]);
  await call("audit", 403, {cookie: driver});
  await post("feedback", {message: "آزمایش بازخورد"}, driver);
  assert.equal((await call("feedback", 200, {cookie: admin})).value.length, 1);
  await call("users/" + ids.driver, 200, {method: "PATCH", cookie: admin, data: {active: false}});
  assert.equal((await call("session", 200, {cookie: driver})).value, null);
  const next = randomUUID();
  await post("password", {current: password, next}, accounts);
  assert.equal((await call("session", 200, {cookie: accounts})).value, null);
  await post("login", {username: "accounts", password}, undefined, 401);
  const rotated = await post("login", {username: "accounts", password: next});
  accounts = rotated.cookie.split(";")[0];
  await post("logout", {}, accounts);
  assert.equal((await call("session", 200, {cookie: accounts})).value, null);
  const snapshot = join(directory, "backup.sqlite");
  await backupDatabase(filename, snapshot);
  await assert.rejects(backupDatabase(filename, snapshot), {code: "EEXIST"});
  const persisted = openDatabase(snapshot);
  try { assert.equal(persisted.prepare("SELECT status FROM trips WHERE id=?").get(id).status, "settled"); }
  finally { persisted.close(); }
});
