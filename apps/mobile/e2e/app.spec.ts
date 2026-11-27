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
