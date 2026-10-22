import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { TwoFactorSettings } from "@/components/auth/two-factor-settings";
export default async function SetupTwoFactorPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.mfaRequired) redirect("/two-factor");
  if (session.user.twoFactorEnabled) redirect("/overview");
  return <div className="max-w-md w-full"><TwoFactorSettings enrollmentOnly /></div>;
}
