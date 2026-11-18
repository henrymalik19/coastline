/**
 * A made-up YNAB export with the hard cases in it, for tests (lib/ynabComplex.test.ts) and for trying
 * the import by hand (scripts/ynab-complex-zip.mjs writes it as a zip). Today is 2026-11-18. Every
 * number YNAB would show is worked out in YNAB_SAYS below.
 *
 * October (last month, history): $5,000 in Checking and $2,000 in Savings to start, $3,000 pay. Rent
 * $1,500, groceries $200, dining $80 on the Rewards card, shopping $150 on it ($50 over, left on the card),
 * a $300 card payment. October ends with $7,050 ready to assign.
 *
 * November (this month):
 *  - pay $3,000; rent $1,500; a Costco split (groceries $90, gas $30); the gym $30 (a hidden category)
 *  - dining $60 and $50 on the card, then $30 in cash: $20 over, and the cash purchase took it past $0,
 *    so it's overspending in cash (next month's), not card debt
 *  - a flight $400 on the Travel card from Vacation; shopping $40 on the card, a $25 refund to Checking
 *  - $20 taken back out of Gas (a negative amount); $250 to the IRA (a tracking account), from IRA
 *  - $500 Checking → Savings; a $200 card payment; a $4 coffee with no category (cleared)
 *  - not approved in YNAB: Amazon $35 (Shopping) and a clinic $15 (no category), both uncleared
 *  - scheduled: next pay, $3,000 on Nov 25
 *  - an old store card, closed long ago: its payment line is a hidden category named like it
 *
 * Accounts as you'd have them before importing: "Checking Account" (YNAB's "Bank - Checking", renamed,
 * same balance) and "Bank - Savings" (YNAB's "Bank - Savings (Joint)").
 */

const R = (account: string, date: string, payee: string, group: string, category: string, memo: string, out: number, inflow: number, cleared: "Cleared" | "Uncleared" | "Reconciled") =>
  [account, "", date, payee, group && category ? `${group}: ${category}` : "", group, category, memo, `$${out.toFixed(2)}`, `$${inflow.toFixed(2)}`, cleared].map((x) => `"${x}"`).join(",");

const CHK = "Bank - Checking";
const SAV = "Bank - Savings (Joint)";
const RWD = "Card Co - Rewards";
const TRV = "Card Co - Travel";
const IRA = "Broker - IRA";
const OLD = "Old Store Card";
const RTA = ["Inflow", "Ready to Assign"] as const;

// newest first, as YNAB writes it
export const REGISTER = [
  `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"`,
  R(CHK, "11/25/2026", "Employer", ...RTA, "", 0, 3000, "Uncleared"),
  R(RWD, "11/17/2026", "Clinic", "", "", "", 15, 0, "Uncleared"),
  R(RWD, "11/16/2026", "Amazon", "Fun", "Shopping", "", 35, 0, "Uncleared"),
  R(CHK, "11/16/2026", `Transfer : ${RWD}`, "", "", "", 200, 0, "Cleared"),
  R(RWD, "11/16/2026", `Transfer : ${CHK}`, "", "", "", 0, 200, "Cleared"),
  R(CHK, "11/15/2026", `Transfer : ${IRA}`, "Savings", "IRA", "", 250, 0, "Cleared"),
  R(IRA, "11/15/2026", `Transfer : ${CHK}`, "", "", "", 0, 250, "Cleared"),
  R(CHK, "11/14/2026", `Transfer : ${SAV}`, "", "", "", 500, 0, "Cleared"),
  R(SAV, "11/14/2026", `Transfer : ${CHK}`, "", "", "", 0, 500, "Cleared"),
  R(CHK, "11/13/2026", "Coffee", "", "", "", 4, 0, "Cleared"),
  R(CHK, "11/11/2026", "Cafe", "Everyday", "Dining", "", 30, 0, "Cleared"),
  R(RWD, "11/10/2026", "Bistro", "Everyday", "Dining", "", 50, 0, "Cleared"),
  R(CHK, "11/09/2026", "Shop", "Fun", "Shopping", "refund", 0, 25, "Cleared"),
  R(RWD, "11/08/2026", "Shop", "Fun", "Shopping", "", 40, 0, "Cleared"),
  R(TRV, "11/06/2026", "Airline", "Savings", "Vacation", "", 400, 0, "Cleared"),
  R(RWD, "11/05/2026", "Diner", "Everyday", "Dining", "", 60, 0, "Cleared"),
  R(CHK, "11/04/2026", "Gym", "Hidden Categories", "Gym", "", 30, 0, "Cleared"),
  R(CHK, "11/03/2026", "Costco", "Everyday", "Groceries", "Split (1/2) food", 90, 0, "Cleared"),
  R(CHK, "11/03/2026", "Costco", "Everyday", "Gas", "Split (2/2) fuel", 30, 0, "Cleared"),
  R(CHK, "11/02/2026", "Landlord", "Bills", "Rent", "", 1500, 0, "Cleared"),
  R(CHK, "11/01/2026", "Employer", ...RTA, "", 0, 3000, "Cleared"),
  R(CHK, "10/25/2026", `Transfer : ${RWD}`, "", "", "", 300, 0, "Reconciled"),
  R(RWD, "10/25/2026", `Transfer : ${CHK}`, "", "", "", 0, 300, "Reconciled"),
  R(RWD, "10/20/2026", "Shop", "Fun", "Shopping", "", 150, 0, "Reconciled"),
  R(RWD, "10/15/2026", "Diner", "Everyday", "Dining", "", 80, 0, "Reconciled"),
  R(CHK, "10/12/2026", "Grocer", "Everyday", "Groceries", "", 200, 0, "Reconciled"),
  R(CHK, "10/10/2026", "Landlord", "Bills", "Rent", "", 1500, 0, "Reconciled"),
  R(CHK, "10/05/2026", "Employer", ...RTA, "", 0, 3000, "Reconciled"),
  R(CHK, "10/01/2026", "Starting Balance", ...RTA, "", 0, 5000, "Reconciled"),
  R(SAV, "10/01/2026", "Starting Balance", ...RTA, "", 0, 2000, "Reconciled"),
  R(RWD, "10/01/2026", "Starting Balance", "", "", "", 300, 0, "Reconciled"),
  R(TRV, "10/01/2026", "Starting Balance", "", "", "", 0, 0, "Reconciled"),
  R(IRA, "10/01/2026", "Starting Balance", "", "", "", 0, 10000, "Reconciled"),
  R(OLD, "03/01/2025", "Starting Balance", "", "", "", 0, 0, "Reconciled"),
].join("\n") + "\n";

const P = (month: string, group: string, category: string, assigned: number, activity: number, available: number) =>
  [month, `${group}: ${category}`, group, category, money(assigned), money(activity), money(available)].map((x) => `"${x}"`).join(",");
const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;

export const PLAN = [
  `"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"`,
  // October: the card's line got $300 for its starting balance, then $180 of spending (Shopping's $50 over stays on the card), less the $300 payment
  P("Oct 2026", "Credit Card Payments", RWD, 300, -120, 180),
  P("Oct 2026", "Credit Card Payments", TRV, 0, 0, 0),
  P("Oct 2026", "Bills", "Rent", 1500, -1500, 0),
  P("Oct 2026", "Everyday", "Groceries", 400, -200, 200),
  P("Oct 2026", "Everyday", "Gas", 50, 0, 50),
  P("Oct 2026", "Everyday", "Dining", 100, -80, 20),
  P("Oct 2026", "Fun", "Shopping", 100, -150, -50),
  P("Oct 2026", "Savings", "Vacation", 500, 0, 500),
  P("Oct 2026", "Savings", "IRA", 0, 0, 0),
  P("Oct 2026", "Hidden Categories", "Gym", 0, 0, 0),
  P("Oct 2026", "Hidden Categories", OLD, 0, 0, 0),
  // November: the card's line gets $150 of spending (dining $110, shopping $40), less the $200 payment
  P("Nov 2026", "Credit Card Payments", RWD, 0, -50, 130),
  P("Nov 2026", "Credit Card Payments", TRV, 0, 400, 400),
  P("Nov 2026", "Bills", "Rent", 1500, -1500, 0),
  P("Nov 2026", "Everyday", "Groceries", 0, -90, 110),
  P("Nov 2026", "Everyday", "Gas", -20, -30, 0),
  P("Nov 2026", "Everyday", "Dining", 100, -140, -20),
  // the unapproved Amazon purchase isn't in YNAB's numbers: $40 out, $25 back
  P("Nov 2026", "Fun", "Shopping", 50, -15, 35),
  P("Nov 2026", "Savings", "Vacation", 0, -400, 100),
  P("Nov 2026", "Savings", "IRA", 250, -250, 0),
  P("Nov 2026", "Hidden Categories", "Gym", 30, -30, 0),
  P("Nov 2026", "Hidden Categories", OLD, 0, 0, 0),
].join("\n") + "\n";

export const TODAY = "2026-11-18";

/** What YNAB shows for November, worked out by hand (see the notes on each). */
export const YNAB_SAYS = {
  /**
   * Cash today $8,891 (Checking $6,391, Savings $2,500), less what's in categories ($775: Groceries $110,
   * Shopping $35, Vacation $100, the Rewards card's line $130, the Travel card's $400), plus Dining's $20
   * overspent in cash (that comes out of December). The $4 coffee with no category counts against it.
   */
  readyToAssign: 8136,
  available: { Rent: 0, Groceries: 110, Gas: 0, Dining: -20, Shopping: 35, Vacation: 100, IRA: 0, Gym: 0 } as Record<string, number>,
  /** Each card's payment line. */
  cardLines: { Rewards: 130, Travel: 400 } as Record<string, number>,
  /** Balances today, without what isn't approved or is scheduled (a card's is what's owed). */
  balances: { Checking: 6391, Savings: 2500, Rewards: 180, Travel: 400, IRA: 10250 } as Record<string, number>,
  held: ["Clinic", "Amazon"],
  upcoming: ["Employer"],
};
