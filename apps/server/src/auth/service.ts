import type {
  AuthUser,
  OrganizationMemberSummary,
  OrganizationMembershipSummary,
  OrganizationRole,
  SessionResponse,
} from "@subscript/shared";
import { AppError } from "../errors/app-error.js";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password.js";
import {
  createOrganizationSlug,
  createSessionToken,
  hashSessionToken,
} from "./session-token.js";
import {
  UniqueConstraintError,
  type AuthStore,
  type AuthenticatedSession,
  type MembershipRecord,
  type OrganizationRecord,
  type UserRecord,
} from "./types.js";

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const ROLE_ORDER: Record<OrganizationRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  MEMBER: 2,
};

export interface AuthServiceOptions {
  store: AuthStore;
  passwordCost: number;
  sessionTtlMs: number;
  now?: () => Date;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  session: SessionResponse;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  logout(token: string | undefined): Promise<void>;
  resolveSession(token: string | undefined): Promise<AuthenticatedSession | null>;
  switchOrganization(
    token: string | undefined,
    organizationId: string,
  ): Promise<SessionResponse>;
  listMembers(organizationId: string): Promise<OrganizationMemberSummary[]>;
  updateOrganizationName(
    organizationId: string,
    name: string,
  ): Promise<OrganizationRecord>;
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

function toMembershipSummary(
  membership: MembershipRecord,
): OrganizationMembershipSummary {
  return {
    id: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    role: membership.role,
    joinedAt: membership.joinedAt.toISOString(),
    createdAt: membership.organization.createdAt.toISOString(),
  };
}

function sortMembers(
  members: readonly OrganizationMemberSummary[],
): OrganizationMemberSummary[] {
  return [...members].sort(
    (left, right) =>
      ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
      left.name.localeCompare(right.name),
  );
}

export function createAuthService(options: AuthServiceOptions): AuthService {
  const { store, passwordCost, sessionTtlMs } = options;
  const now = options.now ?? (() => new Date());

  function buildSession(
    user: UserRecord,
    memberships: readonly MembershipRecord[],
    activeOrganizationId: string | null,
  ): SessionResponse {
    const organizations = memberships.map(toMembershipSummary);
    const activeExists = organizations.some(
      (organization) => organization.id === activeOrganizationId,
    );

    return {
      user: toAuthUser(user),
      organizations,
      activeOrganizationId: activeExists
        ? activeOrganizationId
        : (organizations[0]?.id ?? null),
    };
  }

  async function createSessionForUser(
    user: UserRecord,
    memberships: readonly MembershipRecord[],
    activeOrganizationId: string | null,
  ): Promise<AuthResult> {
    const token = createSessionToken();
    const session = buildSession(user, memberships, activeOrganizationId);

    await store.createSession({
      tokenHash: hashSessionToken(token),
      userId: user.id,
      activeOrganizationId: session.activeOrganizationId,
      expiresAt: new Date(now().getTime() + sessionTtlMs),
    });

    return { token, session };
  }

  async function resolveSession(
    token: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!token) {
      return null;
    }

    const context = await store.findSessionContext(hashSessionToken(token));

    if (!context) {
      return null;
    }

    const at = now();

    if (context.session.expiresAt.getTime() <= at.getTime()) {
      await store.deleteSession(context.session.id);
      return null;
    }

    const activeOrganizationId = buildSession(
      context.user,
      context.memberships,
      context.session.activeOrganizationId,
    ).activeOrganizationId;

    if (activeOrganizationId !== context.session.activeOrganizationId) {
      if (activeOrganizationId) {
        await store.setActiveOrganization(context.session.id, activeOrganizationId);
      }
    } else if (
      at.getTime() - context.session.lastUsedAt.getTime() >
      SESSION_TOUCH_INTERVAL_MS
    ) {
      await store.touchSession(context.session.id, at);
    }

    return {
      sessionId: context.session.id,
      session: buildSession(context.user, context.memberships, activeOrganizationId),
    };
  }

  return {
    async register(input) {
      const passwordHash = await hashPassword(input.password, passwordCost);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const token = createSessionToken();
        const slug = createOrganizationSlug(input.organizationName);

        try {
          const result = await store.createAccount({
            user: {
              email: input.email,
              name: input.name,
              passwordHash,
            },
            organization: {
              name: input.organizationName,
              slug,
            },
            session: {
              tokenHash: hashSessionToken(token),
              expiresAt: new Date(now().getTime() + sessionTtlMs),
            },
          });

          return {
            token,
            session: buildSession(result.user, [result.membership], result.organization.id),
          };
        } catch (error) {
          if (error instanceof UniqueConstraintError) {
            if (error.field === "email") {
              throw new AppError(
                409,
                "CONFLICT",
                "An account with this email already exists.",
              );
            }

            continue;
          }

          throw error;
        }
      }

      throw new AppError(
        409,
        "CONFLICT",
        "We could not reserve a workspace address. Please try again.",
      );
    },

    async login(input) {
      const user = await store.findUserByEmail(input.email);

      if (!user) {
        await verifyDummyPassword(input.password);
        throw new AppError(401, "UNAUTHORIZED", "Invalid email or password.");
      }

      const passwordMatches = await verifyPassword(input.password, user.passwordHash);

      if (!passwordMatches) {
        throw new AppError(401, "UNAUTHORIZED", "Invalid email or password.");
      }

      const at = now();
      await store.updateLastLogin(user.id, at);
      const memberships = await store.listMemberships(user.id);

      return createSessionForUser(
        { ...user, lastLoginAt: at },
        memberships,
        memberships[0]?.organization.id ?? null,
      );
    },

    async logout(token) {
      if (!token) {
        return;
      }

      await store.deleteSessionByTokenHash(hashSessionToken(token));
    },

    resolveSession,

    async switchOrganization(token, organizationId) {
      const authenticated = await resolveSession(token);

      if (!authenticated) {
        throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
      }

      const membership = await store.findMembership(
        authenticated.session.user.id,
        organizationId,
      );

      if (!membership) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "You do not have access to that organization.",
        );
      }

      await store.setActiveOrganization(authenticated.sessionId, membership.organization.id);

      return {
        ...authenticated.session,
        activeOrganizationId: membership.organization.id,
      };
    },

    async listMembers(organizationId) {
      return sortMembers(await store.listMembers(organizationId));
    },

    async updateOrganizationName(organizationId, name) {
      return store.updateOrganizationName(organizationId, name);
    },
  };
}
