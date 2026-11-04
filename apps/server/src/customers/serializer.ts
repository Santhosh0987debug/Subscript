import type { Customer, CustomerActivity } from "@subscript/shared";
import type {
  CustomerActivityRecord,
  CustomerRecord,
} from "./types.js";

export function toCustomer(customer: CustomerRecord): Customer {
  return {
    id: customer.id,
    organizationId: customer.organizationId,
    name: customer.name,
    email: customer.email,
    phone: customer.phone ?? "",
    company: customer.company ?? "",
    billingAddress: { ...customer.billingAddress },
    notes: customer.notes ?? "",
    status: customer.status,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export function toCustomerActivity(
  activity: CustomerActivityRecord,
): CustomerActivity {
  return {
    id: activity.id,
    type: activity.type,
    message: activity.message,
    actorName: activity.actorName,
    createdAt: activity.createdAt.toISOString(),
  };
}
