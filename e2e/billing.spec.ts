import { expect, test } from "@playwright/test";
import { registerWorkspace, uniqueEmail } from "./helpers";

test.describe("revenue workflow", () => {
  test("manages a customer, plan, subscription, invoice, and analytics report", async ({
    page,
  }) => {
    const email = uniqueEmail("billing");
    await registerWorkspace(page, {
      name: "Blake Rivera",
      email,
      organizationName: "Harbor Billing",
    });

    const navigation = page.getByLabel("Main navigation");

    // Customer management
    await navigation.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/customers$/);
    await page.getByRole("link", { name: "New customer" }).first().click();
    await expect(page).toHaveURL(/\/customers\/new$/);
    await page.getByLabel("Full name").fill("Ada Lovelace");
    await page.getByLabel("Email address").fill("ada@analytical.example.com");
    await page.getByLabel("Company").fill("Analytical Engines");
    await page.getByRole("button", { name: "Create customer" }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();

    // Plans
    await navigation.getByRole("link", { name: "Plans" }).click();
    await expect(page).toHaveURL(/\/plans$/);
    await page.getByRole("link", { name: "New plan" }).first().click();
    await expect(page).toHaveURL(/\/plans\/new$/);
    await page.getByLabel("Plan name").fill("Growth");
    await page.getByLabel("Amount").fill("49.00");
    await page.getByLabel("Trial days").fill("0");
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Growth" })).toBeVisible();

    // Subscriptions
    await navigation.getByRole("link", { name: "Subscriptions" }).click();
    await expect(page).toHaveURL(/\/subscriptions$/);
    await page.getByRole("link", { name: "New subscription" }).first().click();
    await expect(page).toHaveURL(/\/subscriptions\/new$/);
    await expect(page.getByRole("button", { name: "Start subscription" })).toBeVisible();
    await page.getByRole("button", { name: "Start subscription" }).click();
    await expect(page).toHaveURL(/\/subscriptions\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Ada Lovelace").first()).toBeVisible();

    // Invoice generation from the subscription period
    await page.getByRole("button", { name: "Generate invoice" }).click();
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    const invoiceNumber = await page
      .locator("text=/INV-[A-Z0-9-]+/")
      .first()
      .textContent();
    expect(invoiceNumber).toMatch(/INV-/);

    await navigation.getByRole("link", { name: "Invoices" }).click();
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(
      page.getByRole("link", { name: new RegExp(`Open invoice ${invoiceNumber}`) }),
    ).toBeVisible();

    // Analytics uses the live subscription and invoice data.
    await navigation.getByRole("link", { name: "Analytics" }).click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole("heading", { name: /The shape of/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revenue CSV" }),
    ).toBeVisible();
    await expect(page.getByText("Growth").first()).toBeVisible();
  });
});
