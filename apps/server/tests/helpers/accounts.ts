import request from "supertest";
import type { Express } from "express";
import { API_PATHS, type SessionResponse } from "@subscript/shared";
import { TEST_ORIGIN } from "./test-app.js";

export const TEST_PASSWORD = "CorrectHorse9";

export interface TestAccountOptions {
  name: string;
  email: string;
  organizationName: string;
  password?: string;
}

export interface TestAccount {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: string;
}

export async function registerAccount(
  app: Express,
  options: TestAccountOptions,
) {
  const agent = request.agent(app);
  const password = options.password ?? TEST_PASSWORD;
  const response = await agent
    .post(API_PATHS.authRegister)
    .set("Origin", TEST_ORIGIN)
    .send({
      name: options.name,
      email: options.email,
      password,
      organizationName: options.organizationName,
    });

  if (response.status !== 201) {
    throw new Error(
      `Test registration failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }

  const body = response.body as SessionResponse;
  const organization = body.organizations[0];

  if (!organization) {
    throw new Error("Test registration did not return an organization.");
  }

  const account: TestAccount = {
    id: body.user.id,
    email: body.user.email,
    name: body.user.name,
    organizationId: organization.id,
    organizationName: organization.name,
    role: organization.role,
  };

  return { agent, account, password, response };
}

export function readSetCookie(response: request.Response): string {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header.join("; ") : String(header ?? "");
}
