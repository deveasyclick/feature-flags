import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { PasswordForm } from "@/components/app/profile/password-form";
import { ProfileAccountCard } from "@/components/app/profile/profile-account-card";
import { ProfileForm } from "@/components/app/profile/profile-form";
import {
  ProfileNotifications,
  ProfilePreferences,
} from "@/components/app/profile/profile-preferences";
import { getScope, initialsOf } from "@/lib/scope";
import { me } from "@/lib/api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Profile",
  description: "Manage your personal account and preferences.",
};

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getSession();

  if (!session) redirect("/sign-in");

  const [{ environments }, preferences] = await Promise.all([getScope(), me.getPreferences()]);

  return (
    <>
      <PageHeader
        title="Profile"
        description="Manage your personal account and preferences."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.62fr)]">
        <div className="space-y-4">
          <ProfileForm
            user={session.user}
            initials={initialsOf(session.user.name)}
          />
          <PasswordForm />
        </div>

        <div className="space-y-4">
          <ProfileAccountCard
            role={session.workspace?.role ?? null}
            workspaceName={session.workspace?.name ?? null}
          />
          <ProfilePreferences
            environments={environments}
            preferences={preferences}
          />
          <ProfileNotifications preferences={preferences} />
        </div>
      </div>
    </>
  );
}
