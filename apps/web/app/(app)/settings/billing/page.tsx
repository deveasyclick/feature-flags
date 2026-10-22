import type { Metadata } from "next";
import { settingsDescription } from "@/components/app/settings/settings-options";

export const metadata: Metadata = {
  title: "Billing",
  description: settingsDescription,
};

export default function SettingsBillingPage() {
  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold">Billing is not available yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">No payment method, invoices, or paid subscription are managed by Flags at this time.</p>
    </section>
  );
}
