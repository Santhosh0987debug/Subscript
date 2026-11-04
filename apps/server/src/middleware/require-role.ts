import type { RequestHandler } from "express";
import type { OrganizationRole } from "@subscript/shared";
import { AppError } from "../errors/app-error.js";

export function requireRole(...allowedRoles: readonly OrganizationRole[]): RequestHandler {
  return (_req, res, next) => {
    const organization = res.locals.organization;

    if (!organization) {
      next(new AppError(403, "FORBIDDEN", "No active organization."));
      return;
    }

    if (!allowedRoles.includes(organization.role)) {
      next(
        new AppError(
          403,
          "FORBIDDEN",
          "Your role does not allow this action.",
        ),
      );
      return;
    }

    next();
  };
}
