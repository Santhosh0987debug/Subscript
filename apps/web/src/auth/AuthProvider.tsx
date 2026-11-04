import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthUser,
  LoginRequest,
  OrganizationMembershipSummary,
  RegisterRequest,
  SessionResponse,
} from "@subscript/shared";
import {
  ApiClientError,
  fetchSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  switchOrganization as switchOrganizationRequest,
} from "@/lib/api";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  organizations: readonly OrganizationMembershipSummary[];
  activeOrganization: OrganizationMembershipSummary | null;
  error: string | null;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  refresh: () => Promise<void>;
  updateActiveOrganizationName: (name: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sessionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Your session could not be restored. Confirm the API is running and try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const loadSession = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setStatus("loading");
    }

    setError(null);

    try {
      const nextSession = await fetchSession();

      if (!mounted.current) {
        return;
      }

      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
    } catch (sessionError) {
      if (!mounted.current) {
        return;
      }

      setSession(null);
      setError(sessionErrorMessage(sessionError));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadSession(true);
  }, [loadSession]);

  const login = useCallback(async (input: LoginRequest) => {
    const nextSession = await loginAccount(input);
    setSession(nextSession);
    setError(null);
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (input: RegisterRequest) => {
    const nextSession = await registerAccount(input);
    setSession(nextSession);
    setError(null);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await logoutAccount();
    setSession(null);
    setError(null);
    setStatus("unauthenticated");
  }, []);

  const switchOrganization = useCallback(async (organizationId: string) => {
    try {
      const nextSession = await switchOrganizationRequest(organizationId);
      setSession(nextSession);
      setError(null);
      setStatus("authenticated");
    } catch (switchError) {
      if (switchError instanceof ApiClientError && switchError.status === 401) {
        setSession(null);
        setStatus("unauthenticated");
      }

      throw switchError;
    }
  }, []);

  const updateActiveOrganizationName = useCallback((name: string) => {
    setSession((current) => {
      if (!current || !current.activeOrganizationId) {
        return current;
      }

      return {
        ...current,
        organizations: current.organizations.map((organization) =>
          organization.id === current.activeOrganizationId
            ? { ...organization, name }
            : organization,
        ),
      };
    });
  }, []);

  const refresh = useCallback(async () => {
    await loadSession(true);
  }, [loadSession]);

  const activeOrganization = useMemo(() => {
    if (!session) {
      return null;
    }

    return (
      session.organizations.find(
        (organization) => organization.id === session.activeOrganizationId,
      ) ??
      session.organizations[0] ??
      null
    );
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      organizations: session?.organizations ?? [],
      activeOrganization,
      error,
      login,
      register,
      logout,
      switchOrganization,
      refresh,
      updateActiveOrganizationName,
    }),
    [
      status,
      session,
      activeOrganization,
      error,
      login,
      register,
      logout,
      switchOrganization,
      refresh,
      updateActiveOrganizationName,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
