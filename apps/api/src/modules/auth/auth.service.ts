import { enabledProviders } from "../../shared/constants.js";
import type { AuthRepository } from "./auth.repository.js";
import type {
  AuthCredentialApi,
  GetSession,
  ProjectExistenceChecker,
  RequestContext,
} from "./auth.types.js";

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly projectExists: ProjectExistenceChecker,
    private readonly getSession: GetSession,
    private readonly credentials: AuthCredentialApi,
  ) {}

  async resolveRequestContext(
    headers: Headers,
  ): Promise<RequestContext | null> {
    const result = await this.getSession({ headers });

    if (!result) return null;

    const workspace = await this.repository.findWorkspaceForUser(
      result.user.id,
      result.session.activeOrganizationId,
    );
    if (
      workspace &&
      Date.now() - result.session.createdAt.getTime() >=
        workspace.sessionMaxAgeMs
    ) {
      await this.repository.revokeSession(result.session.id);
      return null;
    }
    const projectExists = workspace
      ? await this.projectExists(workspace.id)
      : false;

    return {
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        image: result.user.image,
        emailVerified: result.user.emailVerified,
        twoFactorEnabled: result.user.twoFactorEnabled ?? false,
      },
      session: {
        id: result.session.id,
        activeOrganizationId: result.session.activeOrganizationId,
      },
      workspace,
      hasProject: projectExists,
      mfaRequired:
        !!result.user.twoFactorEnabled && !result.session.twoFactorVerifiedAt,
      mfaEnrollmentRequired:
        !!workspace?.requireTwoFactor && !result.user.twoFactorEnabled,
    };
  }

  async verifySessionFactor(headers: Headers): Promise<void> {
    const verified = await this.getSession({ headers });
    if (verified?.user.twoFactorEnabled)
      await this.repository.verifySessionFactor(
        verified.session.id,
        verified.user.id,
      );
  }

  providersForDeployment(): Array<"github" | "google"> {
    return (
      Object.keys(enabledProviders) as Array<keyof typeof enabledProviders>
    ).filter((provider) => enabledProviders[provider]);
  }

  /** Delegates to Better Auth so the hashing and the account row stay its job. */
  async updateDisplayName(headers: Headers, name: string): Promise<void> {
    await this.credentials.updateUser({ body: { name }, headers });
  }

  async changePassword(
    headers: Headers,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    await this.credentials.changePassword({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers,
    });
  }
}
