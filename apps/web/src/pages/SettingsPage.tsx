import { useEffect, useState, type FormEvent } from "react";
import {
  Building2,
  CircleAlert,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { CurrentOrganizationResponse, OrganizationRole } from "@subscript/shared";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextField } from "@/components/ui/TextField";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getCurrentOrganization, updateOrganizationName } from "@/lib/api";
import { getErrorMessage, getFieldErrors, isUnauthorizedError } from "@/lib/errors";
import {
  formatWorkspaceDate,
  getInitials,
  getOrganizationRoleLabel,
} from "@/lib/identity";

type SettingsState =
  | { status: "loading" }
  | { status: "ready"; data: CurrentOrganizationResponse }
  | { status: "error"; message: string };

const roleTones: Record<OrganizationRole, BadgeTone> = {
  OWNER: "lime",
  ADMIN: "dark",
  MEMBER: "outline",
};

const roleGuidance: ReadonlyArray<{
  role: OrganizationRole;
  summary: string;
  detail: string;
}> = [
  {
    role: "OWNER",
    summary: "The first member of every workspace.",
    detail:
      "Owners can update the workspace profile and always retain full visibility of the team.",
  },
  {
    role: "ADMIN",
    summary: "Trusted workspace operators.",
    detail:
      "Admins can update workspace settings and review every member in the organization.",
  },
  {
    role: "MEMBER",
    summary: "The people doing the work.",
    detail:
      "Members can use the workspace and see the team. Workspace settings remain read-only.",
  },
];

function canManageWorkspace(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function SettingsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="mt-9 space-y-4">
      <span className="sr-only">Loading workspace settings</span>
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-6 sm:p-7 xl:col-span-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-3 w-52" />
          <Skeleton className="mt-7 h-12 w-full rounded-xl" />
          <Skeleton className="mt-5 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-4/5" />
          <Skeleton className="mt-6 h-10 w-32 rounded-full" />
        </Card>
        <Card className="p-6 sm:p-7 xl:col-span-7">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-3 w-64" />
          <div className="mt-7 space-y-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="mt-2 h-3 w-56" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="p-6 xl:col-span-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-6 h-12 w-full" />
          <Skeleton className="mt-4 h-3 w-5/6" />
        </Card>
        <Card className="p-6 xl:col-span-7">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-6 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-3 h-3 w-2/3" />
        </Card>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  useDocumentTitle("Settings");

  const {
    user,
    activeOrganization,
    updateActiveOrganizationName,
    refresh,
  } = useAuth();
  const activeOrganizationId = activeOrganization?.id ?? null;

  const [state, setState] = useState<SettingsState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    if (!activeOrganizationId) {
      setState({
        status: "error",
        message:
          "No active organization is selected for this session. Choose a workspace or sign in again.",
      });
      return () => {
        active = false;
      };
    }

    setState({ status: "loading" });
    setFieldErrors({});
    setSaveError(null);
    setSaveSuccess(false);

    getCurrentOrganization()
      .then((data) => {
        if (!active) {
          return;
        }

        setState({ status: "ready", data });
        setName(data.organization.name);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
          return;
        }

        setState({
          status: "error",
          message: getErrorMessage(error, "Could not load this workspace."),
        });
      });

    return () => {
      active = false;
    };
  }, [activeOrganizationId, reloadKey, refresh]);

  async function handleRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (state.status !== "ready" || saving) {
      return;
    }

    const currentData = state.data;

    if (!canManageWorkspace(currentData.role)) {
      return;
    }

    const trimmedName = name.trim();
    const errors: Record<string, string> = {};

    if (trimmedName.length < 2) {
      errors.name = "Use at least 2 characters.";
    } else if (trimmedName.length > 80) {
      errors.name = "Use 80 characters or fewer.";
    }

    setFieldErrors(errors);
    setSaveError(null);
    setSaveSuccess(false);

    if (Object.keys(errors).length > 0) {
      return;
    }

    if (trimmedName === currentData.organization.name) {
      return;
    }

    setSaving(true);

    try {
      const result = await updateOrganizationName(trimmedName);

      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              data: {
                ...current.data,
                organization: {
                  ...current.data.organization,
                  name: result.organization.name,
                },
              },
            }
          : current,
      );
      setName(result.organization.name);
      updateActiveOrganizationName(result.organization.name);
      setSaveSuccess(true);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
        return;
      }

      setFieldErrors(getFieldErrors(error));
      setSaveError(
        getErrorMessage(error, "Could not update the workspace profile."),
      );
    } finally {
      setSaving(false);
    }
  }

  const role = state.status === "ready" ? state.data.role : activeOrganization?.role;
  const displayRole = role ?? null;
  const canManage = role ? canManageWorkspace(role) : false;
  const workspaceName = state.status === "ready" ? state.data.organization.name : null;

  return (
    <>
      <PageHeader
        eyebrow="Settings · Workspace"
        title={
          <>
            Your workspace,
            <br className="hidden sm:block" /> on the{" "}
            <span className="relative isolate inline-block italic">
              record
              <span
                aria-hidden="true"
                className="absolute bottom-1.5 left-0 -z-10 h-[0.2em] w-full rounded-full bg-lime"
              />
            </span>
            .
          </>
        }
        description="The identity of your organization and the teammates who share it. Roles and tenant boundaries are verified by the API on every protected request."
        actions={
          displayRole ? (
            <Badge tone={roleTones[displayRole]} className="h-8 px-3">
              <ShieldCheck aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
              {getOrganizationRoleLabel(displayRole)} access
            </Badge>
          ) : null
        }
      />

      {state.status === "loading" ? <SettingsSkeleton /> : null}

      {state.status === "error" ? (
        <Card className="mt-9 flex flex-col items-center px-6 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-coral-soft text-coral">
            <CircleAlert aria-hidden="true" className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <h2 className="mt-5 font-display text-3xl leading-[1.02] tracking-[-0.035em] text-ink">
            Settings could not load.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">{state.message}</p>
          <Button
            variant="secondary"
            className="mt-6"
            onClick={() => {
              setReloadKey((current) => current + 1);
            }}
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Try again
          </Button>
        </Card>
      ) : null}

      {state.status === "ready" ? (
        <div className="mt-9 space-y-4">
          <section className="grid gap-4 xl:grid-cols-12">
            <Card className="p-6 sm:p-7 xl:col-span-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-lime">
                    <Building2
                      aria-hidden="true"
                      className="h-[18px] w-[18px]"
                      strokeWidth={1.7}
                    />
                  </span>
                  <div>
                    <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                      Workspace profile
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">
                      The name your team sees.
                    </p>
                  </div>
                </div>
                <Badge tone={roleTones[state.data.role]}>
                  {getOrganizationRoleLabel(state.data.role)}
                </Badge>
              </div>

              <form
                noValidate
                onSubmit={(event) => void handleRename(event)}
                className="mt-6"
              >
                {saveError ? (
                  <div
                    role="alert"
                    className="mb-4 flex items-start gap-2.5 rounded-xl border border-coral/20 bg-coral-soft px-3.5 py-3 text-coral"
                  >
                    <CircleAlert
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={2}
                    />
                    <p className="text-[11.5px] leading-5">{saveError}</p>
                  </div>
                ) : null}

                {saveSuccess ? (
                  <div
                    role="status"
                    className="mb-4 flex items-start gap-2.5 rounded-xl border border-moss/15 bg-moss/[0.07] px-3.5 py-3 text-moss"
                  >
                    <ShieldCheck
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      strokeWidth={2}
                    />
                    <p className="text-[11.5px] leading-5">
                      Workspace name updated across your session.
                    </p>
                  </div>
                ) : null}

                <TextField
                  label="Workspace name"
                  name="organizationName"
                  value={name}
                  onChange={(value) => {
                    setName(value);
                    setSaveSuccess(false);
                    setFieldErrors({});
                  }}
                  error={fieldErrors.name}
                  hint={
                    canManage
                      ? "Owners and admins can rename the workspace."
                      : "Only owners and admins can rename this workspace."
                  }
                  maxLength={80}
                  disabled={!canManage || saving}
                  required
                />

                <div className="mt-4 flex items-center gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      !canManage || saving || name.trim() === state.data.organization.name
                    }
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                  {name.trim() !== state.data.organization.name ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => {
                        setName(state.data.organization.name);
                        setFieldErrors({});
                        setSaveError(null);
                      }}
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
              </form>

              <dl className="mt-6 space-y-3 border-t border-line pt-5 text-[12px]">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Workspace address</dt>
                  <dd className="truncate font-mono text-[10.5px] text-ink-soft">
                    /{state.data.organization.slug}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Created</dt>
                  <dd className="text-ink-soft">
                    {formatWorkspaceDate(state.data.organization.createdAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Members</dt>
                  <dd className="text-ink-soft">{state.data.members.length}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Your role</dt>
                  <dd>
                    <Badge tone={roleTones[state.data.role]}>
                      {getOrganizationRoleLabel(state.data.role)}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </Card>

            <Card className="overflow-hidden p-0 xl:col-span-7">
              <div className="flex flex-col gap-3 border-b border-line px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-lime text-ink">
                    <Users
                      aria-hidden="true"
                      className="h-[18px] w-[18px]"
                      strokeWidth={1.8}
                    />
                  </span>
                  <div>
                    <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
                      Team members
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Everyone with access to {state.data.organization.name}.
                    </p>
                  </div>
                </div>
                <Badge tone="outline">
                  {state.data.members.length}{" "}
                  {state.data.members.length === 1 ? "member" : "members"}
                </Badge>
              </div>

              <ul className="divide-y divide-line">
                {state.data.members.map((member) => {
                  const isYou = member.userId === user?.id;

                  return (
                    <li
                      key={member.userId}
                      className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-raised/70 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e9d9bf] text-[10px] font-semibold tracking-[0.03em] text-[#594831]">
                          {getInitials(member.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[12.5px] font-semibold text-ink">
                              {member.name}
                            </p>
                            {isYou ? (
                              <Badge tone="lime" className="px-2 py-0.5 text-[8px]">
                                You
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            {member.email}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4 pl-[52px] sm:justify-end sm:pl-0">
                        <p className="whitespace-nowrap font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted/70">
                          Joined {formatWorkspaceDate(member.joinedAt)}
                        </p>
                        <Badge tone={roleTones[member.role]}>
                          {getOrganizationRoleLabel(member.role)}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="border-t border-line bg-surface-raised/60 px-5 py-3.5 sm:px-6">
                <p className="text-[10.5px] leading-5 text-muted">
                  Invitations and role changes are not available yet. This roster
                  reflects the memberships held by the API today.
                </p>
              </div>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-12">
            <Card className="p-6 xl:col-span-5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink/[0.055] text-ink-soft">
                  <KeyRound
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    Your access
                  </h2>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    The identity behind this session.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-surface-raised/70 p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e9d9bf] text-[11px] font-semibold tracking-[0.03em] text-[#594831]">
                  {getInitials(user?.name ?? "Subscript member")}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-ink">
                    {user?.name ?? "Subscript member"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {user?.email ?? "No email available"}
                  </p>
                </div>
                {displayRole ? (
                  <Badge tone={roleTones[displayRole]} className="ml-auto shrink-0">
                    {getOrganizationRoleLabel(displayRole)}
                  </Badge>
                ) : null}
              </div>

              <dl className="mt-5 space-y-3 text-[11.5px]">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Active workspace</dt>
                  <dd className="truncate font-medium text-ink-soft">
                    {workspaceName ?? activeOrganization?.name ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Account created</dt>
                  <dd className="text-ink-soft">
                    {user ? formatWorkspaceDate(user.createdAt) : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted">Session storage</dt>
                  <dd className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-moss">
                    HttpOnly cookie
                  </dd>
                </div>
              </dl>
            </Card>

            <Card className="p-6 xl:col-span-7">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime text-ink">
                  <ShieldCheck
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.9}
                  />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    Role model
                  </h2>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    Permissions are checked on the server, not just hidden in the UI.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2.5">
                {roleGuidance.map((guidance) => {
                  const isCurrent = guidance.role === role;

                  return (
                    <div
                      key={guidance.role}
                      className={
                        isCurrent
                          ? "rounded-2xl border border-lime-deep/40 bg-lime/20 px-4 py-3.5"
                          : "rounded-2xl border border-line bg-surface-raised/50 px-4 py-3.5"
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Badge tone={roleTones[guidance.role]}>
                            {getOrganizationRoleLabel(guidance.role)}
                          </Badge>
                          {isCurrent ? (
                            <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-moss">
                              Your role
                            </span>
                          ) : null}
                        </div>
                        <p className="hidden text-[10.5px] text-muted sm:block">
                          {guidance.summary}
                        </p>
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-muted">
                        {guidance.detail}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        </div>
      ) : null}
    </>
  );
}
