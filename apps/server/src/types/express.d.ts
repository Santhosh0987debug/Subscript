import type { AuthenticatedSession } from "../auth/types.js";
import type { OrganizationRole } from "@subscript/shared";

export interface ActiveOrganizationContext {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdAt: string;
}

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      auth?: AuthenticatedSession;
      organization?: ActiveOrganizationContext;
    }
  }
}

export {};
