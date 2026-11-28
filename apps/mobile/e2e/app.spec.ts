// End-to-end: the flows the UI test pass covered by hand, in a real browser at phone and desktop size.
// Every test starts from an empty, offline app (see playwright.config.ts).
import { expect, test, type Page } from "@playwright/test";

/** Go through setup with the defaults and land on Home. */
async function onboard(page: Page) {
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Start fresh" }).click();
  for (let i = 0; i < 12; i++) {
    const done = page.getByRole("button", { name: "Go to my dashboard" });
    if (await done.isVisible().catch(() => false)) break;
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByRole("button", { name: "Go to my dashboard" }).click();
  await expect(page).toHaveURL(/\/home/);
}

/** Setup with no budget asks for one; a yearly retirement amount is enough for a Coast FI number. */
async function setRetirementSpending(page: Page, perYear = 60000) {
  await page.goto("/home");
  await page.getByRole("link", { name: /Or type how much you.ll spend a year/ }).click();
  const box = page.getByRole("textbox", { name: "Yearly retirement spending" });
  await box.fill(String(perYear));
  await box.blur();
  await page.getByRole("button", { name: "Use this amount" }).click();
  await expect(page.getByText("to Coast FI").first()).toBeVisible();
}

/** Console errors and page crashes while the test runs. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("the start page loads", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Get started" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("setup with the defaults reaches Home", async ({ page }) => {
  const errors = watchErrors(page);
  await onboard(page);
  await expect(page.getByText("Add your budget to see your number")).toBeVisible();
  await setRetirementSpending(page);
  expect(errors).toEqual([]);
});

test("every main page opens without errors", async ({ page }) => {
  await onboard(page);
  const errors = watchErrors(page);
  for (const path of ["/home", "/budget", "/budget?view=transactions", "/budget?view=accounts", "/plan", "/plan?view=whatif", "/plan?view=retirement", "/money", "/money/accounts", "/money/debts", "/money/income", "/money/archived", "/money/payees", "/settings", "/settings/data"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toHaveText(/^\s*$/);
  }
  expect(errors).toEqual([]);
});

test("money keeps its cents in a box ('1,800.50', not '1,800.5')", async ({ page }) => {
  await onboard(page);
  await page.goto("/money/accounts");
  const box = page.getByRole("textbox", { name: /balance$/ }).first();
  await box.fill("1800.5");
  await box.blur();
  await expect(box).toHaveValue("1,800.50");
});

test("the What if chart always fits its plan line", async ({ page }) => {
  await onboard(page);
  await setRetirementSpending(page);
  // enough invested that the median ends over 2.2x the FIRE number (where the axis used to stop, so it ran off the top)
  await page.goto("/money/accounts");
  const k401 = page.getByRole("textbox", { name: "401(k) balance" });
  await k401.fill("2000000");
  await k401.blur();
  await page.goto("/plan?view=whatif");
  const chart = page.getByRole("img", { name: /Invested balance by age/ });
  await expect(chart).toBeVisible();
  const label = (await chart.getAttribute("aria-label")) ?? "";
  const median = Number(/Your plan: \$([\d,]+)/.exec(label)?.[1]?.replace(/,/g, "") ?? NaN);
  // the axis labels ($1M, $2.5M, $600k...): the top one must be at least the plan line's end
  const ticks = (await chart.locator("text").allTextContents())
    .map((s) => /^\$([\d.]+)([kM]?)$/.exec(s.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]) * (m[2] === "M" ? 1e6 : m[2] === "k" ? 1e3 : 1));
  expect(Number.isFinite(median)).toBe(true);
  expect(Math.max(...ticks)).toBeGreaterThanOrEqual(median * 0.999);
});

test("Settings has Back on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await onboard(page);
  await page.goto("/settings");
  await expect(page.getByText("Back", { exact: true }).first()).toBeVisible();
});

test("a saved plan that can't be read says so, and offers setup again", async ({ page }) => {
  await onboard(page);
  // damage the plan itself (not one list item, which is just dropped)
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app") ?? "{}");
    raw.state.plan.age = "old";
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/home");
  await expect(page.getByText("Some saved data couldn't be read")).toBeVisible();
  await expect(page.getByText(/setup starts again/)).toBeVisible();
});

test("Money and Settings use the width on a desktop", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "desktop only");
  await onboard(page);
  await page.goto("/settings");
  const account = page.getByText("Account & sync");
  const rules = page.getByText("Assumptions & plan rules");
  const a = await account.boundingBox();
  const r = await rules.boundingBox();
  // side by side: two columns, not one narrow list
  expect(a && r && Math.abs(a.y - r.y) < 200 && r.x > a.x + 300).toBe(true);
});

test("transactions move from an older save into the browser's database, and stay there", async ({ page }) => {
  await onboard(page);
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  await expect(page.getByRole("button", { name: "Add categories" }).first()).toBeVisible();
  // an older save: a transaction (dated today) inside the localStorage entry, as before
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app") ?? "{}");
    const acct = raw.state.plan.accounts[0].id;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    raw.state.txns = [...(raw.state.txns ?? []), { id: "e2e-old", accountId: acct, date: today, amount: -12.34, payee: "Corner Cafe", cleared: "cleared", source: "manual", updatedAt: 5 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget?view=transactions");
  await expect(page.getByText("Corner Cafe").first()).toBeVisible();
  // any change saves: the transaction leaves localStorage for the database
  await page.goto("/money/accounts");
  const box = page.getByRole("textbox", { name: /balance$/ }).first();
  await box.fill("100");
  await box.blur();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("coastfi.app") ?? "{}").state?.txns?.length)).toBe(0);
  const inDb = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const req = indexedDB.open("coastfi");
    req.onsuccess = () => { const g = req.result.transaction("txns").objectStore("txns").getAllKeys(); g.onsuccess = () => resolve(g.result as string[]); g.onerror = () => reject(g.error); };
    req.onerror = () => reject(req.error);
  }));
  expect(inDb).toContain("e2e-old");
  await page.reload();
  await page.goto("/budget?view=transactions");
  await expect(page.getByText("Corner Cafe").first()).toBeVisible();
});


test("an amount changed in the forecast table replaces the one on Your plan's steps", async ({ page }) => {
  await onboard(page);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    const p = raw.state.plan;
    p.incomes = [{ id: "j1", name: "Job", kind: "job", freq: "monthly", net: 6000, matchMode: "pct" }];
    p.accounts = [{ id: "a1", name: "Savings", type: "cash", balance: 30000 }, { id: "a4", name: "Roth IRA", type: "roth", balance: 1000 }];
    p.budget = [{ id: "b1", name: "Rent", amount: 2500, inRetirement: true }];
    p.plan.amountsBy = { ira: { "2027-03": 700 } };
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/plan?view=table");
  await page.getByRole("button", { name: "Next year" }).click();
  // phones show one account at a time; a desktop shows them all
  const pick = page.getByRole("button", { name: /^Account:/ });
  await pick.click();
  await page.getByRole("option", { name: /^IRA/ }).click();
  await page.getByRole("button", { name: "IRA, Mar: change" }).click();
  await expect(page.getByText(/Set on Your plan's steps: \$700/)).toBeVisible();
  const box = page.getByRole("textbox", { name: "Roth IRA, Mar 2027" });
  await box.fill("1500");
  await box.blur();
  await page.getByRole("button", { name: "Save" }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("coastfi.app")!).state.plan.plan);
  expect(saved.scheduleMonths?.["acct:a4"]?.["2027-03"]).toBe(1500);
  expect(saved.amountsBy?.ira?.["2027-03"]).toBeUndefined();
});

test("an account's activity shows its own side of a transfer, once", async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1000 }, { id: "trv", name: "Travel", type: "cash", balance: 1000 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  await expect(page.getByRole("button", { name: "Add categories" }).first()).toBeVisible();
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app") ?? "{}");
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const out = { id: "e2e-x1", accountId: "trv", transferAccountId: "chk", transferId: "e2e-x2", date: today, amount: -77.77, cleared: "cleared", source: "manual", updatedAt: 5 };
    const back = { ...out, id: "e2e-x2", accountId: "chk", transferAccountId: "trv", transferId: "e2e-x1", amount: 77.77 };
    raw.state.txns = [...(raw.state.txns ?? []), out, back];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget?view=transactions");
  await expect(page.getByText("$77.77").first()).toBeVisible();
  await page.getByRole("button", { name: /^Account:/ }).first().click();
  await page.getByRole("option", { name: /^Travel/ }).click();
  await expect(page.getByText("−$77.77")).toHaveCount(1);
  await expect(page.getByText("+$77.77")).toHaveCount(0);
});

test("the browser's Back button returns to the Budget view you were on", async ({ page }) => {
  await onboard(page);
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  const views = page.getByRole("radiogroup", { name: "Budget view" });
  await views.getByRole("radio", { name: /^Activity/ }).click();
  await expect(page).toHaveURL(/view=transactions/);
  await views.getByRole("radio", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/view=accounts/);
  await page.goBack();
  await expect(page).toHaveURL(/view=transactions/);
  await expect(views.getByRole("radio", { name: /^Activity/ })).toBeChecked();
  await page.goBack();
  await expect(page).not.toHaveURL(/view=/);
  await expect(views.getByRole("radio", { name: "Categories" })).toBeChecked();
  await page.goForward();
  await expect(views.getByRole("radio", { name: /^Activity/ })).toBeChecked();
});

test("a payee picked from the suggestions closes them", async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1000 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  await expect(page.getByRole("button", { name: "Add categories" }).first()).toBeVisible();
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app") ?? "{}");
    const t = (id: string, payee: string) => ({ id, accountId: "chk", payee, date: "2026-11-01", amount: -10, cleared: "cleared", source: "manual", updatedAt: 5 });
    raw.state.txns = [...(raw.state.txns ?? []), t("p1", "Zelle Payment To Ana"), t("p2", "Zelle Payment To Ben"), t("p3", "Zelle Payment To Cal")];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: "Add a transaction" }).click();
  await page.getByRole("textbox", { name: "Payee" }).fill("zelle");
  await expect(page.getByRole("button", { name: /^Use Zelle/ })).toHaveCount(3);
  await page.getByRole("button", { name: "Use Zelle Payment To Ben" }).click();
  await expect(page.getByRole("textbox", { name: "Payee" })).toHaveValue("Zelle Payment To Ben");
  await expect(page.getByRole("button", { name: /^Use Zelle/ })).toHaveCount(0);
  // typing again brings them back
  await page.getByRole("textbox", { name: "Payee" }).fill("Zelle Payment To");
  await expect(page.getByRole("button", { name: /^Use Zelle/ })).toHaveCount(3);
});

test("math in a number box: typed, or with the + − × ÷ keys on a phone", async ({ page, isMobile }) => {
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1000 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  await page.getByRole("button", { name: "Add a transaction" }).click();
  const amount = page.getByRole("textbox", { name: "Amount" });
  await amount.fill("42.10+8.90");
  await amount.blur();
  await expect(amount).toHaveValue("51");
  if (isMobile) {
    // the phone's number pad has no +: the keys above it do
    await amount.click();
    await amount.fill("20");
    await expect(page.getByRole("toolbar", { name: "Math keys" })).toBeVisible();
    await page.getByRole("button", { name: "Type ×" }).click();
    await amount.pressSequentially("3");
    await expect(amount).toHaveValue("20×3");
    await expect(amount).toBeFocused();
    await page.getByRole("button", { name: "Work it out" }).click();
    await expect(amount).toHaveValue("60");
    await amount.blur();
    await expect(page.getByRole("toolbar", { name: "Math keys" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("toolbar", { name: "Math keys" })).toHaveCount(0);
  }
});

test("a group keeps its place when its last category is dragged out, and an empty one can be deleted", async ({ page, isMobile }) => {
  test.skip(isMobile, "dragging is checked on the desktop layout");
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 3000 }];
    raw.state.plan.budget = [
      { id: "rent", name: "Rent", amount: 1500, inRetirement: true, group: "Housing" },
      { id: "food", name: "Groceries", amount: 500, inRetirement: true, group: "Food" },
      { id: "fun", name: "Fun money", amount: 150, inRetirement: false, group: "Fun" },
    ];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  const heads = () => page.getByRole("button", { name: / group: rename/ }).allTextContents();
  const order = async () => (await heads()).map((h) => h.replace(/\$.*$/, "").trim().toUpperCase());
  expect((await order()).slice(-3)).toEqual(["HOUSING", "FOOD", "FUN"]);
  // drag Groceries (Food's only category) onto Housing
  const grip = page.getByRole("slider", { name: /^Move Groceries/ });
  const to = page.getByText("Rent", { exact: true });
  const a = (await grip.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + a.width / 2, a.y + (b.y + b.height - a.y) * (i / 12), { steps: 2 });
  await page.mouse.up();
  await expect(page.getByText(/No categories\./)).toBeVisible();
  expect((await order()).slice(-3)).toEqual(["HOUSING", "FOOD", "FUN"]);
  // the empty group: Delete group
  await page.getByRole("button", { name: /^Food group: rename/ }).click();
  await page.getByRole("button", { name: "Delete group" }).click();
  expect((await order()).slice(-2)).toEqual(["HOUSING", "FUN"]);
  await expect(page.getByText(/No categories\./)).toHaveCount(0);
});

test("an account's gear on Budget → Accounts opens its settings", async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1000 }];
    raw.state.plan.debts = [{ id: "visa", name: "Visa", kind: "credit_card", balance: 200, apr: 0.24, minPayment: 25 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  await page.goto("/budget?view=accounts");
  await page.getByRole("link", { name: "Checking: settings" }).click();
  await expect(page).toHaveURL(/\/money\/accounts\?open=chk/);
  await expect(page.getByRole("button", { name: "Checking details" })).toHaveAttribute("aria-expanded", "true");
  await page.goBack();
  await page.getByRole("link", { name: "Visa: settings" }).click();
  await expect(page.getByRole("button", { name: /^Visa.* details$/ })).toHaveAttribute("aria-expanded", "true");
});

test("a transfer's From and To swap with one button", async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 3000 }, { id: "trv", name: "Travel", type: "cash", balance: 5000 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  await page.getByRole("button", { name: "Add a transaction" }).click();
  await page.getByRole("radio", { name: "Transfer" }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("250");
  await page.getByRole("button", { name: /^Account: / }).click();
  await page.getByRole("option", { name: /^Travel/ }).click();
  await page.getByRole("button", { name: /^Transfer to: / }).click();
  await page.getByRole("option", { name: /^Checking Between/ }).click();
  await page.getByRole("button", { name: "Swap From and To" }).click();
  await expect(page.getByRole("button", { name: /^Account: Checking/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Transfer to: Travel/ })).toBeVisible();
});

test("a loan's category suggests a transfer, which shows the interest, escrow and principal", async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 5000 }];
    raw.state.plan.debts = [{ id: "home", name: "Mortgage", kind: "mortgage", balance: 200000, apr: 0.06, minPayment: 1900, escrow: 400 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  await page.getByRole("button", { name: "Add a transaction" }).click();
  await page.getByRole("textbox", { name: "Amount" }).fill("1900");
  await page.getByRole("button", { name: /^Category: / }).click();
  await page.getByRole("option", { name: /Mortgage/ }).first().click();
  await page.getByRole("button", { name: "Make it a transfer to Mortgage" }).click();
  await expect(page.getByText(/\$1,000 interest and \$400 escrow this month; \$500 lowers what you owe/)).toBeVisible();
});

test("a loan's Payments list shows each payment's interest, escrow and principal", async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("coastfi.app")!);
    raw.state.plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 5000 }];
    raw.state.plan.debts = [{ id: "home", name: "Mortgage", kind: "mortgage", balance: 200000, apr: 0.06, minPayment: 1900, escrow: 400 }];
    localStorage.setItem("coastfi.app", JSON.stringify(raw));
  });
  await page.goto("/budget");
  await page.getByRole("button", { name: /^Start with / }).click();
  for (const amount of ["1900", "500"]) {
    await page.getByRole("button", { name: "Add a transaction" }).click();
    await page.getByRole("radio", { name: "Transfer" }).click();
    await page.getByRole("textbox", { name: "Amount" }).fill(amount);
    await page.getByRole("button", { name: /^Transfer to: / }).click();
    await page.getByRole("option", { name: /^Mortgage A loan/ }).click();
    await page.getByRole("button", { name: "Save" }).click();
  }
  await page.goto("/money/accounts");
  await page.getByRole("link", { name: "Mortgage payments" }).click();
  await expect(page).toHaveURL(/account=home/);
  await expect(page.getByText("$1,000 interest · $400 escrow · $500 principal")).toBeVisible();
  await expect(page.getByText("Extra: all principal")).toBeVisible();
  await expect(page.getByText("Owed after $199,000")).toBeVisible();
  await expect(page.getByText("Owed after $199,500")).toBeVisible();
});
