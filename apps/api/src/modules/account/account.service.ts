import type {
  ChangePasswordInput,
  SessionUser,
  UpdateNotificationsInput,
  UpdatePreferencesInput,
  UpdateProfileInput,
  UserPreferences,
} from "@iwifunni/contracts";

import { ApiError } from "../../shared/http/errors.js";
import type { AuthService } from "../auth/index.js";
import type { RequestUser } from "../auth/index.js";
import { toUserPreferences } from "./account.mapper.js";
import type { AccountRepository } from "./account.repository.js";
import type { PreferencesPatch } from "./account.types.js";

/**
 * Self-service account changes. Profile and password writes go through the auth
 * module, so Better Auth keeps owning its tables and its password hashing.
 */
export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly authService: AuthService,
  ) {}

  async updateProfile(
    headers: Headers,
    user: RequestUser,
    input: UpdateProfileInput,
  ): Promise<SessionUser> {
    // Changing the sign-in address needs a verification step this release does
    // not have, and must never quietly mark the new address verified.
    if (input.email.toLowerCase() !== user.email.toLowerCase()) {
      throw ApiError.badRequest(
        "Changing your sign-in email needs a verification step that this release does not include yet.",
      );
    }

    await this.authService.updateDisplayName(headers, input.name);

    return {
      id: user.id,
      name: input.name,
      email: user.email,
      image: user.image ?? null,
      emailVerified: user.emailVerified,
    };
  }

  async changePassword(
    headers: Headers,
    input: ChangePasswordInput,
  ): Promise<void> {
    try {
      await this.authService.changePassword(headers, input);
    } catch (error) {
      // A wrong current password is a bad request, not an internal failure.
      throw ApiError.badRequest(
        messageOf(error, "That password could not be changed."),
      );
    }
  }

  async updatePreferences(
    user: RequestUser,
    organizationId: string,
    input: UpdatePreferencesInput,
  ): Promise<UserPreferences> {
    const patch: PreferencesPatch = { theme: input.theme };

    if (input.defaultEnvironmentKey === null) {
      patch.defaultEnvironmentId = null;
    } else if (input.defaultEnvironmentKey !== undefined) {
      const environment = await this.repository.findEnvironmentByKey(
        organizationId,
        input.defaultEnvironmentKey,
      );

      if (!environment) {
        throw ApiError.badRequest(
          `"${input.defaultEnvironmentKey}" is not an environment in this workspace.`,
        );
      }

      patch.defaultEnvironmentId = environment.id;
    }

    return toUserPreferences(
      await this.repository.upsertPreferences(user.id, patch),
    );
  }

  async updateNotifications(
    user: RequestUser,
    input: UpdateNotificationsInput,
  ): Promise<UserPreferences> {
    return toUserPreferences(
      await this.repository.upsertPreferences(user.id, {
        notifyOnFlagChange: input.flagChanges,
        notifyWeeklyDigest: input.weeklyDigest,
        notifyIncidentAlerts: input.incidentAlerts,
      }),
    );
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const body = (error as { body?: unknown }).body;

    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
    ) {
      return (body as { message: string }).message;
    }

    if (
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
    ) {
      return (error as { message: string }).message;
    }
  }

  return fallback;
}
