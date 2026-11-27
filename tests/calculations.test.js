"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {calculate, amount, rate} = require("../calculations");

test("training trip preserves fuel arithmetic and separates border costs from driver settlement", () => {
  const totals = calculate({
    initialFuel: 1240, companyQuota: 1100, extraOutboundFuel: 20, fuelSellPriceTry: 55,
    outboundKm: 1220, outboundRate: 34, returnKm: 1100, returnRate: 35,
    emptyKm: 60, emptyRate: 24, idleFuel: 17, rates: {TRY: 5300, EUR: 210000},
    borderFuelItems: [{type: "FINE", currency: "TRY", amount: 100}, {type: "PURCHASE", currency: "EUR", amount: 10}],
    tripExpenses: [{currency: "TRY", amount: 200}, {currency: "IRT", amount: 40000}]
  });
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} vs ${expected}`);
  near(totals.totalConsumed, 831.2);
  near(totals.remainingFuel, 408.8);
  near(totals.effectiveCompanyQuota, 1080);
  near(totals.companySurplus, 248.8);
  near(totals.effectivePersonalLiters, 160);
  near(totals.companyValueToman, 72_525_200);
  near(totals.borderCostsToman, 2_630_000);
  near(totals.totalExpensesToman, 1_100_000);
  near(totals.netPayoutToman, 45_540_000);
});

test("deficit is visible and only real surplus is allocated when the starting tank is short", () => {
  const deficit = calculate({initialFuel: 10, companyQuota: 200, idleFuel: 30});
  assert.equal(deficit.remainingFuel, -20);
  assert.equal(deficit.sellableCompanyLiters, 0);
  assert.equal(deficit.effectivePersonalLiters, 0);
  assert.equal(calculate({initialFuel: 100, companyQuota: 200, idleFuel: 20}).sellableCompanyLiters, 80);
});

test("invalid numbers never generate negative consumption or non-finite totals", () => {
  for (const value of [null, "x", -1, Infinity, NaN, ""]) assert.equal(amount(value), 0);
  assert.equal(rate({rates: {TRY: 0}}, "TRY"), 0);
  assert.equal(rate({}, "IRT"), 1);
  assert.equal(rate({}, "constructor"), 0);
  const totals = calculate({outboundKm: -10, outboundRate: Infinity, initialFuel: "invalid", companyQuota: -10});
  assert.ok(Object.values(totals).every(Number.isFinite));
  assert.equal(totals.totalConsumed, 0);
});
