import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { WorkspaceSecuritySettings } from "@iwifunni/contracts";
import { SettingsSecurity } from "@/components/app/settings/settings-security";
import { settingsDescription } from "@/components/app/settings/settings-options";
import * as api from "@/lib/api";
import { getSession } from "@/lib/session";
import { TwoFactorSettings } from "@/components/auth/two-factor-settings";

export const metadata: Metadata = {
  title: "Security",
  description: settingsDescription,
};

export const dynamic = "force-dynamic";

async function loadSecurity(): Promise<WorkspaceSecuritySettings> {
  try {
    return await api.workspace.getSecurity();
  } catch (error) {
    if (error instanceof api.ApiError && error.status === 404) notFound();
    throw error;
  }
}

export default async function SettingsSecurityPage() {
  const [settings, session] = await Promise.all([loadSecurity(), getSession()]);
  return <div className="space-y-4"><TwoFactorSettings initiallyEnabled={session?.user.twoFactorEnabled} /><SettingsSecurity settings={settings} /></div>;
}
