import { z } from "zod";

import type { EmailTemplate } from "./email.types.js";

/**
 * The variables every one-time-code email shares.
 *
 * Both codes carry the same three values, so the rule for them lives here once:
 * a template that accepted a different shape would fail at send time rather
 * than at render time, which is much harder to notice.
 */
const codeVariables = z
  .strictObject({
    name: z.string().trim().min(1).optional(),
    code: z.string().trim().min(1),
    expiresInMinutes: z.number().int().positive(),
  })
  .transform(({ name, code, expiresInMinutes }) => ({
    name: name ?? "",
    greeting: name ? `Hi ${name},` : "Hi,",
    code,
    expiresInMinutes: String(expiresInMinutes),
  }));

export const emailTemplates = {
  passwordResetCode: {
    file: "password-reset-code.mjml",
    subject: "Your Iwifunni password reset code",
    text: [
      "{{greeting}}",
      "",
      "Enter this code to choose a new password for your Iwifunni account:",
      "",
      "{{code}}",
      "",
      "The code expires in {{expiresInMinutes}} minutes and can be used once.",
      "If you did not ask for a password reset, you can ignore this email — your password will not change.",
      "",
      "— Iwifunni",
    ].join("\n"),
    schema: codeVariables,
  },
  verifyEmailCode: {
    file: "verify-email-code.mjml",
    subject: "Your Iwifunni confirmation code",
    text: [
      "{{greeting}}",
      "",
      "Enter this code to confirm your email address and finish setting up your Iwifunni account:",
      "",
      "{{code}}",
      "",
      "The code expires in {{expiresInMinutes}} minutes.",
      "If you did not create an Iwifunni account, you can ignore this email.",
      "",
      "— Iwifunni",
    ].join("\n"),
    schema: codeVariables,
  },
} as const satisfies Record<string, EmailTemplate>;

export type EmailTemplateId = keyof typeof emailTemplates;

export type EmailTemplateVariables<Id extends EmailTemplateId> = z.input<
  (typeof emailTemplates)[Id]["schema"]
>;
