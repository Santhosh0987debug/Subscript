import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(320, "Email must be 320 characters or fewer.")
  .email("Enter a valid email address.");

const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use at most 72 characters.")
  .refine((value) => /[A-Za-z]/.test(value), {
    message: "Include at least one letter.",
  })
  .refine((value) => /\d/.test(value), {
    message: "Include at least one number.",
  })
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must be at most 72 bytes.",
  });

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(80, "Name must be 80 characters or fewer."),
    email: emailSchema,
    password: passwordSchema,
    organizationName: z
      .string()
      .trim()
      .min(2, "Enter an organization name.")
      .max(80, "Organization name must be 80 characters or fewer."),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(1, "Enter your password.")
      .max(72, "Use at most 72 characters."),
  })
  .strict();

export const updateOrganizationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Enter an organization name.")
      .max(80, "Organization name must be 80 characters or fewer."),
  })
  .strict();

export const organizationIdParamsSchema = z.object({
  organizationId: z.string().uuid("Choose a valid organization."),
});

export type RegisterPayload = z.infer<typeof registerSchema>;
export type LoginPayload = z.infer<typeof loginSchema>;
