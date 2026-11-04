import { randomUUID } from "node:crypto";
import type { CustomerSortField } from "@subscript/shared";
import {
  CustomerEmailConflictError,
  type CreateCustomerInput,
  type CustomerActivityInput,
  type CustomerActivityRecord,
  type CustomerListOptions,
  type CustomerListResult,
  type CustomerRecord,
  type CustomerStatusChange,
  type CustomerStore,
  type CustomerWriteFields,
} from "../types.js";

interface MemoryActivity extends CustomerActivityRecord {
  organizationId: string;
  customerId: string;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function compareCustomers(
  left: CustomerRecord,
  right: CustomerRecord,
  sort: CustomerSortField,
): number {
  switch (sort) {
    case "name":
      return compareText(left.name, right.name);
    case "email":
      return compareText(left.email, right.email);
    case "company":
      return compareText(left.company ?? "", right.company ?? "");
    case "status":
      return compareText(left.status, right.status);
    case "createdAt":
      return left.createdAt.getTime() - right.createdAt.getTime();
    case "updatedAt":
      return left.updatedAt.getTime() - right.updatedAt.getTime();
  }
}

function matchesSearch(customer: CustomerRecord, search: string): boolean {
  const haystack = [
    customer.name,
    customer.email,
    customer.company ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

export function createMemoryCustomerStore(): CustomerStore {
  const customers = new Map<string, CustomerRecord>();
  const activities: MemoryActivity[] = [];

  function findScoped(
    organizationId: string,
    customerId: string,
  ): CustomerRecord | null {
    const customer = customers.get(customerId);

    return customer?.organizationId === organizationId ? customer : null;
  }

  function findCustomerByEmail(
    organizationId: string,
    email: string,
    excludeCustomerId?: string,
  ): CustomerRecord | null {
    const normalized = email.toLowerCase();

    return (
      [...customers.values()].find(
        (customer) =>
          customer.organizationId === organizationId &&
          customer.id !== excludeCustomerId &&
          customer.email.toLowerCase() === normalized,
      ) ?? null
    );
  }

  function recordActivity(
    organizationId: string,
    customerId: string,
    type: CustomerActivityRecord["type"],
    activity: CustomerActivityInput,
  ): void {
    activities.push({
      id: randomUUID(),
      organizationId,
      customerId,
      type,
      message: activity.message,
      actorName: activity.actorName,
      createdAt: new Date(),
    });
  }

  return {
    async list(
      organizationId,
      options: CustomerListOptions,
    ): Promise<CustomerListResult> {
      const search = options.search?.toLowerCase() ?? null;
      const filtered = [...customers.values()].filter(
        (customer) =>
          customer.organizationId === organizationId &&
          (options.status === "ALL" || customer.status === options.status) &&
          (!search || matchesSearch(customer, search)),
      );
      const direction = options.direction === "asc" ? 1 : -1;

      filtered.sort(
        (left, right) =>
          compareCustomers(left, right, options.sort) * direction ||
          left.id.localeCompare(right.id),
      );

      const start = (options.page - 1) * options.pageSize;

      return {
        items: filtered.slice(start, start + options.pageSize),
        total: filtered.length,
      };
    },

    async findById(organizationId, customerId) {
      return findScoped(organizationId, customerId);
    },

    async findByEmail(organizationId, email, excludeCustomerId) {
      return findCustomerByEmail(organizationId, email, excludeCustomerId);
    },

    async create(input: CreateCustomerInput) {
      const duplicate = findCustomerByEmail(
        input.organizationId,
        input.email,
      );

      if (duplicate) {
        throw new CustomerEmailConflictError();
      }

      const now = new Date();
      const customer: CustomerRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        company: input.company,
        billingAddress: { ...input.billingAddress },
        notes: input.notes,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };

      customers.set(customer.id, customer);
      recordActivity(
        customer.organizationId,
        customer.id,
        "CREATED",
        input.activity,
      );

      return customer;
    },

    async update(
      organizationId,
      customerId,
      fields: CustomerWriteFields,
      activity,
    ) {
      const customer = findScoped(organizationId, customerId);

      if (!customer) {
        return null;
      }

      if (findCustomerByEmail(organizationId, fields.email, customerId)) {
        throw new CustomerEmailConflictError();
      }

      Object.assign(customer, fields, {
        billingAddress: { ...fields.billingAddress },
        updatedAt: new Date(),
      });
      recordActivity(organizationId, customerId, "UPDATED", activity);

      return customer;
    },

    async setStatus(
      organizationId,
      customerId,
      change: CustomerStatusChange,
    ) {
      const customer = findScoped(organizationId, customerId);

      if (!customer) {
        return null;
      }

      if (customer.status !== change.status) {
        customer.status = change.status;
        customer.updatedAt = new Date();
        recordActivity(
          organizationId,
          customerId,
          change.type,
          change.activity,
        );
      }

      return customer;
    },

    async listActivities(organizationId, customerId, limit) {
      if (!findScoped(organizationId, customerId)) {
        return [];
      }

      return activities
        .filter(
          (activity) =>
            activity.organizationId === organizationId &&
            activity.customerId === customerId,
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, limit)
        .map(({ id, type, message, actorName, createdAt }) => ({
          id,
          type,
          message,
          actorName,
          createdAt,
        }));
    },
  };
}
