import { BASE_CHECKS } from "./constants";
import { limitsFor } from "./limits";
import { checksInMonth } from "./paychecks";
import type {
  Adjustment,
  Alloc,
  Debt,
  Derived,
  FundKey,
  MonthRow,
  PlanEvent,
  PlanResult,
  PlanSettings,
  PlanState,
  SimulateOptions,
} from "./types";
import { addMonths, monthsBetween, num, sum } from "./util";

/** Id of the synthetic debt created when a short month runs past your cash. */
export const SHORTFALL_ID = "shortfall";
/** Rate used for that debt when you have no credit card listed. */
export const DEFAULT_CARD_APR = 0.22;

/**
 * Whether a debt is paid off early in the "high-interest" step. A 401(k) loan never is: its
 * interest goes back into your own 401(k), so it waits for the low-interest step.
 */
export function isHighInterest(d: Pick<Debt, "apr" | "kind">, threshold: number): boolean {
  return d.kind !== "k401_loan" && d.apr >= threshold;
}

/** Whether the plan puts extra money toward this debt (false = minimum payments only). */
export const paysExtra = (d: Pick<Debt, "minimumOnly">): boolean => !d.minimumOnly;

/** The rate a debt charges in a given month ("YYYY-MM"): its promo rate through `promoUntil`, else its APR. */
export function rateIn(d: Pick<Debt, "apr" | "promoApr" | "promoUntil">, month: string): number {
  return d.promoUntil && month <= d.promoUntil ? Math.max(0, num(d.promoApr)) : d.apr;
}

/**
 * Take-home cost of $1 more 401(k): pre-tax dollars save tax (1 − marginal), Roth dollars don't (1).
 * `rothShare` is the part of contributions that go to Roth.
 */
export const k401Cost = (marginalTax: number, rothShare = 0): number => 1 - marginalTax * (1 - Math.min(1, Math.max(0, rothShare)));

/**
 * Month-by-month cash flow + priority waterfall, starting at `d.start`.
 *
 * Each month: income by real paydays x (1 + raises)^year; debts accrue APR/12 then
 * minimums are paid; `avail = income - budget - minimums + whatif.extra` is poured
 * down `plan.steps`. Leftover goes to cash; a negative month draws from cash.
 */
export function simulatePlan(s: PlanState, d: Derived, opts: SimulateOptions = {}): PlanResult {
  const p: Partial<PlanSettings> = s.plan ?? {};
  const mode = opts.mode || p.projectWith || "plan";
  const extraMonthly = (opts.extraMonthly ?? (s.whatif && s.whatif.extra)) || 0;
  const months = Math.max(opts.months || 0, d.years * 12, 36);
  const y0 = d.start.getFullYear();
  const mo0 = d.start.getMonth();
  const mt = Math.min(0.6, Math.max(0, num(p.marginalTax)));
  const cg = num(s.contribGrowth);
  const thr = num(p.highApr) || 0.07;

  let cash = d.bal.cash;
  const debts: Debt[] = (s.debts ?? []).map((x) => ({
    ...x,
    balance: num(x.balance),
    apr: num(x.apr),
    minPayment: num(x.minPayment),
  }));
  const goals = (s.goals ?? []).map((g) => ({
    ...g,
    saved: num(g.saved),
    target: num(g.target),
    recurring: g.recurring && num(g.recurring.every) > 0 ? { ...g.recurring, every: Math.round(num(g.recurring.every)) } : undefined,
  }));

  // one-off adjustments, by "YYYY-MM"
  // emergency mode: waterfall paused (and optionally essentials-only spending / no payroll 401(k)) through 'until'
  const em = s.emergency?.active ? s.emergency : null;
  const essentialBudget = sum((s.budget ?? []).filter((b) => b.essential !== false).map((b) => b.amount));

  const adjByMonth = new Map<string, Adjustment[]>();
  for (const a of s.adjustments ?? []) adjByMonth.set(a.month, [...(adjByMonth.get(a.month) ?? []), a]);
  // a short month beyond your cash goes on a card at your card's rate (highest card APR, else a typical 22%)
  const cardAprs = debts.filter((x) => x.kind === "credit_card" && x.apr > 0).map((x) => x.apr);
  const cardApr = cardAprs.length ? Math.max(...cardAprs) : DEFAULT_CARD_APR;
  const efBase = d.monthlyExpenses;

  // Scheduled payroll 401(k) per month (before the annual cap), so the waterfall can
  // leave room for the paychecks still to come this year.
  const schedPre = Array.from({ length: months }, (_, m) => {
    const absMo = mo0 + m;
    const g = Math.pow(1 + cg, Math.floor(m / 12));
    return sum(d.incomes.map((inc) => num(inc.pretax) * checksInMonth(inc, y0 + Math.floor(absMo / 12), absMo % 12) * g));
  });
  const starterTarget = num(p.starterEF);
  const fullTarget = num(p.efMonths) * efBase;
  let ytd = { k401: 0, ira: 0, hsa: 0 };
  let scale = (12 - mo0) / 12; // first year: prorate caps for the months left
  const order = p.steps ?? [];
  const out: MonthRow[] = [];
  const events: PlanEvent[] = [];
  const seen = new Set<string>();
  const mark = (key: string, m: number, text: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      events.push({ m, key, text });
    }
  };
  const firstFund: Partial<Record<FundKey, number>> = {};
  const maxedYears: PlanResult["maxedYears"] = { k401: [], ira: [], hsa: [] };

  for (let m = 0; m < months; m++) {
    const absMo = mo0 + m;
    const y = y0 + Math.floor(absMo / 12);
    const mo = absMo % 12;
    if (mo === 0 && m > 0) {
      ytd = { k401: 0, ira: 0, hsa: 0 };
      scale = 1;
    }
    const L = limitsFor(s.limits, y);
    const g = Math.pow(1 + cg, Math.floor(m / 12));
    const ageNow = d.age + m / 12;

    let income = 0;
    let payPre = 0;
    let payMatch = 0;
    let payRoth = 0;
    let extraCheck = false;
    const checks: number[] = [];
    for (const inc of d.incomes) {
      const c = checksInMonth(inc, y, mo);
      checks.push(c);
      if (c > BASE_CHECKS[inc.freq] + 1e-9 && Number.isInteger(c)) extraCheck = true;
      income += num(inc.net) * c * g;
      payPre += num(inc.pretax) * c * g;
      payMatch += num(inc.match) * c * g;
      payRoth += num(inc.pretax) * c * g * Math.min(1, Math.max(0, num(inc.rothShare)));
    }
    // a payroll 401(k) dollar that stops comes back as take-home: after tax if it was pre-tax, in full if Roth
    const backCost = k401Cost(mt, payPre > 0 ? payRoth / payPre : 0);

    // Payroll deferrals stop at the annual 401(k) limit (as real payroll does). The
    // deferral that no longer happens comes back as take-home, after tax, and the
    // employer match on it stops too (no year-end true-up assumed).
    const capK401Full = (L.k401 + (ageNow >= 50 ? L.k401Catch : 0)) * scale;
    const payRoom = Math.max(0, capK401Full - ytd.k401);
    let payCut = 0;
    if (payPre > payRoom) {
      payCut = payPre - payRoom;
      payMatch *= payRoom / payPre;
      payRoth *= payRoom / payPre;
      payPre = payRoom;
      income += payCut * backCost;
    }
    const monthStr = y + "-" + String(mo + 1).padStart(2, "0");
    const inEmergency = !!em && monthStr <= em.until;
    if (inEmergency && em!.pause401k && payPre > 0) {
      // stopping payroll 401(k) puts it back in the paycheck (after tax); the match stops with it
      income += payPre * backCost;
      payPre = 0;
      payMatch = 0;
      payRoth = 0;
    }
    ytd.k401 += payPre;

    // employer HSA contributions count toward the year's HSA limit
    const capHsaFull = ((p.hsaFamily ? L.hsaFamily : L.hsaSelf) + (ageNow >= 55 ? L.hsaCatch : 0)) * scale;
    const payHsaEmployer = Math.min(d.hsaEmployerAnnual / 12, Math.max(0, capHsaFull - ytd.hsa));
    ytd.hsa += payHsaEmployer;

    // one-off adjustments for this calendar month
    let adjIncome = 0;
    let adjExpense = 0;
    for (const a of adjByMonth.get(`${y}-${String(mo + 1).padStart(2, "0")}`) ?? []) {
      const v = Math.max(0, num(a.amount));
      if (a.kind === "expense") adjExpense += v;
      else if (a.kind === "incomeLoss") adjIncome -= v;
      else if (a.kind === "incomeGain") adjIncome += v;
    }
    income += adjIncome;
    let futurePre = 0;
    for (let k = m + 1; k < months && (mo0 + k) % 12 !== 0; k++) futurePre += schedPre[k]!;

    // debts: interest, then minimums (paid from the budget)
    let minPay = 0;
    // a payroll-repaid debt (paycheck 401(k) loan) is already out of take-home; once it is
    // paid off the deduction stops, and that money comes back as take-home
    let payrollFreed = 0;
    for (const dt of debts) {
      if (dt.balance <= 0) {
        if (dt.payroll) payrollFreed += dt.minPayment;
        continue;
      }
      dt.balance *= 1 + rateIn(dt, monthStr) / 12;
      // borrowed shortfall behaves like a card: minimum is 2% of the balance (at least $25)
      const minimum = dt.id === SHORTFALL_ID ? Math.max(25, dt.balance * 0.02) : dt.minPayment;
      const pay = Math.min(minimum, dt.balance);
      dt.balance -= pay;
      if (dt.payroll) payrollFreed += minimum - pay;
      else minPay += pay;
    }
    income += payrollFreed;
    // recurring goals: set aside what's still needed ÷ months left (so a late start catches up),
    // spend it in the due month, then start again for the next due date
    let setAside = 0;
    for (const gl of goals) {
      const r = gl.recurring;
      if (!r || gl.target <= 0) continue;
      while (r.due < monthStr) r.due = addMonths(r.due, r.every); // a due date already past
      const put = Math.max(0, gl.target - gl.saved) / (monthsBetween(monthStr, r.due) + 1);
      gl.saved += put;
      setAside += put;
      if (r.due === monthStr) {
        gl.saved = Math.max(0, gl.saved - gl.target);
        r.due = addMonths(r.due, r.every);
      }
    }
    const expenses = (inEmergency && em!.essentialsOnly ? essentialBudget : d.budgetTotal) + minPay + adjExpense + setAside;
    let avail = income - expenses + extraMonthly;
    const alloc: Alloc = {
      k401: 0, k401TakeHome: 0, k401Step: 0, matchGain: 0,
      ira: 0, taxable: 0, ef: 0, debt: 0, hsa: 0, goals: 0, leftover: 0,
    };
    let shortfall = 0;
    let borrowed = 0;
    if (avail < 0) {
      // a short month draws on cash first; anything beyond that goes on a credit card
      shortfall = -avail;
      const fromCash = Math.min(shortfall, Math.max(0, cash));
      cash -= fromCash;
      borrowed = shortfall - fromCash;
      if (borrowed > 0) {
        let card = debts.find((x) => x.id === SHORTFALL_ID);
        if (!card) {
          card = { id: SHORTFALL_ID, name: "Emergency credit card balance", kind: "credit_card", balance: 0, apr: cardApr, minPayment: 0 };
          debts.push(card);
        }
        card.balance += borrowed;
        mark("borrowed", m, "Short month put on a credit card");
      }
      avail = 0;
    }

    // Room for extra 401(k) this month: what's left of the cap after the payroll
    // deferrals already scheduled for the rest of this calendar year.
    const capK401 = Math.max(0, capK401Full - ytd.k401 - futurePre);
    const capIra = Math.max(0, (L.ira + (ageNow >= 50 ? L.iraCatch : 0)) * scale - ytd.ira);
    const capHsa = p.hsaEligible ? Math.max(0, capHsaFull - ytd.hsa) : 0;

    const payDebts = (filter: (x: Debt) => boolean) => {
      // avalanche by the rate charged now (a 0% promo waits); minimum-only debts get nothing extra
      const list = debts.filter((x) => x.balance > 0 && paysExtra(x) && filter(x)).sort((a, b) => rateIn(b, monthStr) - rateIn(a, monthStr));
      for (const dt of list) {
        if (avail <= 0) break;
        const put = Math.min(avail, dt.balance);
        dt.balance -= put;
        avail -= put;
        alloc.debt += put;
      }
    };

    if (inEmergency) {
      // emergency: keep everything left over as cash (debt minimums were already paid)
    } else if (mode === "current") {
      let inv = Math.min(avail, num(s.currentInvestMonthly) + extraMonthly);
      const toIra = Math.min(inv, capIra);
      alloc.ira += toIra;
      ytd.ira += toIra;
      inv -= toIra;
      avail -= toIra;
      alloc.taxable += inv;
      avail -= inv;
    } else {
      for (const step of order) {
        if (avail <= 1e-9) break;
        if (step === "starterEF" || step === "fullEF") {
          const tgt = step === "starterEF" ? starterTarget : fullTarget;
          const put = Math.min(avail, Math.max(0, tgt - cash));
          cash += put;
          avail -= put;
          alloc.ef += put;
        } else if (step === "match") {
          // raise payroll 401(k) to the full-match threshold; a pre-tax $ costs (1 - marginal) take-home, a Roth $ costs $1
          const cost = k401Cost(mt, d.rothShare);
          d.incomes.forEach((inc, i) => {
            if (avail <= 1e-9 || inc.gapPre <= 0) return;
            const gapPre = inc.gapPre * checks[i]! * g;
            const gapMatch = inc.gapMatch * checks[i]! * g;
            const room = Math.max(0, capK401 * cost - alloc.k401TakeHome);
            const need = Math.min(gapPre * cost, room);
            const put = Math.min(avail, need);
            if (put <= 0) return;
            const frac = put / (gapPre * cost);
            alloc.k401TakeHome += put;
            alloc.k401 += put / cost;
            ytd.k401 += put / cost;
            alloc.matchGain += gapMatch * frac;
            avail -= put;
          });
        } else if (step === "highDebt") payDebts((x) => isHighInterest(x, thr));
        else if (step === "lowDebt") payDebts((x) => !isHighInterest(x, thr));
        else if (step === "hsa") {
          const put = Math.min(avail, capHsa);
          alloc.hsa += put;
          ytd.hsa += put;
          avail -= put;
        } else if (step === "ira") {
          const put = Math.min(avail, capIra);
          alloc.ira += put;
          ytd.ira += put;
          avail -= put;
        } else if (step === "k401") {
          const cost = k401Cost(mt, d.rothShare); // $1 of pre-tax 401(k) costs (1 - marginal rate) of take-home; Roth costs $1
          const put = Math.min(avail, Math.max(0, capK401 * cost - alloc.k401TakeHome));
          alloc.k401TakeHome += put;
          alloc.k401Step += put;
          alloc.k401 += put / cost;
          ytd.k401 += put / cost;
          avail -= put;
        } else if (step === "taxable") {
          alloc.taxable += avail;
          avail = 0;
        } else if (step.startsWith("goal:")) {
          const gl = goals.find((x) => "goal:" + x.id === step);
          if (gl && !gl.recurring) {
            const put = Math.min(avail, Math.max(0, gl.target - gl.saved));
            gl.saved += put;
            avail -= put;
            alloc.goals += put;
          }
        }
      }
    }
    alloc.leftover = avail;
    cash += avail;

    // milestones / events
    if (starterTarget > 0 && cash >= starterTarget - 0.5) mark("starterEF", m, "Starter emergency fund done");
    if (fullTarget > 0 && cash >= fullTarget - 0.5) mark("fullEF", m, `Emergency fund full (${num(p.efMonths)} months)`);
    for (const dt of debts) {
      const startedOwing = dt.id === SHORTFALL_ID || num((s.debts ?? []).find((x) => x.id === dt.id)?.balance) > 0;
      if (dt.balance <= 0.5 && startedOwing) mark("debt:" + dt.id, m, `${dt.name} paid off`);
    }
    if (debts.length && debts.every((x) => x.balance <= 0.5)) mark("debtFree", m, "Debt-free");
    for (const gl of goals) if (!gl.recurring && gl.target > 0 && gl.saved >= gl.target - 0.5) mark("goal:" + gl.id, m, `${gl.name} goal reached`);
    for (const k of ["hsa", "ira", "taxable"] as const) if (alloc[k] > 0.5 && firstFund[k] === undefined) firstFund[k] = m;
    if (alloc.k401Step > 0.5 && firstFund.k401 === undefined) firstFund.k401 = m;
    if (alloc.matchGain > 0.5) mark("match", m, "Full employer match captured");
    if (mo === 11 || m === months - 1) {
      if (ytd.k401 >= capK401Full - 1) maxedYears.k401.push(y);
      if (ytd.ira >= (L.ira + (ageNow >= 50 ? L.iraCatch : 0)) * scale - 1) maxedYears.ira.push(y);
      if (p.hsaEligible && ytd.hsa >= ((p.hsaFamily ? L.hsaFamily : L.hsaSelf) + (ageNow >= 55 ? L.hsaCatch : 0)) * scale - 1) {
        maxedYears.hsa.push(y);
      }
    }

    out.push({
      m, y, mo, income, checks, extraCheck, expenses, minPay, payPre, payMatch, payRoth, payHsaEmployer, setAside, payCut, adjIncome, adjExpense, shortfall, borrowed, emergency: inEmergency,
      alloc,
      cash,
      debtTotal: sum(debts.map((x) => x.balance)),
      goals: goals.map((x) => ({ id: x.id, saved: x.saved })),
      pre: payPre - payRoth + payMatch + alloc.k401 * (1 - d.rothShare) + alloc.matchGain,
      post: payRoth + alloc.k401 * d.rothShare + payHsaEmployer + alloc.hsa + alloc.ira + alloc.taxable,
    });
  }
  return { months: out, events, firstFund, maxedYears, starterTarget, fullTarget, mode };
}
