import type {
  Customer,
  CustomerActivity,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function toNullable(value: string): string | null {
  return value.length > 0 ? value : null;
}

function mapCustomer(customer: Customer): CustomerRecord {
  return {
    id: customer.id,
    organizationId: customer.organizationId,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    company: customer.company,
    billingAddress: {
      line1: customer.billingAddressLine1 ?? "",
      line2: customer.billingAddressLine2 ?? "",
      city: customer.billingCity ?? "",
      region: customer.billingRegion ?? "",
      postalCode: customer.billingPostalCode ?? "",
      country: customer.billingCountry ?? "",
    },
    notes: customer.notes,
    status: customer.status,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function mapActivity(activity: CustomerActivity): CustomerActivityRecord {
  return {
    id: activity.id,
    type: activity.type,
    message: activity.message,
    actorName: activity.actorName,
    createdAt: activity.createdAt,
  };
}

function addressColumns(fields: CustomerWriteFields) {
  return {
    billingAddressLine1: toNullable(fields.billingAddress.line1),
    billingAddressLine2: toNullable(fields.billingAddress.line2),
    billingCity: toNullable(fields.billingAddress.city),
    billingRegion: toNullable(fields.billingAddress.region),
    billingPostalCode: toNullable(fields.billingAddress.postalCode),
    billingCountry: toNullable(fields.billingAddress.country),
  };
}

function customerColumns(fields: CustomerWriteFields) {
  return {
    name: fields.name,
    email: fields.email,
    phone: fields.phone,
    company: fields.company,
    notes: fields.notes,
    ...addressColumns(fields),
  };
}

function orderBy(
  options: CustomerListOptions,
): Prisma.CustomerOrderByWithRelationInput {
  return {
    [options.sort]: options.direction,
  } as Prisma.CustomerOrderByWithRelationInput;
}

export function createPrismaCustomerStore(
  prisma: PrismaClient,
): CustomerStore {
  return {
    async list(
      organizationId,
      options: CustomerListOptions,
    ): Promise<CustomerListResult> {
      const where: Prisma.CustomerWhereInput = {
        organizationId,
        ...(options.status === "ALL" ? {} : { status: options.status }),
        ...(options.search
          ? {
              OR: [
                {
                  name: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
                {
                  email: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
                {
                  company: {
                    contains: options.search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      };
      const skip = (options.page - 1) * options.pageSize;
      const [items, total] = await prisma.$transaction([
        prisma.customer.findMany({
          where,
          orderBy: [
            orderBy(options),
            { id: "asc" },
          ],
          skip,
          take: options.pageSize,
        }),
        prisma.customer.count({ where }),
      ]);

      return { items: items.map(mapCustomer), total };
    },

    async findById(organizationId, customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      });

      return customer ? mapCustomer(customer) : null;
    },

    async findByEmail(organizationId, email, excludeCustomerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          organizationId,
          email: { equals: email, mode: "insensitive" },
          ...(excludeCustomerId ? { id: { not: excludeCustomerId } } : {}),
        },
      });

      return customer ? mapCustomer(customer) : null;
    },

    async create(input: CreateCustomerInput) {
      try {
        return await prisma.$transaction(async (tx) => {
          const customer = await tx.customer.create({
            data: {
              organizationId: input.organizationId,
              ...customerColumns(input),
            },
          });

          await tx.customerActivity.create({
            data: activityData(customer.id, input.organizationId, "CREATED", input.activity),
          });

          return mapCustomer(customer);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new CustomerEmailConflictError();
        }

        throw error;
      }
    },

    async update(
      organizationId,
      customerId,
      fields: CustomerWriteFields,
      activity: CustomerActivityInput,
    ) {
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.customer.findFirst({
            where: { id: customerId, organizationId },
          });

          if (!existing) {
            return null;
          }

          const customer = await tx.customer.update({
            where: { id: existing.id },
            data: customerColumns(fields),
          });

          await tx.customerActivity.create({
            data: activityData(customer.id, organizationId, "UPDATED", activity),
          });

          return mapCustomer(customer);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new CustomerEmailConflictError();
        }

        throw error;
      }
    },

    async setStatus(
      organizationId,
      customerId,
      change: CustomerStatusChange,
    ) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id: customerId, organizationId },
        });

        if (!existing) {
          return null;
        }

        if (existing.status === change.status) {
          return mapCustomer(existing);
        }

        const customer = await tx.customer.update({
          where: { id: existing.id },
          data: { status: change.status },
        });

        await tx.customerActivity.create({
          data: activityData(
            customer.id,
            organizationId,
            change.type,
            change.activity,
          ),
        });

        return mapCustomer(customer);
      });
    },

    async listActivities(organizationId, customerId, limit) {
      const activities = await prisma.customerActivity.findMany({
        where: { organizationId, customerId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return activities.map(mapActivity);
    },
  };
}

function activityData(
  customerId: string,
  organizationId: string,
  type: CustomerActivity["type"],
  activity: CustomerActivityInput,
) {
  return {
    organizationId,
    customerId,
    type,
    message: activity.message,
    actorId: activity.actorId,
    actorName: activity.actorName,
  };
}
