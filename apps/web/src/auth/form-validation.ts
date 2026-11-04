export interface LoginFormValues {
  email: string;
  password: string;
}

export interface RegisterFormValues {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}

export type FormErrors = Record<string, string>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maximumPasswordBytes = 72;

function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

export function validateLogin(values: LoginFormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.email.trim().length === 0) {
    errors.email = "Enter your email address.";
  } else if (!emailPattern.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (values.password.length === 0) {
    errors.password = "Enter your password.";
  }

  return errors;
}

export function validateRegister(values: RegisterFormValues): FormErrors {
  const errors: FormErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const organizationName = values.organizationName.trim();

  if (name.length === 0) {
    errors.name = "Enter your full name.";
  } else if (name.length < 2) {
    errors.name = "Use at least 2 characters.";
  } else if (name.length > 80) {
    errors.name = "Use 80 characters or fewer.";
  }

  if (email.length === 0) {
    errors.email = "Enter your email address.";
  } else if (email.length > 320) {
    errors.email = "Email must be 320 characters or fewer.";
  } else if (!emailPattern.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (values.password.length < 10) {
    errors.password = "Use at least 10 characters.";
  } else if (values.password.length > maximumPasswordBytes) {
    errors.password = "Use at most 72 characters.";
  } else if (passwordByteLength(values.password) > maximumPasswordBytes) {
    errors.password = "Password must be at most 72 bytes.";
  } else if (!/[A-Za-z]/.test(values.password)) {
    errors.password = "Include at least one letter.";
  } else if (!/\d/.test(values.password)) {
    errors.password = "Include at least one number.";
  }

  if (organizationName.length === 0) {
    errors.organizationName = "Enter a workspace name.";
  } else if (organizationName.length < 2) {
    errors.organizationName = "Use at least 2 characters.";
  } else if (organizationName.length > 80) {
    errors.organizationName = "Use 80 characters or fewer.";
  }

  return errors;
}
