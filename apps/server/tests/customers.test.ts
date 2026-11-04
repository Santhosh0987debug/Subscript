import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  API_PATHS,
  type ApiErrorResponse,
  type CreateCustomerRequest,
  type CustomerListResponse,
  type CustomerMutationResponse,
  type CustomerResponse,
} from "@subscript/shared";
import { registerAccount } from "./helpers/accounts.js";
import { createTestApp, TEST_ORIGIN } from "./helpers/test-app.js";

type Agent = ReturnType<typeof request.agent>;

function customerPayload(
  overrides: Partial<CreateCustomerRequest> = {},
): CreateCustomerRequest {
  return {
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+44 20 7946 0958",
    company: "Analytical Engines",
    billingAddress: {
      line1: "12 St James's Square",
      line2: "Suite 4",
      city: "London",
      region: "Greater London",
      postalCode: "SW1Y 4LB",
      country: "United Kingdom",
    },
    notes: "Prefers annual invoicing.",
    ...overrides,
  };
}

function createCustomer(agent: Agent, overrides: Partial<CreateCustomerRequest> = {}) {
  return agent
    .post(API_PATHS.customers)
    .set("Origin", TEST_ORIGIN)
    .send(customerPayload(overrides));
}

async function switchTo(agent: Agent, organizationId: string) {
  return agent
    .post(API_PATHS.switchOrganization(organizationId))
    .set("Origin", TEST_ORIGIN);
}

describe("customer management", () => {
  it("requires authentication", async () => {
    const { app } = createTestApp();
    const response = await request(app).get(API_PATHS.customers);

    expect(response.status).toBe(401);
    expect((response.body as ApiErrorResponse).error.code).toBe("UNAUTHORIZED");
  });

  it("creates a customer and records the activity timeline", async () => {
    const { app } = createTestApp();
    const { agent, account } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const created = await createCustomer(agent);

    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(
      `/api/customers/${(created.body as CustomerMutationResponse).customer.id}`,
    );
    const customer = (created.body as CustomerMutationResponse).customer;
    expect(customer).toMatchObject({
      organizationId: account.organizationId,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+44 20 7946 0958",
      company: "Analytical Engines",
      notes: "Prefers annual invoicing.",
      status: "ACTIVE",
    });
    expect(customer.billingAddress.city).toBe("London");

    const detail = await agent.get(API_PATHS.customer(customer.id));

    expect(detail.status).toBe(200);
    const detailBody = detail.body as CustomerResponse;
    expect(detailBody.customer.id).toBe(customer.id);
    expect(detailBody.activities).toHaveLength(1);
    expect(detailBody.activities[0]).toMatchObject({
      type: "CREATED",
      actorName: "Alex Morgan",
      message: "Created this customer.",
    });
  });

  it("validates customer input and query parameters", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    const missingName = await agent
      .post(API_PATHS.customers)
      .set("Origin", TEST_ORIGIN)
      .send({ ...customerPayload(), name: "" });

    expect(missingName.status).toBe(400);
    expect(
      (missingName.body as ApiErrorResponse).error.details?.map((issue) => issue.path),
    ).toContain("name");

    const badEmail = await createCustomer(agent, { email: "not-an-email" });
    expect(badEmail.status).toBe(400);
    expect((badEmail.body as ApiErrorResponse).error.code).toBe("VALIDATION_ERROR");

    const clientOrganization = await agent
      .post(API_PATHS.customers)
      .set("Origin", TEST_ORIGIN)
      .send({
        ...customerPayload(),
        organizationId: "00000000-0000-0000-0000-000000000000",
      });

    expect(clientOrganization.status).toBe(400);
    expect((clientOrganization.body as ApiErrorResponse).error.code).toBe(
      "VALIDATION_ERROR",
    );

    const badQuery = await agent.get(`${API_PATHS.customers}?page=0`);
    expect(badQuery.status).toBe(400);
    expect((badQuery.body as ApiErrorResponse).error.code).toBe("VALIDATION_ERROR");

    const badSort = await agent.get(`${API_PATHS.customers}?sort=hijacked`);
    expect(badSort.status).toBe(400);
  });

  it("prevents duplicate customer emails within an organization", async () => {
    const { app } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });

    const first = await createCustomer(alice.agent);
    const firstId = (first.body as CustomerMutationResponse).customer.id;
    expect(
      (
        await createCustomer(alice.agent, {
          name: "Grace Hopper",
          email: "grace@example.com",
        })
      ).status,
    ).toBe(201);

    const duplicate = await createCustomer(alice.agent, {
      email: "ADA@EXAMPLE.COM",
    });

    expect(duplicate.status).toBe(409);
    const body = duplicate.body as ApiErrorResponse;
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details?.[0]?.path).toBe("email");

    const duplicateOnUpdate = await alice.agent
      .patch(API_PATHS.customer(firstId))
      .set("Origin", TEST_ORIGIN)
      .send({ email: "grace@example.com" });

    expect(duplicateOnUpdate.status).toBe(409);
    expect(
      (duplicateOnUpdate.body as ApiErrorResponse).error.details?.[0]?.path,
    ).toBe("email");

    const sameEmailOnUpdate = await alice.agent
      .patch(API_PATHS.customer(firstId))
      .set("Origin", TEST_ORIGIN)
      .send({ email: "ada@example.com", company: "Analytical Engines Ltd" });

    expect(sameEmailOnUpdate.status).toBe(200);

    const otherTenant = await createCustomer(bob.agent, {
      email: "ada@example.com",
    });
    expect(otherTenant.status).toBe(201);
  });

  it("updates a customer and records which fields changed", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const created = await createCustomer(agent);
    const customerId = (created.body as CustomerMutationResponse).customer.id;

    const updated = await agent
      .patch(API_PATHS.customer(customerId))
      .set("Origin", TEST_ORIGIN)
      .send({
        name: "Ada King",
        phone: null,
        notes: "Now prefers monthly invoicing.",
      });

    expect(updated.status).toBe(200);
    const customer = (updated.body as CustomerMutationResponse).customer;
    expect(customer.name).toBe("Ada King");
    expect(customer.phone).toBe("");
    expect(customer.notes).toBe("Now prefers monthly invoicing.");
    expect(customer.email).toBe("ada@example.com");

    const detail = await agent.get(API_PATHS.customer(customerId));
    const detailBody = detail.body as CustomerResponse;
    expect(detailBody.activities[0]?.type).toBe("UPDATED");
    expect(detailBody.activities[0]?.message).toBe(
      "Updated name, phone and notes.",
    );
    expect(detailBody.activities[1]?.type).toBe("CREATED");
  });

  it("archives and restores customers while keeping them filterable", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });
    const created = await createCustomer(agent);
    const customerId = (created.body as CustomerMutationResponse).customer.id;

    const archived = await agent
      .post(API_PATHS.customerArchive(customerId))
      .set("Origin", TEST_ORIGIN);
    expect(archived.status).toBe(200);
    expect((archived.body as CustomerMutationResponse).customer.status).toBe(
      "ARCHIVED",
    );

    const activeList = await agent.get(API_PATHS.customers);
    expect((activeList.body as CustomerListResponse).total).toBe(0);

    const archivedList = await agent.get(
      `${API_PATHS.customers}?status=ARCHIVED`,
    );
    expect((archivedList.body as CustomerListResponse).total).toBe(1);

    const allList = await agent.get(`${API_PATHS.customers}?status=ALL`);
    expect((allList.body as CustomerListResponse).customers[0]?.status).toBe(
      "ARCHIVED",
    );

    const detail = await agent.get(API_PATHS.customer(customerId));
    expect((detail.body as CustomerResponse).activities[0]?.type).toBe(
      "ARCHIVED",
    );

    const restored = await agent
      .post(API_PATHS.customerRestore(customerId))
      .set("Origin", TEST_ORIGIN);
    expect(restored.status).toBe(200);
    expect((restored.body as CustomerMutationResponse).customer.status).toBe(
      "ACTIVE",
    );
  });

  it("searches, sorts, and paginates at the store layer", async () => {
    const { app } = createTestApp();
    const { agent } = await registerAccount(app, {
      name: "Alex Morgan",
      email: "alex@example.com",
      organizationName: "Northwind Labs",
    });

    await createCustomer(agent, {
      name: "Bravo Studio",
      email: "bravo@example.com",
      company: "Bravo Holdings",
    });
    await createCustomer(agent, {
      name: "Alpha Works",
      email: "alpha@example.com",
      company: "Alpha Group",
    });
    await createCustomer(agent, {
      name: "Charlie Labs",
      email: "charlie@example.com",
      company: "Charlie Inc",
    });

    const firstPage = await agent.get(
      `${API_PATHS.customers}?sort=name&direction=asc&page=1&pageSize=1`,
    );
    const firstBody = firstPage.body as CustomerListResponse;
    expect(firstBody.total).toBe(3);
    expect(firstBody.totalPages).toBe(3);
    expect(firstBody.customers[0]?.name).toBe("Alpha Works");

    const secondPage = await agent.get(
      `${API_PATHS.customers}?sort=name&direction=asc&page=2&pageSize=1`,
    );
    expect((secondPage.body as CustomerListResponse).customers[0]?.name).toBe(
      "Bravo Studio",
    );

    const search = await agent.get(`${API_PATHS.customers}?query=charlie`);
    expect((search.body as CustomerListResponse).total).toBe(1);
    expect((search.body as CustomerListResponse).customers[0]?.name).toBe(
      "Charlie Labs",
    );
  });

  it("allows members to read but not mutate customers", async () => {
    const { app, store } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });
    const created = await createCustomer(alice.agent);
    const customerId = (created.body as CustomerMutationResponse).customer.id;

    store.addMember(alice.account.organizationId, bob.account.id, "MEMBER");
    await switchTo(bob.agent, alice.account.organizationId);

    const list = await bob.agent.get(API_PATHS.customers);
    expect(list.status).toBe(200);
    expect((list.body as CustomerListResponse).total).toBe(1);

    const create = await createCustomer(bob.agent, {
      email: "member@example.com",
    });
    expect(create.status).toBe(403);

    const update = await bob.agent
      .patch(API_PATHS.customer(customerId))
      .set("Origin", TEST_ORIGIN)
      .send({ name: "Hijacked Customer" });
    expect(update.status).toBe(403);

    const archive = await bob.agent
      .post(API_PATHS.customerArchive(customerId))
      .set("Origin", TEST_ORIGIN);
    expect(archive.status).toBe(403);

    store.addMember(alice.account.organizationId, bob.account.id, "ADMIN");

    const adminCreate = await createCustomer(bob.agent, {
      email: "admin@example.com",
    });
    expect(adminCreate.status).toBe(201);
  });

  it("isolates customers across organizations", async () => {
    const { app } = createTestApp();
    const alice = await registerAccount(app, {
      name: "Alice Stone",
      email: "alice@example.com",
      organizationName: "Alice Workspace",
    });
    const bob = await registerAccount(app, {
      name: "Bob Reed",
      email: "bob@example.com",
      organizationName: "Bob Workspace",
    });
    const created = await createCustomer(alice.agent);
    const customerId = (created.body as CustomerMutationResponse).customer.id;

    expect((await bob.agent.get(API_PATHS.customer(customerId))).status).toBe(404);

    const update = await bob.agent
      .patch(API_PATHS.customer(customerId))
      .set("Origin", TEST_ORIGIN)
      .send({ name: "Cross tenant" });
    expect(update.status).toBe(404);

    const archive = await bob.agent
      .post(API_PATHS.customerArchive(customerId))
      .set("Origin", TEST_ORIGIN);
    expect(archive.status).toBe(404);

    const bobList = await bob.agent.get(`${API_PATHS.customers}?status=ALL`);
    expect((bobList.body as CustomerListResponse).total).toBe(0);

    const invalidId = await bob.agent.get("/api/customers/not-a-uuid");
    expect(invalidId.status).toBe(400);
  });
});
