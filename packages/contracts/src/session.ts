import { z } from "zod";

import { emailSchema } from "#fields";
import { enabledProvidersSchema } from "#oauth";
import { workspaceSummarySchema } from "#workspace";

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: emailSchema,
  image: z.string().nullable().optional(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean().optional(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * `GET /v1/me`.
 *
 * `hasProject` is a separate flag rather than a project list because the
 * onboarding gate asks one question — "may this user see the dashboard yet?" —
 * and every dashboard request asks it, so the answer has to be cheap.
 */
export const meResponseSchema = z.object({
  user: sessionUserSchema,
  workspace: workspaceSummarySchema.nullable(),
  /** False until onboarding step 3 completes. Meaningless without a workspace. */
  hasProject: z.boolean(),
  mfaRequired: z.boolean().optional(),
  mfaEnrollmentRequired: z.boolean().optional(),
  providers: enabledProvidersSchema,
});

export type MeResponse = z.infer<typeof meResponseSchema>;
