import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const requireOrganization: RequestHandler = (_req, res, next) => {
  const authenticated = res.locals.auth;

  if (!authenticated) {
    next(new AppError(401, "UNAUTHORIZED", "Sign in to continue."));
    return;
  }

  const activeOrganizationId = authenticated.session.activeOrganizationId;

  if (!activeOrganizationId) {
    next(
      new AppError(
        403,
        "FORBIDDEN",
        "No organization is selected for this session.",
      ),
    );
    return;
  }

  const activeOrganization = authenticated.session.organizations.find(
    (organization) => organization.id === activeOrganizationId,
  );

  if (!activeOrganization) {
    next(
      new AppError(
        403,
        "FORBIDDEN",
        "You no longer have access to this organization.",
      ),
    );
    return;
  }

  res.locals.organization = {
    id: activeOrganization.id,
    name: activeOrganization.name,
    slug: activeOrganization.slug,
    role: activeOrganization.role,
    createdAt: activeOrganization.createdAt,
  };
  next();
};
