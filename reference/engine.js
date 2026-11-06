/*
 * Coast FI engine v2: pure functions, no DOM.
 * Browser: window.CoastEngine · Node: module.exports. Lift it into any app as-is.
 *
 * Conventions
 *  - All money in TODAY'S dollars; returns are REAL (after inflation).
 *    Contribution limits are held flat in real terms past the last year you enter.
 *  - `ret` = long-run compounded (geometric) real return = the MEDIAN path in the Monte Carlo.
 *  - Budget is monthly; paychecks land on their real dates, so biweekly pay produces
 *    two 3-check months a year (weekly: four 5-check months).
 */
(function (root) {
  const PERIODS = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };
  const BASE_CHECKS = { weekly: 4, biweekly: 2, semimonthly: 2, monthly: 1 };
  const DAY = 86400000;

  const STEP_LABELS = {
    starterEF: "Starter emergency fund",
    match: "Get the full employer match",
    highDebt: "Pay off high-interest debt",
    fullEF: "Full emergency fund",
    hsa: "Max out HSA",
    ira: "Max out IRA",
    k401: "Max out 401(k)",
    lowDebt: "Pay down low-interest debt",
    taxable: "Invest in brokerage",
  };
  // Chart buckets, in the validated categorical slot order (stacking order).
  const BUCKETS = ["k401", "ira", "taxable", "ef", "debt", "hsa", "goals"];
  const BUCKET_LABELS = { k401: "401(k)", ira: "IRA", taxable: "Brokerage", ef: "Emergency fund", debt: "Extra debt payments", hsa: "HSA", goals: "Goals" };

  /* ---------- helpers ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const num = (v) => +v || 0;
  const sum = (xs) => xs.reduce((a, b) => a + num(b), 0);
  function pct(sorted, p) {
    const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }
  function parseDate(s) {
    if (!s) return null;
    const [y, m, d] = String(s).split("-").map(Number);
    return y && m && d ? Date.UTC(y, m - 1, d) : null;
  }

  /** Paychecks an income source lands in calendar month (y, mo). */
  function checksInMonth(inc, y, mo) {
    const f = inc.freq;
    if (f === "monthly") return 1;
    if (f === "semimonthly") return 2;
    const step = (f === "weekly" ? 7 : 14) * DAY;
    const anchor = parseDate(inc.nextPayday);
    if (anchor === null) return PERIODS[f] / 12; // unknown dates: average
    const a = Date.UTC(y, mo, 1), b = Date.UTC(y, mo + 1, 1);
    const first = anchor + Math.ceil((a - anchor) / step) * step;
    return first >= b ? 0 : Math.floor((b - 1 - first) / step) + 1;
  }

  /** Employer match in $ for a given contribution %, from a 2-tier formula
   *  (e.g. 100% of the first 3% + 50% of the next 2%). */
  function matchFor(gross, pct, inc) {
    const r1 = num(inc.matchRate1), u1 = num(inc.matchUpTo1), r2 = num(inc.matchRate2), u2 = num(inc.matchUpTo2);
    return gross * (r1 * Math.min(pct, u1) + r2 * Math.min(Math.max(pct - u1, 0), u2));
  }
  /** Per-check pre-tax, match, and the gap to the full match, from either % or $ entry. */
  function resolveIncome(inc) {
    if (inc.matchMode === "pct" && num(inc.gross) > 0) {
      const gross = num(inc.gross), pct = num(inc.contribPct);
      const maxPct = num(inc.matchUpTo1) + (num(inc.matchRate2) > 0 ? num(inc.matchUpTo2) : 0);
      const match = matchFor(gross, pct, inc);
      const fullMatchAmt = matchFor(gross, Math.max(pct, maxPct), inc);
      return {
        ...inc, pretax: gross * pct, match, maxPct,
        fullMatch: pct >= maxPct - 1e-9,
        gapPre: gross * Math.max(0, maxPct - pct), gapMatch: fullMatchAmt - match,
      };
    }
    return { ...inc, pretax: num(inc.pretax), match: num(inc.match), fullMatch: inc.fullMatch !== false, gapPre: 0, gapMatch: 0, maxPct: null };
  }

  /** Contribution limits for a calendar year: exact row, else the latest earlier row, else the earliest. */
  function limitsFor(limits, year) {
    const rows = [...(limits || [])].sort((a, b) => a.year - b.year);
    if (!rows.length) return { k401: 0, k401Catch: 0, ira: 0, iraCatch: 0, hsaSelf: 0, hsaFamily: 0, hsaCatch: 0 };
    let best = rows[0];
    for (const r of rows) if (r.year <= year) best = r;
    return best;
  }

  /* ---------- static summary of inputs ---------- */
  function derive(s, startDate) {
    const w = s.whatif || {};
    const start = startDate || new Date();
    const bal = { pretax: 0, roth: 0, taxable: 0, hsa: 0, cash: 0 };
    for (const a of s.accounts || []) bal[a.type] = (bal[a.type] || 0) + num(a.balance);
    const invested = bal.pretax + bal.roth + bal.taxable + bal.hsa;

    const incomes = (s.incomes || []).map(resolveIncome);
    const annualNet = sum(incomes.map((i) => num(i.net) * PERIODS[i.freq]));
    const leanMonthly = sum(incomes.map((i) => num(i.net) * BASE_CHECKS[i.freq]));
    const annualPre = sum(incomes.map((i) => num(i.pretax) * PERIODS[i.freq]));
    const annualMatch = sum(incomes.map((i) => num(i.match) * PERIODS[i.freq]));

    const budgetTotal = sum((s.budget || []).map((b) => b.amount));
    const debtMins = sum((s.debts || []).filter((d) => num(d.balance) > 0).map((d) => d.minPayment));
    const monthlyExpenses = budgetTotal + debtMins;

    const retireMonthly =
      (sum((s.budget || []).filter((b) => b.inRetirement).map((b) => b.amount)) + num(s.healthcare)) *
      (1 + (w.spendDelta || 0));
    const years = Math.max(0, Math.round(s.retireAge - s.age));

    return {
      start, age: s.age, retireAge: s.retireAge, years,
      r: s.ret - s.fee + (w.retDelta || 0), vol: s.vol, swr: s.swr, taxRate: s.taxRate,
      incomes, bal, invested, annualNet, avgMonthlyNet: annualNet / 12, leanMonthly,
      extraChecksPerYear: annualNet - leanMonthly * 12,
      annualPre, annualMatch, budgetTotal, debtMins, monthlyExpenses,
      retireMonthly, retireAnnual: retireMonthly * 12,
      emergencyMonths: monthlyExpenses > 0 ? bal.cash / monthlyExpenses : Infinity,
      debtTotal: sum((s.debts || []).map((d) => d.balance)),
      matchLeftPerYear: sum(incomes.map((i) => i.gapMatch * PERIODS[i.freq])),
    };
  }

  /* ---------- month-by-month cash-flow + priority plan ---------- */
  function simulatePlan(s, d, opts = {}) {
    const p = s.plan || {};
    const mode = opts.mode || p.projectWith || "plan";
    const extraMonthly = (opts.extraMonthly ?? (s.whatif && s.whatif.extra)) || 0;
    const months = Math.max(opts.months || 0, d.years * 12, 36);
    const y0 = d.start.getFullYear(), mo0 = d.start.getMonth();
    const mt = Math.min(0.6, Math.max(0, num(p.marginalTax)));
    const cg = num(s.contribGrowth);
    const thr = num(p.highApr) || 0.07;

    let cash = d.bal.cash;
    const debts = (s.debts || []).map((x) => ({ ...x, balance: num(x.balance), apr: num(x.apr), minPayment: num(x.minPayment) }));
    const goals = (s.goals || []).map((g) => ({ ...g, saved: num(g.saved), target: num(g.target) }));
    const efBase = d.monthlyExpenses;
    const starterTarget = num(p.starterEF);
    const fullTarget = num(p.efMonths) * efBase;
    let ytd = { k401: 0, ira: 0, hsa: 0 };
    let scale = (12 - mo0) / 12; // first year: prorate caps for months left
    const order = p.steps || [];
    const out = [];
    const events = [];
    const seen = new Set();
    const mark = (key, m, text) => { if (!seen.has(key)) { seen.add(key); events.push({ m, key, text }); } };
    const firstFund = {};
    const maxedYears = { k401: [], ira: [], hsa: [] };

    for (let m = 0; m < months; m++) {
      const absMo = mo0 + m, y = y0 + Math.floor(absMo / 12), mo = absMo % 12;
      if (mo === 0 && m > 0) { ytd = { k401: 0, ira: 0, hsa: 0 }; scale = 1; }
      const L = limitsFor(s.limits, y);
      const g = Math.pow(1 + cg, Math.floor(m / 12));
      const ageNow = d.age + m / 12;

      let income = 0, payPre = 0, payMatch = 0, extraCheck = false;
      const checks = [];
      for (const inc of d.incomes) {
        const c = checksInMonth(inc, y, mo);
        checks.push(c);
        if (c > BASE_CHECKS[inc.freq] + 1e-9 && Number.isInteger(c)) extraCheck = true;
        income += num(inc.net) * c * g;
        payPre += num(inc.pretax) * c * g;
        payMatch += num(inc.match) * c * g;
      }
      ytd.k401 += payPre;

      // debts: interest, then minimums (paid from the budget)
      let minPay = 0;
      for (const dt of debts) {
        if (dt.balance <= 0) continue;
        dt.balance *= 1 + dt.apr / 12;
        const pay = Math.min(dt.minPayment, dt.balance);
        dt.balance -= pay; minPay += pay;
      }
      const expenses = d.budgetTotal + minPay;
      let avail = income - expenses + extraMonthly;
      const alloc = { k401: 0, k401TakeHome: 0, k401Step: 0, matchGain: 0, ira: 0, taxable: 0, ef: 0, debt: 0, hsa: 0, goals: 0, leftover: 0 };
      let shortfall = 0;
      if (avail < 0) { shortfall = -avail; cash += avail; avail = 0; }

      const capK401 = Math.max(0, (L.k401 + (ageNow >= 50 ? L.k401Catch : 0)) * scale - ytd.k401);
      const capIra = Math.max(0, (L.ira + (ageNow >= 50 ? L.iraCatch : 0)) * scale - ytd.ira);
      const capHsa = p.hsaEligible
        ? Math.max(0, ((p.hsaFamily ? L.hsaFamily : L.hsaSelf) + (ageNow >= 55 ? L.hsaCatch : 0)) * scale - ytd.hsa) : 0;

      const payDebts = (filter) => {
        const list = debts.filter((x) => x.balance > 0 && filter(x)).sort((a, b) => b.apr - a.apr); // avalanche
        for (const dt of list) {
          if (avail <= 0) break;
          const put = Math.min(avail, dt.balance);
          dt.balance -= put; avail -= put; alloc.debt += put;
        }
      };

      if (mode === "current") {
        let inv = Math.min(avail, num(s.currentInvestMonthly) + extraMonthly);
        const toIra = Math.min(inv, capIra); alloc.ira += toIra; ytd.ira += toIra; inv -= toIra; avail -= toIra;
        alloc.taxable += inv; avail -= inv;
      } else {
        for (const step of order) {
          if (avail <= 1e-9) break;
          if (step === "starterEF" || step === "fullEF") {
            const tgt = step === "starterEF" ? starterTarget : fullTarget;
            const put = Math.min(avail, Math.max(0, tgt - cash));
            cash += put; avail -= put; alloc.ef += put;
          } else if (step === "match") {
            // raise payroll 401(k) up to the full-match threshold; costs (1 - marginal) take-home per pre-tax $
            const cost = 1 - mt;
            d.incomes.forEach((inc, i) => {
              if (avail <= 1e-9 || inc.gapPre <= 0) return;
              const gapPre = inc.gapPre * checks[i] * g, gapMatch = inc.gapMatch * checks[i] * g;
              const room = Math.max(0, capK401 * cost - alloc.k401TakeHome);
              const need = Math.min(gapPre * cost, room);
              const put = Math.min(avail, need);
              if (put <= 0) return;
              const frac = put / (gapPre * cost);
              alloc.k401TakeHome += put; alloc.k401 += put / cost; ytd.k401 += put / cost;
              alloc.matchGain += gapMatch * frac; avail -= put;
            });
          } else if (step === "highDebt") payDebts((x) => x.apr >= thr);
          else if (step === "lowDebt") payDebts((x) => x.apr < thr);
          else if (step === "hsa") { const put = Math.min(avail, capHsa); alloc.hsa += put; ytd.hsa += put; avail -= put; }
          else if (step === "ira") { const put = Math.min(avail, capIra); alloc.ira += put; ytd.ira += put; avail -= put; }
          else if (step === "k401") {
            const cost = 1 - mt; // $1 of pre-tax 401(k) costs (1 - marginal rate) of take-home
            const put = Math.min(avail, Math.max(0, capK401 * cost - alloc.k401TakeHome));
            alloc.k401TakeHome += put; alloc.k401Step += put; alloc.k401 += put / cost; ytd.k401 += put / cost; avail -= put;
          } else if (step === "taxable") { alloc.taxable += avail; avail = 0; }
          else if (step.startsWith("goal:")) {
            const gl = goals.find((x) => "goal:" + x.id === step);
            if (gl) { const put = Math.min(avail, Math.max(0, gl.target - gl.saved)); gl.saved += put; avail -= put; alloc.goals += put; }
          }
        }
      }
      alloc.leftover = avail; cash += avail;

      // milestones / events
      if (starterTarget > 0 && cash >= starterTarget - 0.5) mark("starterEF", m, "Starter emergency fund done");
      if (fullTarget > 0 && cash >= fullTarget - 0.5) mark("fullEF", m, `Emergency fund full (${num(p.efMonths)} months)`);
      for (const dt of debts) if (dt.balance <= 0.5 && num((s.debts || []).find((x) => x.id === dt.id)?.balance) > 0) mark("debt:" + dt.id, m, `${dt.name} paid off`);
      if (debts.length && debts.every((x) => x.balance <= 0.5)) mark("debtFree", m, "Debt-free");
      for (const gl of goals) if (gl.target > 0 && gl.saved >= gl.target - 0.5) mark("goal:" + gl.id, m, `${gl.name} goal reached`);
      for (const k of ["hsa", "ira", "taxable"]) if (alloc[k] > 0.5 && firstFund[k] === undefined) { firstFund[k] = m; }
      if (alloc.k401Step > 0.5 && firstFund.k401 === undefined) firstFund.k401 = m;
      if (alloc.matchGain > 0.5) mark("match", m, "Full employer match captured");
      if (mo === 11 || m === months - 1) {
        const capFull = (L.k401 + (ageNow >= 50 ? L.k401Catch : 0)) * scale;
        if (ytd.k401 >= capFull - 1) maxedYears.k401.push(y);
        if (ytd.ira >= (L.ira + (ageNow >= 50 ? L.iraCatch : 0)) * scale - 1) maxedYears.ira.push(y);
        if (p.hsaEligible && ytd.hsa >= ((p.hsaFamily ? L.hsaFamily : L.hsaSelf) + (ageNow >= 55 ? L.hsaCatch : 0)) * scale - 1) maxedYears.hsa.push(y);
      }

      out.push({
        m, y, mo, income, checks, extraCheck, expenses, minPay, payPre, payMatch, shortfall,
        alloc, cash, debtTotal: sum(debts.map((x) => x.balance)),
        goals: goals.map((x) => ({ id: x.id, saved: x.saved })),
        pre: payPre + payMatch + alloc.k401 + alloc.matchGain,
        post: alloc.hsa + alloc.ira + alloc.taxable,
      });
    }
    return { months: out, events, firstFund, maxedYears, starterTarget, fullTarget, mode };
  }

  /* ---------- projections ---------- */
  function project(d, plan, r) {
    const M = d.years * 12;
    const rm = Math.pow(1 + r, 1 / 12) - 1;
    let pre = d.bal.pretax, post = d.bal.roth + d.bal.taxable + d.bal.hsa;
    const series = new Float64Array(M + 1);
    series[0] = pre + post;
    for (let k = 1; k <= M; k++) {
      const mm = plan.months[k - 1];
      pre = pre * (1 + rm) + mm.pre;
      post = post * (1 + rm) + mm.post;
      series[k] = pre + post;
    }
    const total = pre + post;
    return { series, final: total, preShareFinal: total > 0 ? pre / total : 0 };
  }
  function fireNumber(d, preShare) { return d.retireAnnual / (1 - d.taxRate * preShare) / d.swr; }
  function coastNumberAt(fire, r, yearsLeft) { return fire / Math.pow(1 + r, Math.max(0, yearsLeft)); }
  function coastCrossing(proj, d, fire, r) {
    const M = d.years * 12;
    for (let k = 0; k <= M; k++) if (proj.series[k] >= coastNumberAt(fire, r, (M - k) / 12)) return k / 12;
    return null;
  }

  function monteCarlo(d, plan, r, fire, opts = {}) {
    const sims = opts.sims || 2000, rand = mulberry32(opts.seed || 1234);
    const m = Math.log(1 + r), s = d.vol, Y = d.years;
    const contrib = Array.from({ length: Y }, (_, y) => {
      let c = 0; for (let k = y * 12; k < y * 12 + 12; k++) c += plan.months[k].pre + plan.months[k].post; return c;
    });
    const byYear = Array.from({ length: Y + 1 }, () => new Float64Array(sims));
    let hit = 0, coastHit = 0;
    for (let i = 0; i < sims; i++) {
      let b = d.invested, cb = d.invested;
      byYear[0][i] = b;
      for (let y = 0; y < Y; y++) {
        const G = Math.exp(m + s * gaussian(rand));
        b = b * G + contrib[y] * Math.sqrt(G);
        cb = cb * G;
        byYear[y + 1][i] = b;
      }
      if (b >= fire) hit++;
      if (cb >= fire) coastHit++;
    }
    const bands = byYear.map((arr) => {
      const a = Array.from(arr).sort((x, y) => x - y);
      return { p10: pct(a, 0.1), p25: pct(a, 0.25), p50: pct(a, 0.5), p75: pct(a, 0.75), p90: pct(a, 0.9) };
    });
    return { bands, probFire: hit / sims, probCoastNow: coastHit / sims };
  }

  function coastOnly(s, startDate, extraMonthly) {
    const d = derive(s, startDate);
    const plan = simulatePlan(s, d, { extraMonthly });
    const proj = project(d, plan, d.r);
    const fire = fireNumber(d, proj.preShareFinal);
    return coastCrossing(proj, d, fire, d.r);
  }

  /** Everything the UI needs. */
  function run(s, startDate) {
    const d = derive(s, startDate);
    const plan = simulatePlan(s, d);
    const proj = project(d, plan, d.r);
    const fire = fireNumber(d, proj.preShareFinal);
    const coastNow = coastNumberAt(fire, d.r, d.years);
    const crossing = coastCrossing(proj, d, fire, d.r);
    const rCons = d.r - 0.015;
    const projC = project(d, plan, rCons);
    const fireC = fireNumber(d, projC.preShareFinal);
    const crossingC = coastCrossing(projC, d, fireC, rCons);
    const mc = d.years > 0 ? monteCarlo(d, plan, d.r, fire, { seed: 20261106 }) : { bands: [], probFire: d.invested >= fire ? 1 : 0, probCoastNow: d.invested >= fire ? 1 : 0 };
    const coastCurve = Array.from({ length: d.years + 1 }, (_, t) => coastNumberAt(fire, d.r, d.years - t));

    const baseExtra = (s.whatif && s.whatif.extra) || 0;
    const plus100 = coastOnly(s, startDate, baseExtra + 100);
    const altMode = simulatePlan(s, d, { mode: plan.mode === "plan" ? "current" : "plan" });
    const projAlt = project(d, altMode, d.r);

    // when does the deterministic path reach each balance / coast % milestone?
    const whenBalance = (target) => { for (let k = 0; k < proj.series.length; k++) if (proj.series[k] >= target) return k; return null; };
    const whenCoastPct = (f) => { const M = d.years * 12; for (let k = 0; k <= M; k++) if (proj.series[k] >= f * coastNumberAt(fire, d.r, (M - k) / 12)) return k; return null; };

    return {
      d, plan, fire, coastNow, crossing, rCons, fireC, crossingC, mc, coastCurve,
      preShareFinal: proj.preShareFinal, projectedFinal: proj.final, projSeries: proj.series,
      altFinal: projAlt.final, altMode: altMode.mode,
      progress: coastNow > 0 ? d.invested / coastNow : 0,
      progressFire: fire > 0 ? d.invested / fire : 0,
      freedomDays: d.retireAnnual > 0 ? d.invested / (d.retireAnnual / 365) : Infinity,
      coastSoonerMonths: crossing !== null && plus100 !== null ? Math.round((crossing - plus100) * 12) : null,
      whenBalance, whenCoastPct,
    };
  }

  const api = { resolveIncome, matchFor, PERIODS, BASE_CHECKS, STEP_LABELS, BUCKETS, BUCKET_LABELS, checksInMonth, limitsFor, derive, simulatePlan, project, fireNumber, coastNumberAt, coastCrossing, monteCarlo, run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CoastEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
