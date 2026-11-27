"use strict";
(() => {
  const fields = "initialFuel companyQuota extraOutboundFuel extraReturnFuel fuelSellPriceTry outboundKm outboundWeight outboundRate returnKm returnWeight returnRate emptyKm emptyRate idleFuel".split(" ");
  const currencies = ["IRT", "TRY", "USD", "EUR", "AZN"];
  function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(number, 1e12) : 0;
  }
  function rate(state, currency) {
    if (currency === "IRT") return 1;
    return currencies.includes(currency) ? amount(state.rates?.[currency]) : 0;
  }
  function convert(state, value, currency) {
    return amount(value) * rate(state, currency);
  }
  function total(state, entries = []) {
    return entries.reduce((sum, entry) => sum + convert(state, entry.amount, entry.currency), 0);
  }
    function calculate(state) {
      state = {...state};
      for (const field of fields) state[field] = amount(state[field]);
      const outboundFuel = (state.outboundKm * state.outboundRate) / 100;
      const returnFuel = (state.returnKm * state.returnRate) / 100;
      const emptyFuel = (state.emptyKm * state.emptyRate) / 100;
      const idleFuel = state.idleFuel;
      const totalConsumed = outboundFuel + returnFuel + emptyFuel + idleFuel;

      const rawCompanyQuota = Number(state.companyQuota) || 0;
      const extraOutboundFuel = Math.max(0, Number(state.extraOutboundFuel) || 0);
      const extraReturnFuel = Math.max(0, Number(state.extraReturnFuel) || 0);
      const extraRouteFuel = extraOutboundFuel + extraReturnFuel;
      const effectiveCompanyQuota = Math.max(0, rawCompanyQuota - extraRouteFuel);

      const remainingFuel = state.initialFuel - totalConsumed;
      const personalQuota = Math.max(0, state.initialFuel - effectiveCompanyQuota);
      const companySurplus = effectiveCompanyQuota - totalConsumed;

      const sellableCompanyLiters = Math.max(0, Math.min(companySurplus, remainingFuel));
      const companyValueTry = sellableCompanyLiters * state.fuelSellPriceTry;
      const companyValueToman = convert(state, companyValueTry, "TRY");

      const effectivePersonalLiters = Math.max(0, remainingFuel - sellableCompanyLiters);
      const personalValueTry = effectivePersonalLiters * state.fuelSellPriceTry;
      const personalValueToman = convert(state, personalValueTry, "TRY");

      const totalRemainingValueToman = convert(state, Math.max(0, remainingFuel) * state.fuelSellPriceTry, "TRY");

      const totalExpensesToman = total(state, state.tripExpenses);
      const borderCostsToman = total(state, state.borderFuelItems);
      return {
        totalExpensesToman, borderCostsToman,
        netPayoutToman: personalValueToman - totalExpensesToman,
        outboundFuel,
        returnFuel,
        emptyFuel,
        idleFuel,
        totalConsumed,
        extraOutboundFuel,
        extraReturnFuel,
        extraRouteFuel,
        effectiveCompanyQuota,
        remainingFuel,
        personalQuota,
        companySurplus,
        sellableCompanyLiters,
        companyValueTry,
        companyValueToman,
        effectivePersonalLiters,
        personalValueTry,
        personalValueToman,
        totalRemainingValueToman
      };
    }


  const engine = { fields, currencies, amount, rate, convert, calculate };
  if (typeof module !== "undefined") module.exports = engine;
  else globalThis.TransitCalc = engine;
})();
