import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { WorkspaceProfile } from "@iwifunni/contracts";
import { SettingsAppearance } from "@/components/app/settings/settings-appearance";
import { SettingsDanger } from "@/components/app/settings/settings-danger";
import { SettingsProfileForm } from "@/components/app/settings/settings-profile-form";
import { settingsDescription } from "@/components/app/settings/settings-options";
import * as api from "@/lib/api";
import { getScope } from "@/lib/scope";

export const metadata: Metadata = {
  title: "Settings",
  description: settingsDescription,
};

export const dynamic = "force-dynamic";

async function loadWorkspace(): Promise<WorkspaceProfile> {
  try {
    return await api.workspace.get();
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 404) notFound();
    throw error;
  }
}

export default async function SettingsGeneralPage() {
  const [profile, scope] = await Promise.all([loadWorkspace(), getScope()]);

  return (
    <div className="space-y-3">
      <SettingsProfileForm
        profile={profile}
        environments={scope.environments}
      />
      <SettingsAppearance />
      <SettingsDanger />
    </div>
  );
}
