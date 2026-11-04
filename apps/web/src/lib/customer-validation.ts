export interface CustomerFormValues {
  name: string;
  email: string;
  phone: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
}

export type CustomerFormErrors = Record<string, string>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tooLong(
  value: string,
  max: number,
  label: string,
): string | undefined {
  return value.trim().length > max
    ? `${label} must be ${max} characters or fewer.`
    : undefined;
}

export function validateCustomerForm(
  values: CustomerFormValues,
): CustomerFormErrors {
  const errors: CustomerFormErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();

  if (name.length === 0) {
    errors.name = "Enter the customer's name.";
  } else if (name.length < 2) {
    errors.name = "Use at least 2 characters.";
  } else {
    const issue = tooLong(name, 160, "Name");
    if (issue) {
      errors.name = issue;
    }
  }

  if (email.length === 0) {
    errors.email = "Enter an email address.";
  } else if (email.length > 320) {
    errors.email = "Email must be 320 characters or fewer.";
  } else if (!emailPattern.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  const phoneIssue = tooLong(values.phone, 40, "Phone");
  if (phoneIssue) {
    errors.phone = phoneIssue;
  }

  const companyIssue = tooLong(values.company, 160, "Company");
  if (companyIssue) {
    errors.company = companyIssue;
  }

  const notesIssue = tooLong(values.notes, 2000, "Notes");
  if (notesIssue) {
    errors.notes = notesIssue;
  }

  const addressFields: Array<{
    key: keyof CustomerFormValues;
    path: string;
    label: string;
    max: number;
  }> = [
    { key: "addressLine1", path: "billingAddress.line1", label: "Address line 1", max: 160 },
    { key: "addressLine2", path: "billingAddress.line2", label: "Address line 2", max: 160 },
    { key: "city", path: "billingAddress.city", label: "City", max: 100 },
    { key: "region", path: "billingAddress.region", label: "Region", max: 100 },
    { key: "postalCode", path: "billingAddress.postalCode", label: "Postal code", max: 40 },
    { key: "country", path: "billingAddress.country", label: "Country", max: 80 },
  ];

  for (const field of addressFields) {
    const issue = tooLong(String(values[field.key]), field.max, field.label);

    if (issue) {
      errors[field.path] = issue;
    }
  }

  return errors;
}
