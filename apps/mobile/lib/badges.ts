/** Badges and levels (Home's rewards card and the Badges page). The streak comes from lib/history.ts. */
import type { PlanState, RunResult } from "@coastfi/engine";
import { money } from "./format";
import type { Streak } from "./history";

export type Badge = { key: string; title: string; icon: string; desc: string; got: boolean; eta: number | null };

export function badgeList(s: PlanState, o: RunResult, streak: Streak): Badge[] {
  const d = o.d;
  const pl = o.plan;
  const ev = (k: string) => pl.events.find((e) => e.key === k)?.m ?? null;
  const B: Badge[] = [];
  const bal = (v: number, title: string, icon: string, desc: string) =>
    B.push({ key: `bal${v}`, title, icon, desc, got: d.invested >= v, eta: d.invested >= v ? null : o.whenBalance(v) });
  bal(10_000, "First $10k", "🌱", "Invested $10,000");
  bal(50_000, "$50k club", "🪴", "Invested $50,000");
  bal(100_000, "The hardest $100k", "🌳", "Compounding starts doing real work");
  bal(250_000, "Quarter million", "🏔️", "Invested $250,000");
  bal(500_000, "Half a million", "🚀", "Invested $500,000");
  bal(1_000_000, "Millionaire", "💎", "Invested $1,000,000");
  for (const f of [0.25, 0.5, 0.75]) {
    B.push({ key: `coast${f}`, title: `Coast ${f * 100}%`, icon: f === 0.25 ? "🧭" : f === 0.5 ? "⛵" : "🌊", desc: `${f * 100}% of today's Coast FI number`, got: o.progress >= f, eta: o.progress >= f ? null : o.whenCoastPct(f) });
  }
  B.push({ key: "coast", title: "Coast FI", icon: "🎯", desc: "Growth alone gets you to FIRE", got: o.progress >= 1, eta: o.progress >= 1 ? null : o.crossing !== null ? Math.round(o.crossing * 12) : null });
  B.push({ key: "fi", title: "Fully FI", icon: "🏁", desc: "Invested at least your FIRE number", got: o.progressFire >= 1, eta: o.progressFire >= 1 ? null : o.whenBalance(o.fire) });
  // an empty plan has no emergency fund target yet: "$0 of $0" isn't a badge
  const sef = pl.starterTarget > 0.5 && d.bal.cash >= pl.starterTarget;
  B.push({ key: "sef", title: "Safety net", icon: "🛟", desc: "Starter emergency fund", got: sef, eta: sef ? null : ev("starterEF") });
  const fef = pl.fullTarget > 0.5 && d.bal.cash >= pl.fullTarget;
  B.push({ key: "fef", title: "Fortress", icon: "🏰", desc: `${s.plan.efMonths}-month emergency fund`, got: fef, eta: fef ? null : ev("fullEF") });
  if (s.debts.length) {
    const free = s.debts.every((x) => (+x.balance || 0) <= 0);
    B.push({ key: "debtfree", title: "Debt-free", icon: "🔓", desc: "Every debt paid off", got: free, eta: free ? null : ev("debtFree") });
  }
  for (const g of s.goals) {
    const done = g.saved >= g.target;
    B.push({ key: `goal${g.id}`, title: g.name, icon: "🏆", desc: `Goal: ${money(g.target)}`, got: done, eta: done ? null : ev("goal:" + g.id) });
  }
  const mxI = pl.maxedYears.ira[0];
  B.push({ key: "ira", title: "Maxed IRA", icon: "📈", desc: "Hit the IRA limit for a year", got: false, eta: mxI ? (mxI - d.start.getFullYear()) * 12 + 11 - d.start.getMonth() : null });
  for (const n of [3, 6, 12]) B.push({ key: `streak${n}`, title: `${n}-month streak`, icon: n === 12 ? "🔥" : "📅", desc: streak.kind === "budget" ? `${n} months in a row within budget` : `${n} months in a row kept up to date`, got: streak.n >= n, eta: null });
  return B;
}
