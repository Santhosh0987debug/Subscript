import { describe, expect, it } from "vitest";
import { validateLogin, validateRegister } from "@/auth/form-validation";

const validRegistration = {
  name: "Alex Morgan",
  email: "alex@example.com",
  password: "CorrectHorse9",
  organizationName: "Northwind Labs",
};

describe("validateLogin", () => {
  it("accepts a complete credential pair", () => {
    expect(
      validateLogin({ email: "alex@example.com", password: "CorrectHorse9" }),
    ).toEqual({});
  });

  it("requires an email and password", () => {
    const errors = validateLogin({ email: "", password: "" });

    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });

  it("rejects malformed email addresses", () => {
    expect(
      validateLogin({ email: "alex.example.com", password: "CorrectHorse9" }).email,
    ).toBe("Enter a valid email address.");
  });
});

describe("validateRegister", () => {
  it("accepts a complete registration", () => {
    expect(validateRegister(validRegistration)).toEqual({});
  });

  it("requires a strong password", () => {
    expect(validateRegister({ ...validRegistration, password: "short" }).password).toBe(
      "Use at least 10 characters.",
    );
    expect(
      validateRegister({ ...validRegistration, password: "lettersonly" }).password,
    ).toBe("Include at least one number.");
    expect(
      validateRegister({ ...validRegistration, password: "1234567890" }).password,
    ).toBe("Include at least one letter.");
  });

  it("limits passwords to 72 bytes", () => {
    const errors = validateRegister({
      ...validRegistration,
      password: `${"a".repeat(36)}1${"b".repeat(40)}`,
    });

    expect(errors.password).toBe("Use at most 72 characters.");
  });

  it("reports every invalid field together", () => {
    const errors = validateRegister({
      name: "",
      email: "not-an-email",
      password: "short",
      organizationName: "",
    });

    expect(Object.keys(errors).sort()).toEqual([
      "email",
      "name",
      "organizationName",
      "password",
    ]);
  });
});
