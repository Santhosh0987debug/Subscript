import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { AuthStatusScreen } from "@/components/auth/AuthStatusScreen";

export function RequireAuth() {
  const { status, user, error, refresh } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <AuthStatusScreen mode="loading" />;
  }

  if (status === "error") {
    return (
      <AuthStatusScreen
        mode="error"
        message={error}
        onRetry={() => {
          void refresh();
        }}
      />
    );
  }

  if (status !== "authenticated" || !user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}

export function RequireGuest() {
  const { status, user, error, refresh } = useAuth();

  if (status === "loading") {
    return <AuthStatusScreen mode="loading" />;
  }

  if (status === "error") {
    return (
      <AuthStatusScreen
        mode="error"
        message={error}
        onRetry={() => {
          void refresh();
        }}
      />
    );
  }

  if (status === "authenticated" && user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
