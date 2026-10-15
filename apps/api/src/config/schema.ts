import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

export const ConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    // The dashboard assumes 4000.
    PORT: z.coerce.number().int().positive().default(4000),

    DATABASE_URL: z
      .string()
      .min(
        1,
        "DATABASE_URL is required — copy apps/api/.env.example to apps/api/.env.",
      ),

    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    REDIS_URL: optionalString,

    BETTER_AUTH_SECRET: z
      .string()
      .min(
        32,
        "BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32",
      ),

    BETTER_AUTH_URL: z.url().default("http://localhost:4000"),

    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,

    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,

    BREVO_API_KEY: z.string().trim().min(5, {
      error: "BREVO_API_KEY is required",
    }),
    EMAIL_FROM: z.email({ error: "EMAIL_FROM must be an email address" }),
    EMAIL_SENDER_NAME: z.string().trim().min(1).default("Iwifunni"),
  })
  .transform((value) => ({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    databasePoolMax: value.DATABASE_POOL_MAX,
    redisUrl: value.REDIS_URL,
    betterAuthSecret: value.BETTER_AUTH_SECRET,
    betterAuthUrl: value.BETTER_AUTH_URL,
    githubClientId: value.GITHUB_CLIENT_ID,
    githubClientSecret: value.GITHUB_CLIENT_SECRET,
    googleClientId: value.GOOGLE_CLIENT_ID,
    googleClientSecret: value.GOOGLE_CLIENT_SECRET,
    brevoApiKey: value.BREVO_API_KEY,
    emailFrom: value.EMAIL_FROM,
    emailSenderName: value.EMAIL_SENDER_NAME,
  }));
