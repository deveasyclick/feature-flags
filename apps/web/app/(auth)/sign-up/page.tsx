import type { Metadata } from "next";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { getEnabledProviders, oauthErrorMessage } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your Iwifunni account.",
};

export default async function SignUpPage({
  searchParams,
}: PageProps<"/sign-up">) {
  const [params, providers] = await Promise.all([
    searchParams,
    getEnabledProviders(),
  ]);

  const rawError = params.error;
  const errorCode = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <SignUpForm
      enabledProviders={providers}
      initialError={oauthErrorMessage(errorCode)}
    />
  );
}
