import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import {
  emailOTP,
  organization as organizationPlugin,
} from "better-auth/plugins";
import { VERIFICATION_CODE_LENGTH } from "@iwifunni/contracts";

import { db } from "../../db/client.js";
import {
  account,
  invitation,
  member,
  organization,
  session,
  user,
  verification,
} from "../../db/schema/index.js";
import { env, isProduction } from "../../config/index.js";
import {
  dashboardOrigins,
  enabledProviders,
  type OAuthProviderName,
} from "../../shared/constants.js";
import type { EmailService } from "../email/index.js";
import { VERIFICATION_CODE_TTL_SECONDS } from "./auth.types.js";

/**
 * The providers this deployment actually configured.
 *
 * Derived rather than written out: a name left here without credentials would
 * be trusted while being unable to complete a handshake, and trusting a
 * provider is trusting it to have verified the address it reports.
 */
const trustedProviders = (
  Object.keys(enabledProviders) as OAuthProviderName[]
).filter((name) => enabledProviders[name]);

const socialProviders = {
  ...(enabledProviders.github
    ? {
        github: {
          clientId: env.githubClientId as string,
          clientSecret: env.githubClientSecret as string,
        },
      }
    : {}),
  ...(enabledProviders.google
    ? {
        google: {
          clientId: env.googleClientId as string,
          clientSecret: env.googleClientSecret as string,
        },
      }
    : {}),
};

export function createAuthConfig(emailService: EmailService) {
  return betterAuth({
    appName: "Iwifunni",
    baseURL: env.betterAuthUrl,
    basePath: "/api/auth",
    secret: env.betterAuthSecret,

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user,
        session,
        account,
        verification,
        organization,
        member,
        invitation,
      },
      usePlural: false,
    }),

    trustedOrigins: dashboardOrigins,

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // On, which is what makes social sign-in onto an existing password
      // account safe: Better Auth only links an incoming Google or GitHub
      // identity to a local user whose own address is confirmed, so an address
      // squatted with a password cannot be taken over by whoever really owns
      // the mailbox. It also means sign-up no longer returns a session.
      requireEmailVerification: true,
      // Nothing here sends a reset link: that flow runs on the code endpoints
      // the emailOTP plugin adds below, so `sendResetPassword` and
      // `resetPasswordTokenExpiresIn` are deliberately absent. The link
      // endpoints Better Auth still serves answer with "reset password isn't
      // enabled" rather than silently mailing a link this deployment does not
      // want.
    },

    // The code is issued by the emailOTP plugin below, which overrides
    // `sendVerificationEmail` — including the call sign-up makes — so no link
    // pointing at the API origin is ever built.
    emailVerification: {
      sendOnSignUp: true,
      // Without this the verification only flips a column, and the user is left
      // on the dashboard still signed out.
      autoSignInAfterVerification: true,
    },

    // Deliberately not `requireLocalEmailVerified: false`. That would let
    // someone register a victim's address with a password and then have the
    // victim's first Google sign-in attach to the squatter's account, whose
    // password still works.
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders,
      },
    },

    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Deliberately off: the cached cookie would keep serving the old name and
      // email for up to five minutes after PATCH /v1/me, and a profile screen
      // that appears to ignore a save is worse than one extra session read.
      cookieCache: {
        enabled: false,
      },
    },

    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: isProduction,
        httpOnly: true,
      },
      /**
       * Send the confirmation email after the response, rather than holding the
       * sign-up request open for a round trip to the mail provider.
       *
       * `EmailService.send` already reports its own failures and never throws,
       * and this is a long-lived Node process, so a floating promise outlives
       * the request without being dropped. Platforms that own a lifetime hook
       * pass `waitUntil` here instead, which is what this option exists for.
       */
      backgroundTasks: {
        handler: (promise) => {
          void promise.catch(() => {});
        },
      },
    },

    plugins: [
      organizationPlugin(),

      /**
       * Confirmation and password reset by emailed code rather than by link.
       *
       * `overrideDefaultEmailVerification` is what makes this the whole
       * verification story: the plugin replaces `sendVerificationEmail`, so the
       * call sign-up already makes now sends a code, and the link that used to
       * point at the API origin is never built. `requireEmailVerification`,
       * `autoSignInAfterVerification` and the account-linking rules above are
       * untouched by the swap — `/email-otp/verify-email` marks the address
       * verified and, on the same request, issues the session.
       *
       * The same plugin carries the reset flow: `/email-otp/request-password-reset`
       * and `/email-otp/reset-password` replace the emailed link, and proving
       * control of the mailbox that way also confirms the address.
       */
      emailOTP({
        overrideDefaultEmailVerification: true,
        otpLength: VERIFICATION_CODE_LENGTH,
        expiresIn: VERIFICATION_CODE_TTL_SECONDS,
        /**
         * Encrypted with the app secret rather than stored as issued.
         *
         * Not `"hashed"`, which sounds stronger and is not: a six-digit code is
         * a hundred thousand possibilities, so an unsalted digest is exhausted
         * offline in well under a second and a leaked database still gives up
         * every live code. Encrypting under a key that lives in the environment
         * puts the codes out of reach of the database alone, which is the
         * threat worth closing.
         */
        storeOTP: "encrypted",
        sendVerificationOTP: async ({ email, otp, type }) => {
          await emailService.send({
            template:
              type === "forget-password"
                ? "passwordResetCode"
                : "verifyEmailCode",
            to: email,
            variables: {
              code: otp,
              expiresInMinutes: VERIFICATION_CODE_TTL_SECONDS / 60,
            },
          });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuthConfig>;
