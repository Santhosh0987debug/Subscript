import { expect, request as playwrightRequest, test } from "@playwright/test";
import { registerWorkspace, signIn, uniqueEmail } from "./helpers";

test.describe("authentication", () => {
  test("registers a workspace, signs out, and signs back in", async ({
    page,
  }) => {
    const email = uniqueEmail("auth");
    await registerWorkspace(page, {
      name: "Alex Morgan",
      email,
      organizationName: "Northwind Labs",
    });

    await expect(page.getByText("Northwind Labs").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Your revenue/ })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await signIn(page, email);
    await expect(page.getByRole("heading", { name: /Your revenue/ })).toBeVisible();
  });

  test("rejects invalid credentials without revealing whether the email exists", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("missing@example.com");
    await page.getByLabel("Password", { exact: true }).fill("WrongPassword1");
    await page.getByRole("button", { name: "Sign in securely" }).click();

    await expect(page.getByRole("alert")).toContainText(
      "Invalid email or password",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("blocks cross-tenant organization switching", async ({ page }) => {
    await registerWorkspace(page, {
      name: "Tenant One",
      email: uniqueEmail("tenant.one"),
      organizationName: "Tenant One Workspace",
    });

    const apiUrl = process.env.E2E_API_URL ?? "http://localhost:4000";
    const other = await playwrightRequest.newContext({ baseURL: apiUrl });
    const otherEmail = uniqueEmail("tenant.two");
    const registration = await other.post("/api/auth/register", {
      headers: { Origin: process.env.E2E_WEB_URL ?? "http://localhost:4173" },
      data: {
        name: "Tenant Two",
        email: otherEmail,
        password: "CorrectHorse9",
        organizationName: "Tenant Two Workspace",
      },
    });
    expect(registration.status()).toBe(201);
    const otherSession = (await registration.json()) as {
      organizations: Array<{ id: string }>;
    };
    const otherOrganizationId = otherSession.organizations[0]?.id;
    expect(otherOrganizationId).toBeTruthy();

    // page.request shares the signed-in browser session with Tenant One.
    const attempt = await page.request.post(
      `${apiUrl}/api/organizations/${otherOrganizationId}/switch`,
      {
        headers: {
          Origin: process.env.E2E_WEB_URL ?? "http://localhost:4173",
        },
      },
    );

    expect(attempt.status()).toBe(403);
    await other.dispose();
  });
});
