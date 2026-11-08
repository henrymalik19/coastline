/**
 * Sharing with a household member (PLAN.md §10). The owner invites someone by email and picks which
 * budget accounts (cards) they use. The member signs in with that email and adds transactions to those
 * accounts only (row-level security enforces it). They never read the plan: the owner's device
 * publishes a small view of this month's categories and what's available in each.
 */
import { budgetCategories, budgetView, derive, run, simulatePlan, type Txn } from "@coastfi/engine";
import { TxnSchema } from "@coastfi/schema";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { effectivePlan } from "./plan";
import { budgetAccounts, cardMap } from "./register";
import { monthKey, useStore } from "./store";
import { supabase } from "./supabase";

/** What a member sees, published by the owner's device. */
export type MemberView = {
  /** When it was published (ms). The member's own changes after this are added on top. */
  at: number;
  /** "YYYY-MM" */
  month: string;
  accounts: { id: string; name: string; kind: "cash" | "card" }[];
  categories: { key: string; name: string; group: string; available: number }[];
};

export type MemberRow = {
  owner_id: string;
  email: string;
  name: string | null;
  member_id: string | null;
  joined_at: string | null;
  accounts: string[];
  view: MemberView | null;
};

const missingTable = (e: unknown) => /PGRST205|PGRST202|42P01|42883|does not exist|Could not find/i.test(String((e as { message?: string })?.message ?? "") + String((e as { code?: string })?.code ?? ""));

/** What sharing shows and allows, said the same way on both sides. */
export const SHARE_RULES = {
  sees: [
    "The names of the shared cards (not their balances)",
    "Every transaction on those cards, whoever added it",
    "Spending and bill categories, with what's left this month in each",
  ],
  does: ["Add purchases and refunds on the shared cards", "Change or delete purchases they added"],
  cant: [
    "Balances, income or other accounts",
    "The plan: Coast FI, retirement accounts, forecast or priorities",
    "How much is assigned to each category, or savings categories",
    "Move money between categories, transfer or split",
    "Change or delete transactions someone else added",
  ],
} as const;

/* ---------- the owner's side ---------- */

export const useSharing = create<{ members: MemberRow[]; available: boolean; error?: string }>(() => ({ members: [], available: true }));

/** Load the people you've invited. */
export async function loadMembers(): Promise<void> {
  if (!supabase) return;
  const res = await supabase.from("plan_members").select("owner_id, email, name, member_id, joined_at, accounts, view").eq("owner_id", (await supabase.auth.getUser()).data.user?.id ?? "");
  if (res.error) {
    useSharing.setState(missingTable(res.error) ? { available: false, members: [] } : { error: res.error.message });
    return;
  }
  useSharing.setState({ members: (res.data ?? []) as MemberRow[], available: true, error: undefined });
}

export async function inviteMember(email: string, name: string, accounts: string[]): Promise<void> {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("That doesn't look like an email address.");
  if (clean === useSyncEmail()) throw new Error("That's your own email.");
  const res = await supabase.from("plan_members").insert({ email: clean, name: name.trim() || null, accounts });
  if (res.error) throw new Error(/duplicate|unique/i.test(res.error.message) ? "That email is already invited (here or to another plan)." : res.error.message);
  await loadMembers();
  await publishViews(true);
}

export async function updateMember(email: string, patch: { name?: string | null; accounts?: string[] }): Promise<void> {
  if (!supabase) return;
  const res = await supabase.from("plan_members").update(patch).eq("email", email);
  if (res.error) throw new Error(res.error.message);
  await loadMembers();
  await publishViews(true);
}

export async function removeMember(email: string): Promise<void> {
  if (!supabase) return;
  const res = await supabase.from("plan_members").delete().eq("email", email);
  if (res.error) throw new Error(res.error.message);
  await loadMembers();
}

let signedInEmail = "";
const useSyncEmail = () => signedInEmail;

/** This month's view for a member: their accounts, and each category with what's available. */
export function memberView(accountIds: string[], now = new Date()): MemberView {
  const { plan, txns } = useStore.getState();
  const state = effectivePlan(plan);
  const result = run(state, now);
  const real = state.whatif?.extra ? { ...state, whatif: { extra: 0, retDelta: 0, spendDelta: 0 } } : state;
  const actual = state.whatif?.extra ? simulatePlan(real, derive(real, now)) : result.plan;
  const month = monthKey(now);
  const accounts = budgetAccounts(state).filter((a) => accountIds.includes(a.id)).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
  if (!state.budgetPlan) return { at: Date.now(), month, accounts, categories: [] };
  const cats = budgetCategories(state, result.d, actual, now, month).filter((c) => c.kind === "spending" || c.kind === "bill");
  const v = budgetView(state.budgetPlan, cats, month, { txns, cards: cardMap(state) });
  const categories = cats.map((c) => ({ key: c.key, name: c.name, group: c.group, available: Math.round((v.lines[c.key]?.available ?? 0) * 100) / 100 }));
  return { at: Date.now(), month, accounts, categories };
}

const published = new Map<string, string>();
let publishTimer: ReturnType<typeof setTimeout> | null = null;

/** Send each member their view, when it changed. Never throws (sharing is optional). */
export async function publishViews(now = false): Promise<void> {
  if (!now) {
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => void publishViews(true), 1200);
    return;
  }
  const { members, available } = useSharing.getState();
  if (!supabase || !available || !members.length || !useStore.getState().onboarded) return;
  for (const m of members) {
    try {
      const v = memberView(m.accounts);
      const key = JSON.stringify({ ...v, at: 0 });
      if (published.get(m.email) === key) continue;
      const res = await supabase.from("plan_members").update({ view: v }).eq("email", m.email);
      if (!res.error) published.set(m.email, key);
    } catch {
      // a bad plan shouldn't stop sync
    }
  }
}

/* ---------- the member's side ---------- */

type MemberState = {
  /** unknown until checked after sign-in */
  status: "unknown" | "none" | "member";
  row?: MemberRow;
  txns: Txn[];
  /** ids of the transactions the member added (the only ones they can edit) */
  mine: string[];
  error?: string;
};
export const useMembership = create<MemberState>(() => ({ status: "unknown", txns: [], mine: [] }));

type TxnRow = {
  id: string; account_id: string; date: string; amount: number | string; payee: string | null; memo: string | null;
  category_id: string | null; splits: Txn["splits"] | null; cleared: Txn["cleared"]; source: Txn["source"]; deleted: boolean; client_updated_at: number | string;
  created_by?: string | null;
};
const fromRow = (r: TxnRow): Txn | null => {
  const p = TxnSchema.safeParse({
    id: r.id, accountId: r.account_id, date: String(r.date).slice(0, 10), amount: Number(r.amount), payee: r.payee ?? undefined, memo: r.memo ?? undefined,
    categoryId: r.category_id ?? undefined, splits: r.splits ?? undefined, cleared: r.cleared, source: r.source, updatedAt: Number(r.client_updated_at), deleted: r.deleted || undefined,
  });
  return p.success ? p.data : null;
};

let memberChannel: RealtimeChannel | null = null;

async function loadMemberTxns(owner: string): Promise<void> {
  if (!supabase) return;
  const res = await supabase.from("transactions").select("*").eq("user_id", owner).order("date", { ascending: false }).limit(500);
  if (res.error) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  const rows = (res.data ?? []) as TxnRow[];
  useMembership.setState({
    txns: rows.map(fromRow).filter((x): x is Txn => !!x),
    mine: me ? rows.filter((r) => r.created_by === me).map((r) => r.id) : [],
  });
}

async function refreshMembership(): Promise<void> {
  if (!supabase) return;
  const res = await supabase.from("plan_members").select("owner_id, email, name, member_id, joined_at, accounts, view").eq("member_id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle<MemberRow>();
  if (!res.error && res.data) useMembership.setState({ row: res.data });
}

/** Save one of the member's transactions (new or edited) on the owner's plan. */
export async function saveMemberTxn(t: Txn): Promise<void> {
  const row = useMembership.getState().row;
  if (!supabase || !row) throw new Error("Not signed in to a shared plan.");
  const res = await supabase.from("transactions").upsert(
    {
      user_id: row.owner_id, id: t.id, account_id: t.accountId, date: t.date, amount: t.amount, payee: t.payee ?? null, memo: t.memo ?? null,
      category_id: t.categoryId ?? null, splits: null, transfer_account_id: null, transfer_id: null, cleared: t.cleared, source: "manual",
      import_id: null, deleted: !!t.deleted, client_updated_at: t.updatedAt,
    },
    { onConflict: "user_id,id" },
  );
  if (res.error) throw new Error(/row-level security/i.test(res.error.message) ? "You can only change purchases you added." : res.error.message);
  const { txns, mine } = useMembership.getState();
  useMembership.setState({ txns: [t, ...txns.filter((x) => x.id !== t.id)], mine: mine.includes(t.id) ? mine : [...mine, t.id] });
}

/**
 * What's available now in each category: the owner's last view, plus the member's own changes made
 * since then (the owner's device folds them in the next time it publishes).
 */
export function availableNow(view: MemberView, txns: Txn[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(view.categories.map((c) => [c.key, c.available]));
  for (const t of txns) {
    if (t.updatedAt <= view.at || !t.date.startsWith(view.month) || !t.categoryId || !(t.categoryId in out)) continue;
    if (!t.deleted) out[t.categoryId] = out[t.categoryId]! + t.amount;
  }
  return out;
}

/**
 * After sign-in: link any invite for this email, and load what the member needs. The owner's side
 * loads the people they've invited.
 */
export async function onSharingSignIn(userId: string, email: string | undefined): Promise<void> {
  if (!supabase) return;
  signedInEmail = (email ?? "").toLowerCase();
  const join = await supabase.rpc("member_join");
  if (join.error) {
    useMembership.setState({ status: "none" });
    if (missingTable(join.error)) useSharing.setState({ available: false });
    return;
  }
  const rows = (join.data ?? []) as MemberRow[];
  if (rows[0]) {
    const row = rows[0];
    useMembership.setState({ status: "member", row });
    await loadMemberTxns(row.owner_id);
    memberChannel?.unsubscribe();
    for (const c of supabase.getChannels()) if (c.topic === `realtime:member-${userId}`) void supabase.removeChannel(c);
    memberChannel = supabase
      .channel(`member-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_members", filter: `member_id=eq.${userId}` }, () => void refreshMembership())
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${row.owner_id}` }, () => void loadMemberTxns(row.owner_id))
      .subscribe();
  } else useMembership.setState({ status: "none" });
  await loadMembers();
}

export function onSharingSignOut(): void {
  memberChannel?.unsubscribe();
  memberChannel = null;
  signedInEmail = "";
  published.clear();
  useMembership.setState({ status: "unknown", row: undefined, txns: [], mine: [], error: undefined });
  useSharing.setState({ members: [], error: undefined });
}
