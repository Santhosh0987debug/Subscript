import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Building2, MapPin, NotebookPen, RefreshCw } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextAreaField } from "@/components/ui/TextAreaField";
import { TextField } from "@/components/ui/TextField";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  ApiClientError,
  createCustomer,
  getCustomer,
  updateCustomer,
} from "@/lib/api";
import {
  type CustomerFormValues,
  validateCustomerForm,
} from "@/lib/customer-validation";
import {
  getErrorMessage,
  getFieldErrors,
  isUnauthorizedError,
} from "@/lib/errors";

const EMPTY_VALUES: CustomerFormValues = {
  name: "",
  email: "",
  phone: "",
  company: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  notes: "",
};

type LoadState =
  | { status: "ready" }
  | { status: "loading" }
  | { status: "error"; message: string };

function toFormValues(data: {
  name: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
  billingAddress: {
    line1: string;
    line2: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
}): CustomerFormValues {
  return {
    name: data.name,
    email: data.email,
    phone: data.phone,
    company: data.company,
    addressLine1: data.billingAddress.line1,
    addressLine2: data.billingAddress.line2,
    city: data.billingAddress.city,
    region: data.billingAddress.region,
    postalCode: data.billingAddress.postalCode,
    country: data.billingAddress.country,
    notes: data.notes,
  };
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function CustomerFormPage() {
  const { customerId } = useParams();
  const isEdit = Boolean(customerId);
  const navigate = useNavigate();
  const { activeOrganization, refresh } = useAuth();
  const [values, setValues] = useState<CustomerFormValues>(EMPTY_VALUES);
  const [loadState, setLoadState] = useState<LoadState>(
    isEdit ? { status: "loading" } : { status: "ready" },
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const organizationId = activeOrganization?.id;
  const canManage =
    activeOrganization?.role === "OWNER" || activeOrganization?.role === "ADMIN";

  useDocumentTitle(isEdit ? "Edit customer" : "New customer");

  useEffect(() => {
    if (!isEdit) {
      setLoadState({ status: "ready" });
      return;
    }

    if (!organizationId || !customerId) {
      return;
    }

    const controller = new AbortController();
    setLoadState({ status: "loading" });

    getCustomer(customerId, controller.signal)
      .then((data) => {
        setValues(toFormValues(data.customer));
        setLoadState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (isUnauthorizedError(error)) {
          void refresh();
        }

        setLoadState({
          status: "error",
          message:
            error instanceof ApiClientError && error.status === 404
              ? "That customer could not be found in this workspace."
              : getErrorMessage(error, "The customer could not be loaded."),
        });
      });

    return () => {
      controller.abort();
    };
  }, [customerId, isEdit, organizationId, refresh]);

  function updateField(
    key: keyof CustomerFormValues,
    value: string,
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const errors = validateCustomerForm(values);

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Check the highlighted fields before saving.");
      return;
    }

    if (!canManage) {
      setFormError("Only owners and admins can save customer records.");
      return;
    }

    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const payload = {
      name: values.name.trim(),
      email: values.email.trim(),
      phone: trimOrNull(values.phone),
      company: trimOrNull(values.company),
      billingAddress: {
        line1: values.addressLine1.trim(),
        line2: values.addressLine2.trim(),
        city: values.city.trim(),
        region: values.region.trim(),
        postalCode: values.postalCode.trim(),
        country: values.country.trim(),
      },
      notes: trimOrNull(values.notes),
    };

    try {
      if (isEdit && customerId) {
        const result = await updateCustomer(customerId, payload);
        navigate(`/customers/${result.customer.id}`, {
          state: { notice: "Customer details updated." },
        });
      } else {
        const result = await createCustomer(payload);
        navigate(`/customers/${result.customer.id}`, {
          state: { notice: "Customer created." },
        });
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        void refresh();
        return;
      }

      setFieldErrors(getFieldErrors(error));
      setFormError(
        getErrorMessage(
          error,
          isEdit
            ? "The customer could not be updated."
            : "The customer could not be created.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <>
        <PageHeader
          eyebrow={isEdit ? "Customers · Edit" : "Customers · New"}
          title="This record is read-only."
          description="Only owners and admins can create or edit customer records."
        />
        <Card className="mt-9 p-6">
          <Alert tone="info">
            Your role gives you read access to this workspace. Ask an owner or
            admin if you need to change a customer.
          </Alert>
          <Link
            to={customerId ? `/customers/${customerId}` : "/customers"}
            className={buttonClassName({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            Go back
          </Link>
        </Card>
      </>
    );
  }

  if (loadState.status === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-7">
        <span className="sr-only">Loading customer form</span>
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-14 w-full max-w-xl rounded-2xl" />
        <Card className="p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-6 h-12 w-full rounded-xl" />
          <Skeleton className="mt-4 h-12 w-full rounded-xl" />
          <Skeleton className="mt-4 h-24 w-full rounded-xl" />
        </Card>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <>
        <PageHeader
          eyebrow="Customers · Edit"
          title="Customer unavailable."
          description="The form could not load this customer."
        />
        <Card className="mt-9 p-6">
          <Alert tone="error">{loadState.message}</Alert>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setLoadState({ status: "loading" });
                window.location.reload();
              }}
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              Reload
            </Button>
            <Link
              to="/customers"
              className={buttonClassName({ variant: "ghost", size: "sm" })}
            >
              Back to customers
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <Link
        to={isEdit && customerId ? `/customers/${customerId}` : "/customers"}
        className="inline-flex items-center gap-2 text-[11px] font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        {isEdit ? "Back to customer" : "All customers"}
      </Link>

      <div className="mt-5">
        <PageHeader
          eyebrow={isEdit ? "Customers · Edit" : "Customers · New"}
          title={isEdit ? "Update the record." : "Add a customer."}
          description={
            isEdit
              ? "Adjust contact details, billing context, and notes. Every saved change is added to the customer's timeline."
              : "Create a durable account record for this workspace. Email addresses are unique per organization."
          }
          actions={
            <Link
              to={isEdit && customerId ? `/customers/${customerId}` : "/customers"}
              className={buttonClassName({ variant: "secondary" })}
            >
              Cancel
            </Link>
          }
        />
      </div>

      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="mt-8">
        {formError ? <Alert tone="error" className="mb-4">{formError}</Alert> : null}

        <Card className="p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-lime">
              <Building2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                Contact details
              </h2>
              <p className="mt-0.5 text-[10.5px] text-muted">
                The identity and reachability of this account.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <TextField
              label="Full name"
              value={values.name}
              onChange={(value) => updateField("name", value)}
              name="name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              error={fieldErrors.name}
              maxLength={160}
              required
            />
            <TextField
              label="Email address"
              value={values.email}
              onChange={(value) => updateField("email", value)}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="ada@example.com"
              error={fieldErrors.email}
              maxLength={320}
              required
            />
            <TextField
              label="Phone"
              value={values.phone}
              onChange={(value) => updateField("phone", value)}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+1 555 0100"
              error={fieldErrors.phone}
              maxLength={40}
            />
            <TextField
              label="Company"
              value={values.company}
              onChange={(value) => updateField("company", value)}
              name="company"
              autoComplete="organization"
              placeholder="Analytical Engines"
              error={fieldErrors.company}
              maxLength={160}
            />
          </div>

          <div className="mt-7 flex items-center gap-3 border-t border-line pt-6">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime text-ink">
              <MapPin aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                Billing address
              </h2>
              <p className="mt-0.5 text-[10.5px] text-muted">
                Used on future invoices for this customer.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <TextField
              label="Address line 1"
              value={values.addressLine1}
              onChange={(value) => updateField("addressLine1", value)}
              name="addressLine1"
              autoComplete="address-line1"
              error={fieldErrors["billingAddress.line1"]}
              maxLength={160}
              className="sm:col-span-2"
            />
            <TextField
              label="Address line 2"
              value={values.addressLine2}
              onChange={(value) => updateField("addressLine2", value)}
              name="addressLine2"
              autoComplete="address-line2"
              error={fieldErrors["billingAddress.line2"]}
              maxLength={160}
              className="sm:col-span-2"
            />
            <TextField
              label="City"
              value={values.city}
              onChange={(value) => updateField("city", value)}
              name="city"
              autoComplete="address-level2"
              error={fieldErrors["billingAddress.city"]}
              maxLength={100}
            />
            <TextField
              label="State / Region"
              value={values.region}
              onChange={(value) => updateField("region", value)}
              name="region"
              autoComplete="address-level1"
              error={fieldErrors["billingAddress.region"]}
              maxLength={100}
            />
            <TextField
              label="Postal code"
              value={values.postalCode}
              onChange={(value) => updateField("postalCode", value)}
              name="postalCode"
              autoComplete="postal-code"
              error={fieldErrors["billingAddress.postalCode"]}
              maxLength={40}
            />
            <TextField
              label="Country"
              value={values.country}
              onChange={(value) => updateField("country", value)}
              name="country"
              autoComplete="country-name"
              error={fieldErrors["billingAddress.country"]}
              maxLength={80}
            />
          </div>

          <div className="mt-7 flex items-center gap-3 border-t border-line pt-6">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink/[0.055] text-ink-soft">
              <NotebookPen aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                Notes
              </h2>
              <p className="mt-0.5 text-[10.5px] text-muted">
                Context your team should know before the next conversation.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <TextAreaField
              label="Internal notes"
              value={values.notes}
              onChange={(value) => updateField("notes", value)}
              name="notes"
              placeholder="Billing preferences, renewal context, or account history."
              error={fieldErrors.notes}
              maxLength={2000}
              rows={5}
            />
          </div>
        </Card>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Button type="submit" disabled={saving}>
            {saving
              ? "Saving..."
              : isEdit
                ? "Save changes"
                : "Create customer"}
          </Button>
          <Link
            to={isEdit && customerId ? `/customers/${customerId}` : "/customers"}
            className={buttonClassName({ variant: "ghost" })}
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
