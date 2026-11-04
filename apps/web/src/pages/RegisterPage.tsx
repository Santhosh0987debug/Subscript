import { useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { validateRegister } from "@/auth/form-validation";
import { AuthFooterLink, AuthLayout } from "@/components/auth/AuthLayout";
import { Button, buttonClassName } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getErrorMessage, getFieldErrors } from "@/lib/errors";

export default function RegisterPage() {
  useDocumentTitle("Create account");

  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const values = {
      name: name.trim(),
      email: email.trim(),
      password,
      organizationName: organizationName.trim(),
    };
    const errors = validateRegister(values);
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      await register(values);
      navigate("/", { replace: true });
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setFormError(
        getErrorMessage(error, "Workspace creation failed. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Start here"
      title={
        <>
          Build your revenue
          <br />
          workspace{" "}
          <span className="relative isolate inline-block italic">
            today
            <span
              aria-hidden="true"
              className="absolute bottom-1.5 left-0 -z-10 h-[0.18em] w-full rounded-full bg-lime"
            />
          </span>
          .
        </>
      }
      description="Create your account and first organization in one step. You'll be its owner with full access to workspace settings and team roles."
      headerAction={
        <Link
          to="/login"
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          Sign in
        </Link>
      }
      footer={
        <AuthFooterLink
          prompt="Already have a workspace?"
          to="/login"
          label="Sign in instead"
        />
      }
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-coral/20 bg-coral-soft px-3.5 py-3 text-coral"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={2}
            />
            <div>
              <p className="text-[12px] font-semibold">Could not create your workspace</p>
              <p className="mt-0.5 text-[11.5px] leading-5 text-coral/90">{formError}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Full name"
            name="name"
            autoComplete="name"
            placeholder="Alex Morgan"
            value={name}
            onChange={setName}
            error={fieldErrors.name}
            required
            autoFocus
          />
          <TextField
            label="Work email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={setEmail}
            error={fieldErrors.email}
            required
          />
        </div>

        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a strong password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          hint="10+ characters with at least one letter and one number."
          required
        />

        <div className="mt-6 border-t border-line pt-6">
          <p className="eyebrow">Your first workspace</p>
          <TextField
            label="Workspace name"
            name="organizationName"
            autoComplete="organization"
            placeholder="Northwind Labs"
            value={organizationName}
            onChange={setOrganizationName}
            error={fieldErrors.organizationName}
            hint="You'll be the owner. You can rename it later in settings."
            required
            className="mt-3"
          />
        </div>

        <Button type="submit" className="mt-2 h-12 w-full" disabled={submitting}>
          {submitting ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
                strokeWidth={2}
              />
              Creating workspace...
            </>
          ) : (
            <>
              Create workspace
              <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            </>
          )}
        </Button>

        <p className="text-center text-[11px] leading-5 text-muted/80">
          Passwords are hashed with bcrypt. Session tokens never reach browser
          JavaScript.
        </p>
      </form>
    </AuthLayout>
  );
}
