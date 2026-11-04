import type {
  OrganizationMemberSummary,
  OrganizationRole,
  SessionResponse,
} from "@subscript/shared";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface MembershipRecord {
  organization: OrganizationRecord;
  role: OrganizationRole;
  joinedAt: Date;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  activeOrganizationId: string | null;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface SessionContext {
  user: UserRecord;
  session: SessionRecord;
  memberships: MembershipRecord[];
}

export interface CreateAccountInput {
  user: {
    email: string;
    name: string;
    passwordHash: string;
  };
  organization: {
    name: string;
    slug: string;
  };
  session: {
    tokenHash: string;
    expiresAt: Date;
  };
}

export interface CreateAccountResult {
  user: UserRecord;
  organization: OrganizationRecord;
  membership: MembershipRecord;
  session: SessionRecord;
}

export interface CreateSessionInput {
  tokenHash: string;
  userId: string;
  activeOrganizationId: string | null;
  expiresAt: Date;
}

export type UniqueField = "email" | "slug";

export class UniqueConstraintError extends Error {
  readonly field: UniqueField;

  constructor(field: UniqueField) {
    super(`A record with that ${field} already exists.`);
    this.name = "UniqueConstraintError";
    this.field = field;
  }
}

export interface AuthStore {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  listMemberships(userId: string): Promise<MembershipRecord[]>;
  createAccount(input: CreateAccountInput): Promise<CreateAccountResult>;
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  findSessionContext(tokenHash: string): Promise<SessionContext | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setActiveOrganization(sessionId: string, organizationId: string): Promise<void>;
  touchSession(sessionId: string, at: Date): Promise<void>;
  updateLastLogin(userId: string, at: Date): Promise<void>;
  findMembership(userId: string, organizationId: string): Promise<MembershipRecord | null>;
  listMembers(organizationId: string): Promise<OrganizationMemberSummary[]>;
  updateOrganizationName(organizationId: string, name: string): Promise<OrganizationRecord>;
}

export interface AuthenticatedSession {
  sessionId: string;
  session: SessionResponse;
}
