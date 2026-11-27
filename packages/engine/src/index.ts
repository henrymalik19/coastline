/**
 * @coastfi/engine: pure Coast FI math (port of reference/engine.js).
 * No I/O, no clock: pass `startDate` in. Money in today's dollars, returns real.
 */
export * from "./types";
export { PERIODS, BASE_CHECKS, FICA, STEP_LABELS, BUCKETS, BUCKET_LABELS, type Bucket } from "./constants";
export { checksInMonth } from "./paychecks";
export { matchFor, rentalMonthly, resolveIncome } from "./match";
export { limitsFor, DEFAULT_LIMITS } from "./limits";
export { derive } from "./derive";
export { simulatePlan, scheduleAmount, isHighInterest, paysExtra, rateIn, k401Cost, nextDue, setAsideFor, SHORTFALL_ID, DEFAULT_CARD_APR } from "./plan";
export { project, fireNumber, coastNumberAt, coastCrossing } from "./project";
export { investFromTakeHome } from "./schedule";
export { accountPlanKey, isKeptRentalDebt, keptRental, rentInRetirement, isRentalDebt, isSpouseIra, isSpendingItem, linkedAccount, linkedItemSchedules, budgetScheduleMonths, mergeAccountSchedules, payPerCheck, valueIn, hsaEligibleIn, isValueKey, ACCOUNT_KEY, PAY401, PAYHSA, PAYGROSS, PAYNET, PAYDED, HSAEMP, BUDGET_ITEM, HSA_ELIGIBLE } from "./schedule";
export { isHistoryTxn, isUpcoming, averageSpent, registerBalance, transferPair, txnActivity, type TxnActivity } from "./txn";
export { SAVINGS_GROUP, START_TXN, budgetCategories, budgetStartCash, budgetView, isStartTxn, spendingHistory, startTxnId, type BudgetCategory, type BudgetCategoryKind, type BudgetLine, type BudgetView } from "./budget";
export { accountForecasts, accountGroup, type AccountForecast, type AccountMonth, type AccountYear, type AccountKey } from "./forecast";
export { monteCarlo } from "./montecarlo";
export { run, finalAndFire, MC_SEED } from "./run";
export { ACCESS_AGE, earlyAccess, type EarlyAccess } from "./early";
export { extraToCoastBy, extraToRetire, investingNow, investingSplit, investingStarts, type InvestingSplit, monthlyGrowthFactor, mortgagePayoffs, retireAgeOnPlan, type MortgagePayoff } from "./howTo";
export { amortize, loanPayment, loanSchedule, mortgageBridge, mortgagesAtRetirement, scheduledPayment, type DebtAtRetirement, type LoanSchedule } from "./mortgage";
export { addMonths, monthsBetween, mulberry32 } from "./util";
export { DISPLAY_INFLATION, nominalReturn, inFutureDollars } from "./inflation";
export { fireBreakdown, fiLevels, baristaFi, FAT_FACTOR, type FireBreakdown, type FiLevel, type SpendingLine } from "./breakdown";
export { spendingByMonth, spendingByYear, type PeriodSpending, type YearSpending } from "./years";
