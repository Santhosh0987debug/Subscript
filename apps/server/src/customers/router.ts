import { Router, type RequestHandler, type Response } from "express";
import type {
  BillingAddress,
  CustomerListResponse,
  CustomerMutationResponse,
  CustomerResponse,
} from "@subscript/shared";
import { API_PATHS } from "@subscript/shared";
import type { AuthenticatedSession } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import { parseBody, parseParams, parseQuery } from "../lib/validation.js";
import { toCustomer, toCustomerActivity } from "./serializer.js";
import {
  CustomerEmailConflictError,
  type CustomerRecord,
  type CustomerStore,
  type CustomerWriteFields,
} from "./types.js";
import {
  createCustomerSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from "./validation.js";

const ACTIVITY_LIMIT = 50;

export interface CustomersRouterOptions {
  customerStore: CustomerStore;
  authenticate: RequestHandler;
  requireOrganization: RequestHandler;
  requireAdmin: RequestHandler;
}

function duplicateEmailError(): AppError {
  return new AppError(
    409,
    "CONFLICT",
    "A customer with this email already exists in this organization.",
    [
      {
        path: "email",
        message: "Use a different email address for this customer.",
      },
    ],
  );
}

function actor(res: Response): {
  actorId: string | null;
  actorName: string | null;
} {
  const authenticated = res.locals.auth as AuthenticatedSession | undefined;

  return {
    actorId: authenticated?.session.user.id ?? null,
    actorName: authenticated?.session.user.name ?? null,
  };
}

function sameAddress(left: BillingAddress, right: BillingAddress): boolean {
  return (
    left.line1 === right.line1 &&
    left.line2 === right.line2 &&
    left.city === right.city &&
    left.region === right.region &&
    left.postalCode === right.postalCode &&
    left.country === right.country
  );
}

function changedFields(
  current: CustomerRecord,
  next: CustomerWriteFields,
): string[] {
  const changed: string[] = [];

  if (current.name !== next.name) {
    changed.push("name");
  }

  if (current.email !== next.email) {
    changed.push("email");
  }

  if (current.phone !== next.phone) {
    changed.push("phone");
  }

  if (current.company !== next.company) {
    changed.push("company");
  }

  if (!sameAddress(current.billingAddress, next.billingAddress)) {
    changed.push("billing address");
  }

  if (current.notes !== next.notes) {
    changed.push("notes");
  }

  return changed;
}

function updateMessage(fields: readonly string[]): string {
  if (fields.length === 1) {
    return `Updated the customer's ${fields[0]}.`;
  }

  const last = fields[fields.length - 1];
  const leading = fields.slice(0, -1).join(", ");

  return `Updated ${leading} and ${last}.`;
}

export function createCustomersRouter(
  options: CustomersRouterOptions,
): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    API_PATHS.customers,
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const query = parseQuery(customerListQuerySchema, req.query);
      const result = await options.customerStore.list(organization.id, {
        search: query.query && query.query.length > 0 ? query.query : null,
        status: query.status,
        sort: query.sort,
        direction: query.direction,
        page: query.page,
        pageSize: query.pageSize,
      });
      const totalPages =
        result.total === 0 ? 0 : Math.ceil(result.total / query.pageSize);
      const payload: CustomerListResponse = {
        customers: result.items.map(toCustomer),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages,
      };

      res.status(200).json(payload);
    },
  );

  router.post(
    API_PATHS.customers,
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const payload = parseBody(createCustomerSchema, req.body);
      const actorDetails = actor(res);

      let customer: CustomerRecord;

      try {
        customer = await options.customerStore.create({
          organizationId: organization.id,
          name: payload.name,
          email: payload.email,
          phone: payload.phone ?? null,
          company: payload.company ?? null,
          billingAddress: payload.billingAddress ?? {
            line1: "",
            line2: "",
            city: "",
            region: "",
            postalCode: "",
            country: "",
          },
          notes: payload.notes ?? null,
          activity: {
            message: "Created this customer.",
            ...actorDetails,
          },
        });
      } catch (error) {
        if (error instanceof CustomerEmailConflictError) {
          throw duplicateEmailError();
        }

        throw error;
      }

      const response: CustomerMutationResponse = {
        customer: toCustomer(customer),
      };

      res
        .location(API_PATHS.customer(customer.id))
        .status(201)
        .json(response);
    },
  );

  router.get(
    "/api/customers/:customerId",
    options.authenticate,
    options.requireOrganization,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(customerIdParamsSchema, req.params);
      const customer = await options.customerStore.findById(
        organization.id,
        params.customerId,
      );

      if (!customer) {
        throw new AppError(404, "NOT_FOUND", "That customer could not be found.");
      }

      const activities = await options.customerStore.listActivities(
        organization.id,
        customer.id,
        ACTIVITY_LIMIT,
      );
      const response: CustomerResponse = {
        customer: toCustomer(customer),
        activities: activities.map(toCustomerActivity),
      };

      res.status(200).json(response);
    },
  );

  router.patch(
    "/api/customers/:customerId",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(customerIdParamsSchema, req.params);
      const current = await options.customerStore.findById(
        organization.id,
        params.customerId,
      );

      if (!current) {
        throw new AppError(404, "NOT_FOUND", "That customer could not be found.");
      }

      const payload = parseBody(updateCustomerSchema, req.body);
      const next: CustomerWriteFields = {
        name: payload.name ?? current.name,
        email: payload.email ?? current.email,
        phone: payload.phone !== undefined ? payload.phone : current.phone,
        company:
          payload.company !== undefined ? payload.company : current.company,
        billingAddress: payload.billingAddress ?? current.billingAddress,
        notes: payload.notes !== undefined ? payload.notes : current.notes,
      };
      const changed = changedFields(current, next);

      if (changed.length === 0) {
        const response: CustomerMutationResponse = {
          customer: toCustomer(current),
        };
        res.status(200).json(response);
        return;
      }

      let customer: CustomerRecord | null;

      try {
        customer = await options.customerStore.update(
          organization.id,
          current.id,
          next,
          {
            message: updateMessage(changed),
            ...actor(res),
          },
        );
      } catch (error) {
        if (error instanceof CustomerEmailConflictError) {
          throw duplicateEmailError();
        }

        throw error;
      }

      if (!customer) {
        throw new AppError(404, "NOT_FOUND", "That customer could not be found.");
      }

      const response: CustomerMutationResponse = {
        customer: toCustomer(customer),
      };

      res.status(200).json(response);
    },
  );

  router.post(
    "/api/customers/:customerId/archive",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(customerIdParamsSchema, req.params);
      const customer = await options.customerStore.setStatus(
        organization.id,
        params.customerId,
        {
          status: "ARCHIVED",
          type: "ARCHIVED",
          activity: {
            message: "Archived this customer.",
            ...actor(res),
          },
        },
      );

      if (!customer) {
        throw new AppError(404, "NOT_FOUND", "That customer could not be found.");
      }

      const response: CustomerMutationResponse = {
        customer: toCustomer(customer),
      };

      res.status(200).json(response);
    },
  );

  router.post(
    "/api/customers/:customerId/restore",
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const params = parseParams(customerIdParamsSchema, req.params);
      const customer = await options.customerStore.setStatus(
        organization.id,
        params.customerId,
        {
          status: "ACTIVE",
          type: "RESTORED",
          activity: {
            message: "Restored this customer.",
            ...actor(res),
          },
        },
      );

      if (!customer) {
        throw new AppError(404, "NOT_FOUND", "That customer could not be found.");
      }

      const response: CustomerMutationResponse = {
        customer: toCustomer(customer),
      };

      res.status(200).json(response);
    },
  );

  return router;
}
