/**
 * @coastfi/engine: pure Coast FI math (port of reference/engine.js).
 * No I/O, no clock: pass `startDate` in. Money in today's dollars, returns real.
 */
export * from "./types";
export { PERIODS, BASE_CHECKS, STEP_LABELS, BUCKETS, BUCKET_LABELS, type Bucket } from "./constants";
export { checksInMonth } from "./paychecks";
export { matchFor, resolveIncome } from "./match";
export { limitsFor, DEFAULT_LIMITS } from "./limits";
export { derive } from "./derive";
export { simulatePlan, SHORTFALL_ID, DEFAULT_CARD_APR } from "./plan";
export { project, fireNumber, coastNumberAt, coastCrossing } from "./project";
export { monteCarlo } from "./montecarlo";
export { run, MC_SEED } from "./run";
export { mulberry32 } from "./util";
