import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { RequireAuth, RequireGuest } from "@/auth/RouteGuards";
import { AppShell } from "@/components/layout/AppShell";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";

const OverviewPage = lazy(() => import("@/pages/OverviewPage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/pages/CustomerDetailPage"));
const CustomerFormPage = lazy(() => import("@/pages/CustomerFormPage"));
const PlansPage = lazy(() => import("@/pages/PlansPage"));
const PlanDetailPage = lazy(() => import("@/pages/PlanDetailPage"));
const PlanFormPage = lazy(() => import("@/pages/PlanFormPage"));
const SubscriptionsPage = lazy(() => import("@/pages/SubscriptionsPage"));
const SubscriptionFormPage = lazy(() => import("@/pages/SubscriptionFormPage"));
const SubscriptionDetailPage = lazy(() => import("@/pages/SubscriptionDetailPage"));
const InvoicesPage = lazy(() => import("@/pages/InvoicesPage"));
const InvoiceDetailPage = lazy(() => import("@/pages/InvoiceDetailPage"));
const InvoicePrintPage = lazy(() => import("@/pages/InvoicePrintPage"));
const AutomationPage = lazy(() => import("@/pages/AutomationPage"));
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
        <Route
          path="invoices/:invoiceId/print"
          element={<InvoicePrintPage />}
        />

        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/new" element={<CustomerFormPage />} />
          <Route path="customers/:customerId" element={<CustomerDetailPage />} />
          <Route
            path="customers/:customerId/edit"
            element={<CustomerFormPage />}
          />
          <Route path="plans" element={<PlansPage />} />
          <Route path="plans/new" element={<PlanFormPage />} />
          <Route path="plans/:planId" element={<PlanDetailPage />} />
          <Route path="plans/:planId/edit" element={<PlanFormPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="subscriptions/new" element={<SubscriptionFormPage />} />
          <Route
            path="subscriptions/:subscriptionId"
            element={<SubscriptionDetailPage />}
          />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/:invoiceId" element={<InvoiceDetailPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
