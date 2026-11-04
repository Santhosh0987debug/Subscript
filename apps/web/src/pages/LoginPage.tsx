import { useState, type FormEvent } from "react";
import { CircleAlert, LoaderCircle, LockKeyhole } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { validateLogin } from "@/auth/form-validation";
import { getRedirectTarget } from "@/auth/redirect";
import { AuthFooterLink, AuthLayout } from "@/components/auth/AuthLayout";
import { Button, buttonClassName } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getErrorMessage, getFieldErrors } from "@/lib/errors";

export default function LoginPage() {
  useDocumentTitle("Sign in");

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTarget = getRedirectTarget(location.state);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const values = { email: email.trim(), password };
    const errors = validateLogin(values);
    setFieldErrors(errors);
    setFormError(null);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      await login(values);
      navigate(redirectTarget, { replace: true });
    } catch (error) {
      setFieldErrors(getFieldErrors(error));
      setFormError(getErrorMessage(error, "Sign in failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title={
        <>
          Pick up where
          <br />
          your revenue{" "}
          <span className="relative isolate inline-block italic">
            left off
            <span
              aria-hidden="true"
              className="absolute bottom-1.5 left-0 -z-10 h-[0.18em] w-full rounded-full bg-lime"
            />
          </span>
          .
        </>
      }
      description="Sign in to your team's shared workspace. Your session is protected by an HttpOnly cookie and scoped to the organization you choose."
      headerAction={
        <Link
          to="/register"
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          Create account
        </Link>
      }
      footer={
        <AuthFooterLink
          prompt="New to Subscript?"
          to="/register"
          label="Create your workspace"
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
              <p className="text-[12px] font-semibold">Could not sign in</p>
              <p className="mt-0.5 text-[11.5px] leading-5 text-coral/90">{formError}</p>
            </div>
          </div>
        ) : null}

        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={setEmail}
          error={fieldErrors.email}
          required
          autoFocus
        />

        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          required
        />

        <Button type="submit" className="mt-2 h-12 w-full" disabled={submitting}>
          {submitting ? (
            <>
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
                strokeWidth={2}
              />
              Signing in...
            </>
          ) : (
            <>
              <LockKeyhole aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
              Sign in securely
            </>
          )}
        </Button>

        <p className="text-center text-[11px] leading-5 text-muted/80">
          Sessions expire after seven days. Signing out revokes the session on the
          server.
        </p>
      </form>
    </AuthLayout>
  );
}
