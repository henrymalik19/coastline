/**
 * Every account the plan adds to, like a spreadsheet: what goes in each month (and from where), this
 * year against the limit, and the balance ahead. View only: monthly amounts are set under Money →
 * Monthly savings (and paychecks under Income).
 */
import { accountForecasts, mergeAccountSchedules, BUCKET_LABELS, scheduleAmount, type AccountForecast, type AccountKey, type PlanState, type RunResult, type ScheduleEntry } from "@coastfi/engine";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { debtLabel } from "../lib/debts";
import { money, monthLabel } from "../lib/format";
import { useStore } from "../lib/store";
import { radius, space, type, useTheme } from "../lib/theme";
import { Button, IconButton, NumberInput } from "./form";
import { Icon } from "./Icon";
import { ScheduleEditor } from "./ScheduleEditor";
import { useLayout } from "../lib/layout";
import { ProgressBar } from "./ProgressRing";
import { Card, Divider, SectionLabel } from "./ui";

type Props = {
  state: PlanState; o: RunResult; start: Date;
  /** Fill the height it's given (the table scrolls inside). */
  fill?: boolean;
  /** Start on this account (from the overview). */
  initialPick?: string;
};

// thin, quiet scrollbars for the table (web)
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("ledger-css")) {
  const el = document.createElement("style");
  el.id = "ledger-css";
  el.textContent = "[data-ledger]{scrollbar-width:none;-ms-overflow-style:none}[data-ledger]::-webkit-scrollbar{display:none}";
  document.head.appendChild(el);
}

const ym = (start: Date, m: number) => {
  const dt = new Date(start.getFullYear(), start.getMonth() + m, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (key: string) => `${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export function AccountsForecast({ state, o, start, fill, initialPick }: Props) {
  const t = useTheme();
  const update = useStore((s) => s.update);
  const router = useRouter();
  const [sel, setSel] = useState<AccountKey | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const gridRef = useRef<unknown>(null);
  const hRef = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const xRef = useRef(0);
  const { twoColumn, contentWidth } = useLayout();
  // phones: narrower columns, one "left over" column for the plan, details in place of the table
  const compact = contentWidth < 600;
  const [span, setSpan] = useState(12);
  const pl = o.plan;
  const d = o.d;
  const all = accountForecasts(state, d, pl, d.r);
  // each account's own amount, added up by kind (what the plan uses)
  const merged = { ...state.plan, ...mergeAccountSchedules(state) };
  const schedule = merged.schedule ?? {};
  const oneOffs = merged.scheduleMonths ?? {};
  const coastM = o.crossing === null ? null : Math.round(o.crossing * 12);
  const retireM = Math.min(pl.months.length, d.years * 12) - 1;
  const thisMonth = ym(start, 0);

  const payrollHsa = state.plan.hsaPayroll !== false;
  /** Accounts you can put on a schedule (the 401(k) and a paycheck HSA are set per paycheck). */
  const schedulable = (k: AccountKey) => k !== "k401" && k !== "other" && !(k === "hsa" && payrollHsa);
  const label = (k: AccountKey) => {
    if (k === "cash") return "Cash (emergency fund)";
    if (k.startsWith("debt:")) {
      const x = state.debts.find((y) => "debt:" + y.id === k);
      return x ? `${debtLabel(x)} (what you owe)` : "Debt";
    }
    if (k.startsWith("goal:")) return `Goal: ${state.goals.find((g) => "goal:" + g.id === k)?.name ?? "Goal"}`;
    if (k === "ira") return "IRA";
    if (k === "other") return "Other investments";
    return BUCKET_LABELS[k as "k401" | "hsa" | "taxable"];
  };

  const sorted = (list: ScheduleEntry[]) => [...list].sort((a, b) => (a.from < b.from ? -1 : 1));
  const planText = (k: AccountKey) => {
    const list = sorted(schedule[k] ?? []);
    if (!list.length) return "Your plan: follows your steps";
    return "Your plan: " + list.map((e) => `${money(e.amount)}/mo from ${monthName(e.from)}`).join(" → ");
  };

  // show accounts that have money or get some in the next two years
  const shown = all.filter((a) => a.start > 0.5 || a.months.slice(0, 24).some((m) => m.total > 0.5) || (schedule[a.key]?.length ?? 0) > 0);
  // which account the table shows: one at a time (phones start there), or all side by side
  const [pickRaw, setPick] = useState<string | null>(initialPick ?? null);
  const [picking, setPicking] = useState(false);
  const pick = pickRaw === "all" || (pickRaw && shown.some((a) => a.key === pickRaw)) ? pickRaw : compact ? shown[0]?.key ?? "all" : "all";
  const cols = pick === "all" ? shown : shown.filter((a) => a.key === pick);
  const isDebt = (k: AccountKey) => k.startsWith("debt:");

  const parts = (m: { paycheck: number; plan: number; employer: number; loan: number }, k: AccountKey) =>
    [
      m.loan > 0.5 ? `${money(m.loan)} 401(k) loan repayment (back into your account, not toward the limit)` : "",
      m.paycheck > 0.5 ? `${money(m.paycheck)} from your paychecks` : "",
      m.plan > 0.5 ? `${m.paycheck > 0.5 ? "+" : ""}${money(m.plan)} ${k === "k401" || (k === "hsa" && payrollHsa) ? "more per check from the plan" : "from what's left"}` : "",
      m.employer > 0.5 ? `${money(m.employer)} from your employer` : "",
    ].filter(Boolean).join(" · ");

  /** The amount for a month (accent when it's a one-month change). */
  const amountCell = (a: AccountForecast, i: number, width: number) => {
    const k = a.key;
    const m = a.months[i]!;
    const month = ym(start, i);
    const changed = oneOffs[k]?.[month] !== undefined;
    const value = isDebt(k) ? m.paycheck + m.plan : m.total;
    return <Text style={[type.caption, { color: changed ? t.accent : t.text, fontWeight: changed ? "700" : "500", width, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{money(value)}</Text>;
  };

  /* ---------- an account's details (opened from its column) ---------- */
  const card = (a: AccountForecast) => {
    const k = a.key;
    const m0a = a.months[0]!;
    const debt = isDebt(k);
    const y0 = start.getFullYear();
    const thisYear = a.years.find((y) => y.year === y0);
    const c = state.contributed && state.contributed.year === y0 ? state.contributed : undefined;
    const before = start.getMonth() === 0 ? 0 : k === "k401" ? c?.k401 ?? pl.ytdBefore?.k401 ?? 0 : k === "hsa" ? c?.hsa ?? pl.ytdBefore?.hsa ?? 0 : k === "ira" ? c?.ira ?? 0 : 0;
    const yearIn = thisYear ? (k === "hsa" ? thisYear.total : thisYear.employee) + before : 0;
    const guessed = start.getMonth() > 0 && !c && (k === "k401" || k === "hsa" || k === "ira");
    const at = (m: number) => a.months[Math.max(0, Math.min(a.months.length - 1, m))]!.balance;
    const points: { label: string; v: number }[] = [{ label: "Today", v: a.start }, { label: "In 1 year", v: at(11) }];
    if (a.invested) {
      if (coastM !== null && coastM > 12) points.push({ label: `Coast FI (${monthLabel(start, coastM)})`, v: at(coastM) });
      points.push({ label: `At ${d.retireAge}`, v: at(retireM) });
    }
    const paidOff = debt ? a.months.findIndex((m) => m.balance <= 0.5) : -1;
    const many = a.accounts.length > 1 || (a.accounts.length === 1 && a.accounts[0]!.name.trim() && a.accounts[0]!.name.trim() !== label(k));
    return (
      <View key={k}>
        <View style={{ padding: compact ? space.md : space.lg, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text style={[type.body, { color: t.text, fontWeight: "700", flex: 1 }]}>{label(k)}</Text>
            {compact ? (
              <Pressable role="button" accessibilityLabel="Back to the table" onPress={() => setSel(null)} hitSlop={8} style={styles.link}>
                <Icon name="back" size={14} color={t.accent} />
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Table</Text>
              </Pressable>
            ) : (
              <IconButton icon="close" label={`Close ${label(k)}`} onPress={() => setSel(null)} />
            )}
          </View>
          {many ? (
            <Text style={[type.caption, { color: t.text3 }]}>
              Today is {a.accounts.map((x) => `${x.name.trim() || "Unnamed account"} ${money(x.balance)}`).join(" + ")}.{k === "cash" ? "" : " Wrong account here? Change what it counts as under Money → Accounts."}
            </Text>
          ) : null}
          {schedulable(k) ? (
            <>
              <Text style={[type.caption, { color: schedule[k]?.length ? t.accent : t.text2, fontWeight: "700" }]}>
                {schedule[k]?.length ? planText(k).replace("Your plan: ", "Monthly amount: ") : "Monthly amount: none set, so it gets what your steps give it"}
              </Text>
              <Pressable role="link" onPress={() => router.push("/budget")} hitSlop={6} style={styles.link}>
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Change it (Budget tab)</Text>
                <Icon name="chevron" size={12} color={t.accent} />
              </Pressable>
            </>
          ) : (
            <Pressable role="link" onPress={() => router.push(k === "other" ? "/money/accounts" : "/money/income")} hitSlop={6} style={styles.link}>
              <Text style={[type.caption, { color: t.accent, fontWeight: "700", flexShrink: 1 }]}>
                {k === "other"
                  ? "The plan doesn't add to these. Change what an account counts as (Money → Accounts)"
                  : (() => {
                      const per = state.incomes.filter((x) => (x.kind ?? "job") === "job").map((x) => ({ name: x.name || "your job", v: k === "k401" ? x.pretax ?? 0 : x.hsaPre ?? 0 })).filter((x) => x.v > 0);
                      return `Your plan: set per paycheck${per.length ? ` (${per.map((x) => `${x.name} ${money(x.v)}/check`).join(", ")})` : ""}. Change it on your job (Money → Income)`;
                    })()}
              </Text>
              <Icon name="chevron" size={12} color={t.accent} />
            </Pressable>
          )}
          <Text style={[type.caption, { color: t.text2 }]}>
            <Text style={{ color: t.text, fontWeight: "600" }}>This month: {debt ? `${money(m0a.paycheck + m0a.plan)} paid` : money(m0a.total)}</Text>
            {m0a.total > 0.5 && !debt && k !== "cash" ? ` (${parts(m0a, k)})` : ""}
            {debt && m0a.paycheck + m0a.plan > 0.5 ? ` (${money(m0a.paycheck)} minimum${state.debts.find((x) => "debt:" + x.id === k)?.payroll ? " from your paychecks" : ""}${m0a.plan > 0.5 ? ` + ${money(m0a.plan)} extra` : ""})` : ""}
            {m0a.total <= 0.5 ? (() => { const f = a.months.findIndex((m) => m.total > 0.5); return f > 0 ? ` · starts ${monthLabel(start, f)}` : ""; })() : ""}
          </Text>
          {(() => {
            // a paycheck account on a job with no payday date: paychecks are averaged, so no 3-paycheck months
            if (k !== "k401" && k !== "hsa") return null;
            const uses = state.incomes.filter((x) => (x.kind ?? "job") === "job" && (k === "k401" ? (x.pretax ?? 0) > 0 : (x.hsaPre ?? 0) > 0));
            const missing = uses.filter((x) => (x.freq === "biweekly" || x.freq === "weekly") && !x.nextPayday);
            return missing.length ? (
              <Text style={[type.caption, { color: t.warn }]}>
                Add {missing.map((x) => x.name || "your job").join(" and ")}'s next payday (Money → Income) to see its 3-paycheck months. Until then its paychecks are spread evenly over the year.
              </Text>
            ) : null;
          })()}
          {thisYear?.limit ? (
            <View style={{ gap: 4, maxWidth: 360 }}>
              <Text style={[type.caption, { color: t.text2 }]}>
                {y0}: {money(yearIn)} of the {money(thisYear.limit)} limit{k === "hsa" ? " (yours + employer's)" : ""}
                {guessed ? (k === "ira" ? " · add what you've put in this year (Money → Accounts)" : " · counts this year's earlier paychecks at today's amounts") : ""}
              </Text>
              <ProgressBar progress={Math.min(1, yearIn / thisYear.limit)} color={t.good} />
            </View>
          ) : null}
          <View style={styles.points}>
            {points.map((p) => (
              <View key={p.label} style={{ minWidth: 92 }}>
                <Text style={[type.caption, { color: t.text3 }]}>{p.label}</Text>
                <Text style={[type.label, { color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{money(p.v)}</Text>
              </View>
            ))}
            {paidOff >= 0 ? (
              <View style={{ minWidth: 92 }}>
                <Text style={[type.caption, { color: t.text3 }]}>Paid off</Text>
                <Text style={[type.label, { color: t.good, fontWeight: "700" }]}>{paidOff === 0 ? "This month" : monthLabel(start, paidOff)}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[type.caption, { color: t.text3 }]}>
            {schedulable(k) ? "" : "Set per paycheck, so it's steady."}
            {k === "cash" ? " Cash also collects anything not given to a step." : ""}
            {a.invested ? ` Balances grow at your assumed ${(d.r * 100).toFixed(1)}% return after inflation.` : ""}
          </Text>
        </View>
      </View>
    );
  };

  /* ---------- the table: months down, accounts across ---------- */
  const COL = compact ? 84 : 108;
  /** "Nov 2026", or "Nov '26" on phones. */
  const mLabel = (i: number) => (compact ? monthLabel(start, i).replace(/ \d\d(\d\d)$/, " '$1") : monthLabel(start, i));
  /* ---------- this month: what's set elsewhere, your plan, and what's not planned (or short) ---------- */
  const row0 = pl.months[0]!;
  const jobs = state.incomes.filter((x) => (x.kind ?? "job") === "job");
  const perCheck = (pick: (x: (typeof jobs)[number]) => number) => jobs.filter((x) => pick(x) > 0).map((x) => `${x.name || "your job"} ${money(pick(x))}/check`).join(", ");
  const loanDebts = state.debts.filter((x) => x.payroll && x.balance > 0);
  const escrowNow = state.debts.reduce((a, x) => a + (x.payroll ? 0 : Math.min(Math.max(0, x.escrow ?? 0), x.minPayment)), 0);
  const fromPay: { label: string; amount: number; where: string; href: string }[] = [
    { label: "401(k) from your paychecks", amount: row0.payPre, where: perCheck((x) => x.pretax ?? 0), href: "/money/income" },
    { label: "HSA from your paychecks", amount: row0.payHsa ?? 0, where: perCheck((x) => x.hsaPre ?? 0), href: "/money/income" },
    ...loanDebts.map((x) => ({ label: `${debtLabel(x)} from your paycheck`, amount: x.minPayment, where: "goes back into your 401(k)", href: "/money/debts" })),
  ].filter((x) => x.amount > 0.5);
  const mine = all
    .filter((a) => scheduleAmount(merged, a.key, thisMonth) !== undefined)
    .map((a) => ({ k: a.key, ask: scheduleAmount(merged, a.key, thisMonth)!, got: a.months[0]!.plan + (a.key === "cash" ? 0 : 0) }));
  const toSteps = all
    .filter((a) => scheduleAmount(merged, a.key, thisMonth) === undefined && a.months[0]!.plan > 0.5)
    .map((a) => ({ k: a.key, v: a.months[0]!.plan }));
  const notPlanned = Math.max(0, row0.available - row0.plannedGot);
  const shortMonths = pl.months.slice(0, 24).map((m, i) => ({ i, v: m.plannedShort })).filter((x) => x.v > 0.5);
  const line = (labelText: string, value: string, opts?: { strong?: boolean; color?: string; href?: string; hint?: string }) => (
    <View style={styles.checkLine}>
      <View style={{ flex: 1 }}>
        {opts?.href ? (
          <Pressable role="link" onPress={() => router.push(opts.href as never)} hitSlop={4}>
            <Text style={[type.caption, { color: t.text2, fontWeight: opts.strong ? "700" : "400" }]}>{labelText} <Text style={{ color: t.accent }}>›</Text></Text>
          </Pressable>
        ) : (
          <Text style={[type.caption, { color: opts?.strong ? t.text : t.text2, fontWeight: opts?.strong ? "700" : "400" }]}>{labelText}</Text>
        )}
        {opts?.hint ? <Text style={[type.caption, { color: t.text3 }]}>{opts.hint}</Text> : null}
      </View>
      <Text style={[opts?.strong ? type.label : type.caption, { color: opts?.color ?? t.text, fontWeight: opts?.strong ? "700" : "500", fontVariant: ["tabular-nums"] }]}>{value}</Text>
    </View>
  );
  const check = (
    <View style={[styles.check, { backgroundColor: t.surface2 }]}>
      <Text style={[type.overline, { color: t.text3 }]}>This month ({monthLabel(start, 0)})</Text>
      {fromPay.length ? (
        <>
          <Text style={[type.caption, { color: t.text3, marginTop: 2 }]}>Comes out of your paychecks first (set on your job, not from what's left)</Text>
          {fromPay.map((x) => line(x.label, money(x.amount), { href: x.href, hint: x.where || undefined }))}
          <View style={[styles.rule, { backgroundColor: t.border }]} />
        </>
      ) : null}
      {line("Take-home", money(row0.income))}
      {line("Budget", `− ${money(Math.max(0, row0.expenses - row0.minPay - row0.setAside))}`, { href: "/budget" })}
      {row0.minPay > 0.5 ? line("Debt payments", `− ${money(row0.minPay)}`, { href: "/money/debts", hint: escrowNow > 0.5 ? `includes ${money(escrowNow)} escrow` : undefined }) : null}
      {row0.setAside > 0.5 ? line("Set aside for recurring goals", `− ${money(row0.setAside)}`, { href: "/money/goals" }) : null}
      {line("Left after bills", money(row0.available), { strong: true, color: row0.available < 0 ? t.bad : t.text })}
      <View style={[styles.rule, { backgroundColor: t.border }]} />
      <Text style={[type.caption, { color: t.text3 }]}>Your plan</Text>
      {mine.length ? mine.map((x) => line(label(x.k).replace(" (what you owe)", isDebt(x.k) ? " (extra)" : ""), `− ${money(x.ask)}`)) : (
        <Text style={[type.caption, { color: t.text3 }]}>Nothing set yet. Assign amounts on the Budget tab.</Text>
      )}
      {row0.plannedShort > 0.5
        ? line("Short this month", money(-row0.plannedShort), { strong: true, color: t.bad, hint: "Your plan asks for more than is left after bills. Lower an amount, or move one to a later month." })
        : line("Not planned yet", money(notPlanned), { strong: true, color: t.good, hint: notPlanned > 0.5 ? (toSteps.length ? `Goes to your steps: ${toSteps.map((x) => `${label(x.k).replace(" (what you owe)", " (extra)")} ${money(x.v)}`).join(", ")}` : "Stays in cash") : undefined })}
      {shortMonths.length && !(shortMonths.length === 1 && shortMonths[0]!.i === 0) ? (
        <Text style={[type.caption, { color: t.bad }]}>
          Short later: {shortMonths.filter((x) => x.i > 0).slice(0, 4).map((x) => `${monthLabel(start, x.i)} by ${money(x.v)}`).join(", ")}{shortMonths.length > 5 ? "…" : ""}. See the table.
        </Text>
      ) : null}
    </View>
  );

  /* ---------- the table: months down, accounts across, header and month column stay put ---------- */
  const web = Platform.OS === "web";
  const stick = (st: object) => (web ? ({ position: "sticky", ...st } as object) : null);
  const MW = compact ? 70 : 104;
  const planCols = compact ? 1 : 3;
  const H1 = 30;
  const num = (v: string, color: string, w = COL, bold = false) => (
    <Text style={[type.caption, { width: w, paddingHorizontal: 8, textAlign: "right", color, fontWeight: bold ? "700" : "500", fontVariant: ["tabular-nums"] }]}>{v}</Text>
  );
  const groupEdge = { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.border };
  const monthCell = (content: React.ReactNode, bg: string, z = 1, now = false) => (
    <View style={[{ width: MW, paddingHorizontal: 8, justifyContent: "center", backgroundColor: bg, zIndex: z, borderLeftWidth: 3, borderLeftColor: now ? t.accent : "transparent" }, stick({ left: 0 })]}>{content}</View>
  );
  const head1 = (
    <View style={[styles.gr, { height: H1, backgroundColor: t.surface, zIndex: 3 }, stick({ top: 0 })]}>
      {monthCell(<Text style={[type.overline, { color: t.text3 }]}>Month</Text>, t.surface, 4)}
      <View style={[{ width: COL * planCols, justifyContent: "center" }, groupEdge]}>
        <Text numberOfLines={1} style={[type.overline, { color: t.text3, textAlign: "center" }]}>Your plan</Text>
      </View>
      {cols.map((x) => {
        const on = sel === x.key;
        const planned = (schedule[x.key]?.length ?? 0) > 0;
        return (
          <Pressable
            key={x.key}
            role="button"
            accessibilityLabel={`${label(x.key)}: plan and forecast`}
            onPress={() => setSel(on ? null : x.key)}
            style={[{ width: COL * 2, justifyContent: "center", paddingHorizontal: 6, backgroundColor: on ? t.accentSoft : t.surface }, groupEdge]}
          >
            <Text numberOfLines={1} style={[type.overline, { color: on || planned ? t.accent : t.text2, textAlign: "center", textDecorationLine: "underline", textDecorationColor: t.border }]}>
              {label(x.key).replace(" (what you owe)", "")}{planned ? " ●" : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  const head2 = (
    <View style={[styles.gr, { backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border, zIndex: 3 }, stick({ top: H1 })]}>
      {monthCell(<Text style={[type.caption, { color: t.text3 }]}> </Text>, t.surface, 4)}
      <View style={[{ flexDirection: "row" }, groupEdge]}>
        {compact ? null : num("Left after bills", t.text3)}
        {compact ? null : num("Planned", t.text3)}
        {num(compact ? "Left over" : "Not planned", t.text3)}
      </View>
      {cols.map((x) => (
        <View key={x.key} style={[{ flexDirection: "row" }, groupEdge]}>
          {num(isDebt(x.key) ? "Paid" : "In", t.text3)}
          {num(isDebt(x.key) ? "Owed" : "Balance", t.text3)}
        </View>
      ))}
    </View>
  );
  const todayRow = (
    <View style={[styles.gr, { backgroundColor: t.surface }]}>
      {monthCell(<Text style={[type.caption, { color: t.text3 }]}>Today</Text>, t.surface)}
      <View style={[{ width: COL * planCols }, groupEdge]} />
      {cols.map((x) => (
        <View key={x.key} style={[{ flexDirection: "row" }, groupEdge]}>
          {num("", t.text3)}
          {num(money(x.start), t.text2)}
        </View>
      ))}
    </View>
  );
  const bodyRows = Array.from({ length: span }, (_, i) => {
    const r = pl.months[i]!;
    const short = r.plannedShort > 0.5;
    const bg = short ? t.badSoft : i === 0 ? t.accentSoft : i % 2 ? t.surface2 : t.surface;
    return (
      <View key={i} style={[styles.gr, { backgroundColor: bg }]}>
        {monthCell(
          <Text style={[type.caption, { color: i === 0 ? t.text : t.text2, fontWeight: i === 0 ? "700" : "500" }]}>
            {mLabel(i)}
            {r.extraCheck ? <Text style={{ color: t.text3 }}> ·3</Text> : null}
            {i === 0 ? <Text style={{ color: t.accent, fontWeight: "700" }}>{"\n"}NOW</Text> : null}
          </Text>,
          bg,
          1,
          i === 0,
        )}
        <View style={[{ flexDirection: "row", alignItems: "center" }, groupEdge]}>
          {compact ? null : num(money(r.available), t.text2)}
          {compact ? null : num(r.plannedAsk > 0.5 ? money(r.plannedAsk) : "–", t.text2)}
          {num(short ? (compact ? `−${money(r.plannedShort)}` : `short ${money(r.plannedShort)}`) : money(Math.max(0, r.available - r.plannedGot)), short ? t.bad : t.good, COL, short)}
        </View>
        {cols.map((x) => (
          <View key={x.key} style={[{ flexDirection: "row", alignItems: "center" }, groupEdge]}>
            <View style={{ width: COL, paddingHorizontal: 8, alignItems: "flex-end" }}>{amountCell(x, i, COL - 16)}</View>
            {num(money(x.months[i]!.balance), t.text2)}
          </View>
        ))}
      </View>
    );
  });
  const gridInner = (
    <>
      {head1}
      {head2}
      {todayRow}
      {bodyRows}
    </>
  );
  // scroll the table sideways a couple of accounts at a time (the scrollbars are hidden)
  const step = COL * 4;
  const scrollSide = (dir: -1 | 1) => {
    if (web) {
      const el = gridRef.current as { scrollLeft: number; scrollWidth: number; clientWidth: number; scrollTo?: (o: object) => void } | null;
      if (!el) return;
      const by = Math.max(COL * 2, Math.min(step, el.clientWidth - MW - 16));
      const target = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + dir * by));
      el.scrollTo?.({ left: target, behavior: "smooth" });
      // some browsers skip smooth scrolling: make sure it lands
      setTimeout(() => { if (Math.abs(el.scrollLeft - target) > 2) el.scrollLeft = target; }, 450);
    } else {
      xRef.current = Math.max(0, xRef.current + dir * step);
      hRef.current?.scrollTo({ x: xRef.current, animated: true });
    }
  };
  const one = pick !== "all" ? cols[0] : undefined;
  const sCell = (v: string, color: string, bold = false) => (
    <Text numberOfLines={1} style={[type.caption, styles.sNum, { color, fontWeight: bold ? "700" : "500" }]}>{v}</Text>
  );
  const singleTable = one ? (
    <View style={[{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: "hidden", width: "100%", maxWidth: 720 }, fill ? { flex: 1, minHeight: 0 } : { maxHeight: 620 }]}>
      <View style={[styles.sRow, { backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border }]}>
        <Text style={[type.overline, styles.sMonth, { color: t.text3 }]}>Month</Text>
        <Text style={[type.overline, styles.sNum, { color: t.text3 }]}>{isDebt(one.key) ? "Paid" : "Added"}</Text>
        <Text style={[type.overline, styles.sNum, { color: t.text3 }]}>{isDebt(one.key) ? "Owed" : "Balance"}</Text>
        <Text style={[type.overline, styles.sNum, { color: t.text3 }]}>Left over</Text>
      </View>
      <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ flex: 1 }}>
        <View style={[styles.sRow, { backgroundColor: t.surface }]}>
          <Text style={[type.caption, styles.sMonth, { color: t.text3 }]}>Today</Text>
          {sCell("", t.text3)}
          {sCell(money(one.start), t.text2, true)}
          {sCell("", t.text3)}
        </View>
        {Array.from({ length: span }, (_, i) => {
          const r = pl.months[i]!;
          const m = one.months[i]!;
          const short = r.plannedShort > 0.5;
          const changed = oneOffs[one.key]?.[ym(start, i)] !== undefined;
          // a 401(k) loan repaid goes back in: shown apart from what you and your employer put in
          const loan = !isDebt(one.key) ? m.loan : 0;
          const added = isDebt(one.key) ? m.paycheck + m.plan : m.total - loan;
          return (
            <View key={i} style={[styles.sRow, { backgroundColor: short ? t.badSoft : i === 0 ? t.accentSoft : i % 2 ? t.surface2 : t.surface, borderLeftWidth: 3, borderLeftColor: i === 0 ? t.accent : "transparent", paddingLeft: 9 }]}>
              <Text style={[type.caption, styles.sMonth, { color: i === 0 ? t.text : t.text2, fontWeight: i === 0 ? "700" : "500" }]}>
                {mLabel(i)}
                {r.extraCheck ? <Text style={{ color: t.accent }}> ·3</Text> : null}
                {i === 0 ? <Text style={{ color: t.accent, fontWeight: "700" }}>{"\n"}NOW</Text> : null}
              </Text>
              {loan > 0.5 ? (
                <View style={[styles.sNum, { alignItems: "flex-end" }]}>
                  <Text numberOfLines={1} style={[type.caption, { color: changed ? t.accent : t.text, fontWeight: changed ? "700" : "500", fontVariant: ["tabular-nums"] }]}>{money(added)}</Text>
                  <Text numberOfLines={1} style={[type.caption, { color: t.text3, fontSize: 11, fontVariant: ["tabular-nums"] }]}>+{money(loan)} loan</Text>
                </View>
              ) : (
                sCell(added > 0.5 ? money(added) : "–", changed ? t.accent : added > 0.5 ? t.text : t.text3, changed)
              )}
              {sCell(money(m.balance), t.text, true)}
              {sCell(short ? `−${money(r.plannedShort)}` : money(Math.max(0, r.available - r.plannedGot)), short ? t.bad : t.text3, short)}
            </View>
          );
        })}
      </ScrollView>
    </View>
  ) : null;
  const grid = web ? (
    <View
      ref={gridRef as never}
      {...({ dataSet: { ledger: "1" } } as object)}
      style={[{ overflow: "auto" as never, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border }, fill ? { flex: 1, minHeight: 0 } : { maxHeight: 620 }]}
    >
      <View style={{ alignSelf: "flex-start" }}>{gridInner}</View>
    </View>
  ) : (
    <ScrollView style={fill ? { flex: 1 } : { maxHeight: 620 }}>
      <ScrollView horizontal ref={hRef as never} onScroll={(e) => { xRef.current = e.nativeEvent.contentOffset.x; }} scrollEventThrottle={64}>
        <View>{gridInner}</View>
      </ScrollView>
    </ScrollView>
  );
  const selected = sel ? shown.find((a) => a.key === sel) ?? null : null;
  const panel = selected ? (
    <ScrollView
      {...({ dataSet: { ledger: "1" } } as object)}
      style={compact ? { flex: 1, minHeight: 0 } : twoColumn ? { width: 400, flexGrow: 0, flexShrink: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.border } : { maxHeight: 360, flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }}
    >
      {card(selected)}
    </ScrollView>
  ) : null;
  const summary = (
    <Pressable
      role="button"
      aria-expanded={showCheck}
      accessibilityLabel={`${monthLabel(start, 0)}: ${money(row0.available)} left after bills, ${money(row0.plannedAsk)} planned, ${row0.plannedShort > 0.5 ? `short ${money(row0.plannedShort)}` : `${money(notPlanned)} not planned`}. ${showCheck ? "Hide" : "Show"} details`}
      onPress={() => setShowCheck((v) => !v)}
      hitSlop={4}
      style={[styles.summary, { backgroundColor: row0.plannedShort > 0.5 ? t.badSoft : t.surface2 }]}
    >
      {[
        { k: "Left after bills", v: money(row0.available, { whole: compact }), c: t.text },
        { k: "Planned", v: money(row0.plannedAsk, { whole: compact }), c: t.text },
        row0.plannedShort > 0.5
          ? { k: "Short", v: money(row0.plannedShort, { whole: compact }), c: t.bad }
          : { k: "Not planned", v: money(notPlanned, { whole: compact }), c: t.good },
      ].map((x) => (
        <View key={x.k} style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.caption, { color: t.text3 }]} numberOfLines={1}>{x.k}</Text>
          <Text style={[type.label, { color: x.c, fontWeight: "700", fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{x.v}</Text>
        </View>
      ))}
      <View style={{ transform: [{ rotate: showCheck ? "-90deg" : "90deg" }] }}>
        <Icon name="chevron" size={14} color={t.accent} />
      </View>
    </Pressable>
  );
  return (
    <Card padded={false} style={fill ? { flex: 1, minHeight: 0, overflow: "hidden" } : undefined}>
      <View style={{ padding: compact ? space.sm : space.md, gap: space.sm }}>
        {compact && selected ? null : (
          <View style={[styles.editRow, { justifyContent: "space-between" }]}>
            <View style={[styles.editRow, compact ? { flex: 1, flexWrap: "nowrap" } : null]}>
              {compact ? null : <SectionLabel>Forecast</SectionLabel>}
              <Pressable
                role="button"
                aria-haspopup="listbox"
                accessibilityLabel={`Account: ${pick === "all" ? "All accounts" : label(pick as AccountKey)}. Change`}
                onPress={() => setPicking(true)}
                hitSlop={4}
                style={[styles.picker, { borderColor: t.border, backgroundColor: t.surface2 }, compact ? { flex: 1 } : null]}
              >
                <Text numberOfLines={1} style={[type.caption, { color: t.text, fontWeight: "700", flexShrink: 1 }]}>
                  {pick === "all" ? `All accounts (${shown.length})` : label(pick as AccountKey).replace(" (what you owe)", "").replace(" (emergency fund)", "")}
                </Text>
                <Icon name="down" size={14} color={t.text2} />
              </Pressable>
              <Pressable role="link" accessibilityLabel="Set monthly amounts (Budget tab)" onPress={() => router.push("/budget")} hitSlop={6} style={[styles.chip, { borderColor: t.accent, backgroundColor: t.accentSoft, flexDirection: "row", alignItems: "center", gap: 4 }]}>
                <Icon name="plus" size={12} color={t.accent} />
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{compact ? "Set" : "Set amounts"}</Text>
              </Pressable>
            </View>
            <View style={[styles.editRow, compact ? { flexWrap: "nowrap", gap: 6 } : null]}>
              {pick === "all" ? (
                <View style={[styles.arrows, { borderColor: t.border }]}>
                  <Pressable role="button" accessibilityLabel="Scroll the table left" onPress={() => scrollSide(-1)} hitSlop={4} style={styles.arrow}>
                    <Icon name="back" size={16} color={t.accent} />
                  </Pressable>
                  <View style={{ width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: t.border }} />
                  <Pressable role="button" accessibilityLabel="Scroll the table right" onPress={() => scrollSide(1)} hitSlop={4} style={styles.arrow}>
                    <Icon name="chevron" size={16} color={t.accent} />
                  </Pressable>
                </View>
              ) : null}
              {[12, 24, 36, 60].map((n) => (
                <Pressable key={n} role="radio" aria-checked={span === n} onPress={() => setSpan(n)} hitSlop={6} style={[styles.chip, { borderColor: span === n ? t.accent : t.border, backgroundColor: span === n ? t.accentSoft : t.surface }]}>
                  <Text style={[type.caption, { color: span === n ? t.accent : t.text2, fontWeight: "700" }]}>{compact ? `${n / 12}y` : `${n} mo`}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
          <Pressable style={styles.backdrop} onPress={() => setPicking(false)} accessibilityLabel="Close the account list">
            <Pressable onPress={() => {}} aria-label="Show which account" style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={[type.overline, { color: t.text3, paddingHorizontal: space.md, paddingBottom: 4 }]}>Show</Text>
              <ScrollView style={{ maxHeight: 440 }}>
                {[{ key: "all", name: "All accounts, side by side", sub: `${shown.length} accounts` }, ...shown.map((x) => ({ key: x.key as string, name: label(x.key).replace(" (what you owe)", ""), sub: `${isDebt(x.key) ? "Owed" : "Today"} ${money(x.start)}${(schedule[x.key]?.length ?? 0) > 0 ? " · has a monthly amount" : ""}` }))].map((o) => {
                  const on = pick === o.key;
                  return (
                    <Pressable
                      key={o.key}
                      role="option"
                      aria-selected={on}
                      onPress={() => { setPick(o.key); setSel(null); setPicking(false); }}
                      style={({ pressed }) => [styles.option, { backgroundColor: on ? t.accentSoft : pressed ? t.surface2 : "transparent" }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[type.body, { color: on ? t.accent : t.text, fontWeight: on ? "700" : "500" }]}>{o.name}</Text>
                        <Text style={[type.caption, { color: t.text3 }]}>{o.sub}</Text>
                      </View>
                      {on ? <Icon name="check" size={16} color={t.accent} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
        {summary}
        {showCheck ? (
          <ScrollView {...({ dataSet: { ledger: "1" } } as object)} style={{ maxHeight: 340, flexGrow: 0 }}>{check}</ScrollView>
        ) : null}
        {!selected ? (
          <View style={styles.key}>
            <View style={styles.keyItem}>
              <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>·3</Text>
              <Text style={[type.caption, { color: t.text3 }]}>3 paychecks</Text>
            </View>
            <View style={styles.keyItem}>
              <View style={[styles.keySwatch, { backgroundColor: t.badSoft, borderColor: t.bad }]} />
              <Text style={[type.caption, { color: t.text3 }]}>Short</Text>
            </View>
            {shortMonths.some((x) => x.i > 0) ? <Text style={[type.caption, { color: t.bad, fontWeight: "700" }]}>Short later</Text> : null}
            <View style={{ flex: 1 }} />
            {one ? (
              <Pressable role="link" onPress={() => setSel(one.key)} hitSlop={6} style={styles.keyItem}>
                <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>Details</Text>
                <Icon name="chevron" size={12} color={t.accent} />
              </Pressable>
            ) : (
              <Text style={[type.caption, { color: t.text3 }]}>Tap a name for details</Text>
            )}
          </View>
        ) : null}
      </View>
      <View style={[{ flexDirection: twoColumn ? "row" : "column" }, fill ? { flex: 1, minHeight: 0 } : null]}>
        {!twoColumn && !compact ? panel : null}
        {compact && panel ? (
          panel
        ) : (
          <View style={[{ paddingHorizontal: compact ? space.sm : space.md, paddingBottom: compact ? space.sm : space.md, gap: space.sm }, fill ? { flex: 1, minHeight: 0 } : null]}>
            {one ? singleTable : grid}
          </View>
        )}
        {twoColumn ? panel : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  points: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, marginTop: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  sched: { borderRadius: radius.md, padding: space.sm, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 2 },
  editRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  editor: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: space.sm },
  tr: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 5 },
  monthCol: { width: 92 },
  picker: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, minWidth: 0, maxWidth: 280 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: space.lg },
  sheet: { width: "100%", maxWidth: 380, borderRadius: radius.lg, borderWidth: 1, paddingVertical: space.md },
  option: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 10 },
  sRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, minHeight: 38, gap: 8 },
  sMonth: { width: 78 },
  sNum: { flex: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  arrows: { flexDirection: "row", borderWidth: 1, borderRadius: 999, overflow: "hidden" },
  arrow: { paddingHorizontal: 12, paddingVertical: 5, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8 },
  key: { flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" },
  keyItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  keySwatch: { width: 10, height: 10, borderRadius: 2, borderWidth: 1 },
  gr: { flexDirection: "row", alignItems: "stretch", minHeight: 32 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  check: { borderRadius: radius.md, padding: space.md, gap: 3 },
  checkLine: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingVertical: 1 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
