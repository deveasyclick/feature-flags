import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/sign-in-form";
import { getEnabledProviders, oauthErrorMessage } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Iwifunni workspace.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const [params, providers] = await Promise.all([
    searchParams,
    getEnabledProviders(),
  ]);

  const rawError = params.error;
  const errorCode = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <SignInForm
      enabledProviders={providers}
      initialError={oauthErrorMessage(errorCode)}
    />
  );
}
