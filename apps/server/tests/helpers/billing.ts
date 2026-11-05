import type request from "supertest";
import type { Express } from "express";
import {
  API_PATHS,
  type CreateCustomerRequest,
  type CreatePlanRequest,
  type CreateSubscriptionRequest,
  type CustomerMutationResponse,
  type GenerateInvoiceRequest,
  type GenerateInvoiceResponse,
  type InvoiceResponse,
  type PlanResponse,
  type RecordPaymentRequest,
  type SubscriptionMutationResponse,
} from "@subscript/shared";
import { registerAccount } from "./accounts.js";
import { TEST_ORIGIN } from "./test-app.js";

export type Agent = ReturnType<typeof request.agent>;

export async function registerBillingAccount(
  app: Express,
  options: {
    name: string;
    email: string;
    organizationName: string;
  },
) {
  return registerAccount(app, options);
}

export function createCustomer(
  agent: Agent,
  overrides: Partial<CreateCustomerRequest> = {},
) {
  return agent
    .post(API_PATHS.customers)
    .set("Origin", TEST_ORIGIN)
    .send({
      name: "Acme Industries",
      email: "billing@acme.test",
      phone: "+1 555 0100",
      company: "Acme Industries",
      billingAddress: {
        line1: "1 Market Street",
        line2: "Suite 400",
        city: "San Francisco",
        region: "CA",
        postalCode: "94105",
        country: "United States",
      },
      notes: null,
      ...overrides,
    });
}

export function createPlan(
  agent: Agent,
  overrides: Partial<CreatePlanRequest> = {},
) {
  return agent
    .post(API_PATHS.plans)
    .set("Origin", TEST_ORIGIN)
    .send({
      name: "Growth",
      description: "For growing teams.",
      price: { amountMinor: 2_900, currency: "USD" },
      interval: "MONTH",
      trialDays: 0,
      ...overrides,
    });
}

export function createSubscription(
  agent: Agent,
  payload: CreateSubscriptionRequest,
) {
  return agent
    .post(API_PATHS.subscriptions)
    .set("Origin", TEST_ORIGIN)
    .send(payload);
}

export function generateInvoice(
  agent: Agent,
  subscriptionId: string,
  payload: Partial<GenerateInvoiceRequest> = {},
) {
  return agent
    .post(API_PATHS.subscriptionInvoices(subscriptionId))
    .set("Origin", TEST_ORIGIN)
    .send({
      taxRateBps: 0,
      dueInDays: 7,
      ...payload,
    });
}

export function recordPayment(
  agent: Agent,
  invoiceId: string,
  payload: Partial<RecordPaymentRequest> = {},
) {
  return agent
    .post(API_PATHS.invoicePayments(invoiceId))
    .set("Origin", TEST_ORIGIN)
    .send({
      amountMinor: 1_000,
      method: "BANK_TRANSFER",
      ...payload,
    });
}

export async function setupSubscription(
  agent: Agent,
  options: {
    customer?: Partial<CreateCustomerRequest>;
    plan?: Partial<CreatePlanRequest>;
    subscription: Partial<CreateSubscriptionRequest> & {
      startDate: string;
    };
  },
) {
  const customerResponse = await createCustomer(agent, options.customer);

  if (customerResponse.status !== 201) {
    throw new Error(
      `Customer setup failed: ${customerResponse.status} ${JSON.stringify(customerResponse.body)}`,
    );
  }

  const planResponse = await createPlan(agent, options.plan);

  if (planResponse.status !== 201) {
    throw new Error(
      `Plan setup failed: ${planResponse.status} ${JSON.stringify(planResponse.body)}`,
    );
  }

  const customer = (customerResponse.body as CustomerMutationResponse).customer;
  const plan = (planResponse.body as PlanResponse).plan;
  const subscriptionResponse = await createSubscription(agent, {
    ...options.subscription,
    customerId: customer.id,
    planId: plan.id,
  });

  if (subscriptionResponse.status !== 201) {
    throw new Error(
      `Subscription setup failed: ${subscriptionResponse.status} ${JSON.stringify(subscriptionResponse.body)}`,
    );
  }

  return {
    customer,
    plan,
    subscription: (subscriptionResponse.body as SubscriptionMutationResponse)
      .subscription,
  };
}

export async function setupOpenInvoice(
  agent: Agent,
  options: {
    customer?: Partial<CreateCustomerRequest>;
    plan?: Partial<CreatePlanRequest>;
    subscription: Partial<CreateSubscriptionRequest> & {
      startDate: string;
    };
    invoice?: Partial<GenerateInvoiceRequest>;
  },
) {
  const setup = await setupSubscription(agent, options);
  const generated = await generateInvoice(agent, setup.subscription.id, {
    taxRateBps: 0,
    ...options.invoice,
  });

  if (generated.status !== 201) {
    throw new Error(
      `Invoice setup failed: ${generated.status} ${JSON.stringify(generated.body)}`,
    );
  }

  const invoice = (generated.body as GenerateInvoiceResponse).invoice;
  const issued = await agent
    .post(API_PATHS.invoiceIssue(invoice.id))
    .set("Origin", TEST_ORIGIN);

  if (issued.status !== 200) {
    throw new Error(
      `Invoice issue failed: ${issued.status} ${JSON.stringify(issued.body)}`,
    );
  }

  return {
    ...setup,
    invoice: (issued.body as InvoiceResponse).invoice,
  };
}
