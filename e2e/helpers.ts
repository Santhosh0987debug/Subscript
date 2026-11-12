import { expect, type Page } from "@playwright/test";

export const TEST_PASSWORD = "CorrectHorse9";

let sequence = 0;

export function uniqueEmail(prefix: string): string {
  sequence += 1;
  return `${prefix}.${Date.now()}.${sequence}@example.com`;
}

export async function registerWorkspace(
  page: Page,
  input: {
    name: string;
    email: string;
    organizationName: string;
    password?: string;
  },
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(input.name);
  await page.getByLabel("Work email").fill(input.email);
  await page.getByLabel("Password", { exact: true }).fill(input.password ?? TEST_PASSWORD);
  await page.getByLabel("Workspace name").fill(input.organizationName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("API connected")).toBeVisible();
}

export async function signIn(
  page: Page,
  email: string,
  password = TEST_PASSWORD,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/);
}
