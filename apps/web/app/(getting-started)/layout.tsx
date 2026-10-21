import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function GettingStartedLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/sign-in");
  }

  if (!session.workspace) {
    redirect("/create-workspace");
  }

  if (session.hasProject) {
    redirect("/overview");
  }

  return <AuthShell variant="getting-started">{children}</AuthShell>;
}
