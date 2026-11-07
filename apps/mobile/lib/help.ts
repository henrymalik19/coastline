/** Plain-English explanations shown behind the ⓘ next to inputs. One place, so setup and Settings agree. */
export const HELP = {
  age: "Your age today. The plan runs month by month from now until your retirement age.",
  retireAge:
    "The age you'd like work to be optional. It doesn't have to be when you stop. Coast FI is the point where your savings alone can grow into enough by this age.",
  filingStatus:
    "How you file your taxes. Married couples filing together pay noticeably less tax on the same income, so this makes the paycheck tax estimate closer. It doesn't change anything you've typed from a pay stub.",
  healthcare:
    "At work, your employer usually pays most of your health insurance. If you stop working before 65, you'll buy your own until Medicare (government health insurance) starts at 65. That often costs $500–$1,500+ a month per person, so it's added to your retirement spending. Retiring at 65 or later? Leave this at $0.",
  currentInvest:
    "What you already invest each month from your take-home pay (Roth IRA, brokerage). Don't include your 401(k); that comes out of your paycheck before you see it. Used only to compare your current habits with the plan.",

  takeHome: "What actually lands in your bank account each paycheck, after taxes, insurance and your 401(k).",
  nextPayday:
    "Your next payday. If you're paid every week or two, some months get an extra paycheck (3 instead of 2). Knowing the date lets the plan put those bonus checks in the right months.",
  gross: "Your pay before anything is taken out: the big number at the top of your pay stub, per paycheck.",
  contribPct: "The percent of each paycheck you put into your 401(k) or 403(b) today.",
  match:
    "Free money: many employers add to your 401(k) when you do. \"100% of the first 3%\" means if you put in 3% of your pay, they put in 3% too. Check your benefits portal if you're not sure.",
  businessAmount:
    "What you keep after business costs and taxes. If it varies, use a typical month (or this year's total ÷ 12) and pick Monthly.",
  rentalAmount:
    "What you keep after property costs (repairs, insurance, management, taxes). If the rental's mortgage is in your budget, don't subtract it here too.",
  otherAmount: "After-tax amount each time it comes in: a side gig, pension, benefits, alimony, and so on.",

  budget: "Your monthly spending today, not counting debt payments (those go under Debts so the plan can pay them off).",
  inRetirement:
    "Will you still pay this after you stop working? Rent, food and utilities usually continue. Commuting, childcare, or a mortgage that'll be paid off usually stop. Everything you'll still pay, plus health insurance, is your retirement budget, and that sets how much you need to save to retire.",

  pretax: "Traditional 401(k), 403(b) or IRA: you haven't paid tax on this yet, so you'll pay some when you take it out.",
  roth: "Roth 401(k) or Roth IRA: already taxed, so it comes out tax-free in retirement.",
  taxable: "A normal investment account (brokerage). Flexible; you can use it before 59½.",
  hsa: "Health Savings Account: tax-free for medical costs; works like an extra retirement account.",
  cash: "Checking, savings, high-yield savings. This is your emergency fund.",
  apr: "The yearly interest rate on the debt. It's on your statement, often labeled APR.",
  minPayment: "The smallest payment the lender requires each month.",

  ret:
    "How much investments grow per year after inflation (so everything stays in today's dollars). Stock-heavy portfolios have averaged roughly 5–7%; 5% is a sober assumption.",
  vol:
    "How bumpy returns are. Stocks swing about 15–18% in a typical year. Higher volatility widens the range of outcomes in the projection.",
  fee: "The yearly cost of your funds (the expense ratio). Index funds are often 0.03–0.2%.",
  swr:
    "The share of your portfolio you'd spend each year in retirement. 3.5% is cautious; above 4% raises the risk of running out, especially for long early retirements.",
  taxRate:
    "Your average tax rate on money you take out of pre-tax accounts in retirement. It raises how much you need, because you'll owe some of each withdrawal.",
  contribGrowth: "How much your income grows per year beyond inflation. 0% is conservative; raises are a bonus, not a plan.",
  starterEF: "A small cash cushion to build first, so a surprise bill doesn't go on a credit card.",
  efMonths: "How many months of your budget (plus debt minimums) to keep in cash before investing beyond the basics.",
  highApr: "Debts at or above this rate get paid off before you invest beyond the employer match. Below it, investing usually wins.",
  marginalTax:
    "Your top tax bracket (federal + state). Putting $1 more into a pre-tax 401(k) only costs about $1 × (1 − this rate) of take-home pay. We estimate it from everyone's pay in the plan and your filing status (2025 federal brackets, about 4% state). Set your own if your state's rate is different or you have other income.",
  hsaEligible: "You can use an HSA only with a high-deductible health plan. Check your benefits if you're not sure.",
  projectWith:
    "\"Following this plan\" assumes every spare dollar goes through your plan's steps (emergency fund, debts, IRA, 401(k) and so on). \"What I invest now\" assumes you keep investing only what you put in each month today, and any other spare money sits in cash.",
  roth401k:
    "Many 401(k)s let you pick Roth for some or all of your contributions. Roth is taxed now and comes out tax-free in retirement; pre-tax lowers your taxes now. Your employer's match is always pre-tax. Check your 401(k) website or pay stub (it may say Roth 401(k)).",
  hsaEmployer:
    "Some employers add money to your HSA (often $500–$1,500 a year). It's free money and counts toward the yearly HSA limit, so the plan only adds what's left.",
  catchUp: "Once you're 50 (55 for the HSA), the IRS lets you put in extra each year on top of the normal limit.",
} as const;
