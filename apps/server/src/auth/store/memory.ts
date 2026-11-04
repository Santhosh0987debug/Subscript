import { randomUUID } from "node:crypto";
import type { OrganizationRole } from "@subscript/shared";
import {
  UniqueConstraintError,
  type AuthStore,
  type CreateAccountInput,
  type CreateAccountResult,
  type CreateSessionInput,
  type MembershipRecord,
  type OrganizationRecord,
  type SessionContext,
  type SessionRecord,
  type UserRecord,
} from "../types.js";

interface MemoryMembership {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  joinedAt: Date;
}

const ROLE_ORDER: Record<OrganizationRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  MEMBER: 2,
};

export interface MemoryAuthStore extends AuthStore {
  /**
   * Test and local-preview helper. There is intentionally no public invite
   * endpoint in Phase 2.
   */
  addMember(organizationId: string, userId: string, role: OrganizationRole): void;
}

/**
 * In-memory implementation used by tests and by local development when no
 * PostgreSQL connection is configured. Production always uses Prisma.
 */
export function createMemoryAuthStore(): MemoryAuthStore {
  const users = new Map<string, UserRecord>();
  const usersByEmail = new Map<string, string>();
  const organizations = new Map<string, OrganizationRecord>();
  const memberships: MemoryMembership[] = [];
  const sessions = new Map<string, SessionRecord>();
  const sessionIdsByTokenHash = new Map<string, string>();

  function requireUser(userId: string): UserRecord {
    const user = users.get(userId);

    if (!user) {
      throw new Error(`Memory store is missing user ${userId}.`);
    }

    return user;
  }

  function requireOrganization(organizationId: string): OrganizationRecord {
    const organization = organizations.get(organizationId);

    if (!organization) {
      throw new Error(`Memory store is missing organization ${organizationId}.`);
    }

    return organization;
  }

  function membershipsForUser(userId: string): MembershipRecord[] {
    return memberships
      .filter((membership) => membership.userId === userId)
      .map((membership) => ({
        organization: requireOrganization(membership.organizationId),
        role: membership.role,
        joinedAt: membership.joinedAt,
      }))
      .sort((left, right) => left.joinedAt.getTime() - right.joinedAt.getTime());
  }

  function createSessionRecord(input: CreateSessionInput): SessionRecord {
    const now = new Date();
    const session: SessionRecord = {
      id: randomUUID(),
      tokenHash: input.tokenHash,
      userId: input.userId,
      activeOrganizationId: input.activeOrganizationId,
      expiresAt: input.expiresAt,
      createdAt: now,
      lastUsedAt: now,
    };

    sessions.set(session.id, session);
    sessionIdsByTokenHash.set(session.tokenHash, session.id);

    return session;
  }

  return {
    async findUserByEmail(email) {
      const id = usersByEmail.get(email);
      return id ? (users.get(id) ?? null) : null;
    },

    async listMemberships(userId) {
      return membershipsForUser(userId);
    },

    async createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
      if (usersByEmail.has(input.user.email)) {
        throw new UniqueConstraintError("email");
      }

      if ([...organizations.values()].some((org) => org.slug === input.organization.slug)) {
        throw new UniqueConstraintError("slug");
      }

      const now = new Date();
      const user: UserRecord = {
        id: randomUUID(),
        email: input.user.email,
        name: input.user.name,
        passwordHash: input.user.passwordHash,
        createdAt: now,
        lastLoginAt: null,
      };
      const organization: OrganizationRecord = {
        id: randomUUID(),
        name: input.organization.name,
        slug: input.organization.slug,
        createdAt: now,
      };
      const membership: MemoryMembership = {
        organizationId: organization.id,
        userId: user.id,
        role: "OWNER",
        joinedAt: now,
      };
      const session = createSessionRecord({
        tokenHash: input.session.tokenHash,
        userId: user.id,
        activeOrganizationId: organization.id,
        expiresAt: input.session.expiresAt,
      });

      users.set(user.id, user);
      usersByEmail.set(user.email, user.id);
      organizations.set(organization.id, organization);
      memberships.push(membership);

      return {
        user,
        organization,
        membership: {
          organization,
          role: membership.role,
          joinedAt: membership.joinedAt,
        },
        session,
      };
    },

    async createSession(input) {
      return createSessionRecord(input);
    },

    async findSessionContext(tokenHash): Promise<SessionContext | null> {
      const sessionId = sessionIdsByTokenHash.get(tokenHash);

      if (!sessionId) {
        return null;
      }

      const session = sessions.get(sessionId);

      if (!session) {
        return null;
      }

      const user = users.get(session.userId);

      if (!user) {
        return null;
      }

      return {
        user,
        session,
        memberships: membershipsForUser(user.id),
      };
    },

    async deleteSessionByTokenHash(tokenHash) {
      const sessionId = sessionIdsByTokenHash.get(tokenHash);

      if (!sessionId) {
        return;
      }

      sessionIdsByTokenHash.delete(tokenHash);
      sessions.delete(sessionId);
    },

    async deleteSession(sessionId) {
      const session = sessions.get(sessionId);

      if (!session) {
        return;
      }

      sessionIdsByTokenHash.delete(session.tokenHash);
      sessions.delete(sessionId);
    },

    async setActiveOrganization(sessionId, organizationId) {
      const session = sessions.get(sessionId);

      if (session) {
        session.activeOrganizationId = organizationId;
      }
    },

    async touchSession(sessionId, at) {
      const session = sessions.get(sessionId);

      if (session) {
        session.lastUsedAt = at;
      }
    },

    async updateLastLogin(userId, at) {
      const user = users.get(userId);

      if (user) {
        user.lastLoginAt = at;
      }
    },

    async findMembership(userId, organizationId) {
      const membership = memberships.find(
        (candidate) =>
          candidate.userId === userId && candidate.organizationId === organizationId,
      );

      if (!membership) {
        return null;
      }

      return {
        organization: requireOrganization(membership.organizationId),
        role: membership.role,
        joinedAt: membership.joinedAt,
      };
    },

    async listMembers(organizationId) {
      return memberships
        .filter((membership) => membership.organizationId === organizationId)
        .map((membership) => {
          const user = requireUser(membership.userId);

          return {
            userId: user.id,
            name: user.name,
            email: user.email,
            role: membership.role,
            joinedAt: membership.joinedAt.toISOString(),
          };
        })
        .sort(
          (left, right) =>
            ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
            left.name.localeCompare(right.name),
        );
    },

    async updateOrganizationName(organizationId, name) {
      const organization = requireOrganization(organizationId);
      organization.name = name;
      return organization;
    },

    addMember(organizationId, userId, role) {
      requireOrganization(organizationId);
      requireUser(userId);

      const existing = memberships.find(
        (membership) =>
          membership.organizationId === organizationId && membership.userId === userId,
      );

      if (existing) {
        existing.role = role;
        return;
      }

      memberships.push({
        organizationId,
        userId,
        role,
        joinedAt: new Date(),
      });
    },
  };
}
