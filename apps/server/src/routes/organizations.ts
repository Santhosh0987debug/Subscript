import { Router, type RequestHandler } from "express";
import type {
  CurrentOrganizationResponse,
  OrganizationDetails,
  UpdateOrganizationResponse,
} from "@subscript/shared";
import { API_PATHS } from "@subscript/shared";
import type { AuthService } from "../auth/service.js";
import type { OrganizationRecord } from "../auth/types.js";
import {
  organizationIdParamsSchema,
  updateOrganizationSchema,
} from "../auth/validation.js";
import { AppError } from "../errors/app-error.js";
import { parseBody, parseParams } from "../lib/validation.js";
import { readSessionToken } from "../middleware/authenticate.js";

export interface OrganizationsRouterOptions {
  authService: AuthService;
  authenticate: RequestHandler;
  requireOrganization: RequestHandler;
  requireAdmin: RequestHandler;
  cookieName?: string;
}

function toOrganizationDetails(organization: {
  id: string;
  name: string;
  slug: string;
  createdAt: string | Date;
}): OrganizationDetails {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt:
      typeof organization.createdAt === "string"
        ? organization.createdAt
        : organization.createdAt.toISOString(),
  };
}

function toDetailsFromRecord(organization: OrganizationRecord): OrganizationDetails {
  return toOrganizationDetails(organization);
}

export function createOrganizationsRouter(options: OrganizationsRouterOptions): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get(
    API_PATHS.currentOrganization,
    options.authenticate,
    options.requireOrganization,
    async (_req, res) => {
      const authenticated = res.locals.auth;
      const organization = res.locals.organization;

      if (!authenticated || !organization) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
      }

      const members = await options.authService.listMembers(organization.id);
      const payload: CurrentOrganizationResponse = {
        organization: toOrganizationDetails(organization),
        role: organization.role,
        members,
      };

      res.status(200).json(payload);
    },
  );

  router.patch(
    API_PATHS.currentOrganization,
    options.authenticate,
    options.requireOrganization,
    options.requireAdmin,
    async (req, res) => {
      const organization = res.locals.organization;

      if (!organization) {
        throw new AppError(403, "FORBIDDEN", "No active organization.");
      }

      const payload = parseBody(updateOrganizationSchema, req.body);
      const updated = await options.authService.updateOrganizationName(
        organization.id,
        payload.name,
      );
      const response: UpdateOrganizationResponse = {
        organization: toDetailsFromRecord(updated),
      };

      res.status(200).json(response);
    },
  );

  router.post(
    "/api/organizations/:organizationId/switch",
    options.authenticate,
    async (req, res) => {
      const params = parseParams(organizationIdParamsSchema, req.params);
      const token = readSessionToken(req, options.cookieName);

      if (!token) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
      }

      const session = await options.authService.switchOrganization(
        token,
        params.organizationId,
      );

      res.status(200).json(session);
    },
  );

  return router;
}
