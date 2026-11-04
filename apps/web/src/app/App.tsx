import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { RequireAuth, RequireGuest } from "@/auth/RouteGuards";
import { AppShell } from "@/components/layout/AppShell";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";

const OverviewPage = lazy(() => import("@/pages/OverviewPage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const PlansPage = lazy(() => import("@/pages/PlansPage"));
const SubscriptionsPage = lazy(() => import("@/pages/SubscriptionsPage"));
const InvoicesPage = lazy(() => import("@/pages/InvoicesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

export function App() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
