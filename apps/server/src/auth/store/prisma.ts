import type { OrganizationRole } from "@subscript/shared";
import type { PrismaClient } from "../../generated/prisma/client.js";
import {
  UniqueConstraintError,
  type AuthStore,
  type CreateAccountResult,
  type MembershipRecord,
  type OrganizationRecord,
  type SessionContext,
  type SessionRecord,
  type UniqueField,
  type UserRecord,
} from "../types.js";

interface UniqueViolation {
  code: "P2002";
  meta?: {
    target?: unknown;
  };
}

function isUniqueViolation(error: unknown): error is UniqueViolation {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function uniqueField(error: UniqueViolation): UniqueField | null {
  const target = error.meta?.target;
  const targetText = Array.isArray(target) ? target.join(",") : String(target ?? "");

  if (targetText.includes("email")) {
    return "email";
  }

  if (targetText.includes("slug")) {
    return "slug";
  }

  return null;
}

function mapUser(user: {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}): UserRecord {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function mapOrganization(organization: {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}): OrganizationRecord {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
  };
}

function mapSession(session: {
  id: string;
  tokenHash: string;
  userId: string;
  activeOrganizationId: string | null;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
}): SessionRecord {
  return {
    id: session.id,
    tokenHash: session.tokenHash,
    userId: session.userId,
    activeOrganizationId: session.activeOrganizationId,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
  };
}

export function createPrismaAuthStore(prisma: PrismaClient): AuthStore {
  return {
    async findUserByEmail(email) {
      const user = await prisma.user.findUnique({ where: { email } });
      return user ? mapUser(user) : null;
    },

    async listMemberships(userId): Promise<MembershipRecord[]> {
      const records = await prisma.organizationMember.findMany({
        where: { userId },
        include: { organization: true },
        orderBy: { createdAt: "asc" },
      });

      return records.map((record) => ({
        organization: mapOrganization(record.organization),
        role: record.role as OrganizationRole,
        joinedAt: record.createdAt,
      }));
    },

    async createAccount(input): Promise<CreateAccountResult> {
      try {
        return await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: input.user.email,
              name: input.user.name,
              passwordHash: input.user.passwordHash,
            },
          });
          const organization = await tx.organization.create({
            data: {
              name: input.organization.name,
              slug: input.organization.slug,
            },
          });
          const membership = await tx.organizationMember.create({
            data: {
              organizationId: organization.id,
              userId: user.id,
              role: "OWNER",
            },
          });
          const session = await tx.session.create({
            data: {
              tokenHash: input.session.tokenHash,
              userId: user.id,
              activeOrganizationId: organization.id,
              expiresAt: input.session.expiresAt,
            },
          });

          return {
            user: mapUser(user),
            organization: mapOrganization(organization),
            membership: {
              organization: mapOrganization(organization),
              role: membership.role as OrganizationRole,
              joinedAt: membership.createdAt,
            },
            session: mapSession(session),
          };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const field = uniqueField(error);

          if (field) {
            throw new UniqueConstraintError(field);
          }
        }

        throw error;
      }
    },

    async createSession(input) {
      const session = await prisma.session.create({
        data: {
          tokenHash: input.tokenHash,
          userId: input.userId,
          activeOrganizationId: input.activeOrganizationId,
          expiresAt: input.expiresAt,
        },
      });

      return mapSession(session);
    },

    async findSessionContext(tokenHash): Promise<SessionContext | null> {
      const record = await prisma.session.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: {
              memberships: {
                include: { organization: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });

      if (!record) {
        return null;
      }

      return {
        user: mapUser(record.user),
        session: mapSession(record),
        memberships: record.user.memberships.map((membership) => ({
          organization: mapOrganization(membership.organization),
          role: membership.role as OrganizationRole,
          joinedAt: membership.createdAt,
        })),
      };
    },

    async deleteSessionByTokenHash(tokenHash) {
      await prisma.session.deleteMany({ where: { tokenHash } });
    },

    async deleteSession(sessionId) {
      await prisma.session.deleteMany({ where: { id: sessionId } });
    },

    async setActiveOrganization(sessionId, organizationId) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { activeOrganizationId: organizationId },
      });
    },

    async touchSession(sessionId, at) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { lastUsedAt: at },
      });
    },

    async updateLastLogin(userId, at) {
      await prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: at },
      });
    },

    async findMembership(userId, organizationId) {
      const record = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId, userId },
        },
        include: { organization: true },
      });

      if (!record) {
        return null;
      }

      return {
        organization: mapOrganization(record.organization),
        role: record.role as OrganizationRole,
        joinedAt: record.createdAt,
      };
    },

    async listMembers(organizationId) {
      const records = await prisma.organizationMember.findMany({
        where: { organizationId },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });

      return records.map((record) => ({
        userId: record.user.id,
        name: record.user.name,
        email: record.user.email,
        role: record.role as OrganizationRole,
        joinedAt: record.createdAt.toISOString(),
      }));
    },

    async updateOrganizationName(organizationId, name) {
      const organization = await prisma.organization.update({
        where: { id: organizationId },
        data: { name },
      });

      return mapOrganization(organization);
    },
  };
}
