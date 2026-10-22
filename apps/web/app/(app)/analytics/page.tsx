import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { analytics } from "@/lib/api";

export const metadata: Metadata = { title: "Analytics", description: "Evaluation volume and latency from reported SDK events." };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const data = await analytics.summary({ days: 7 });
  const stats = [
    ["Evaluations", data.evaluations.toLocaleString()],
    ["Unique subjects", data.users.toLocaleString()],
    ["Average latency", `${data.avgLatencyMs.toFixed(2)} ms`],
    ["95th percentile", `${data.p95LatencyMs.toFixed(2)} ms`],
    ["Reported errors", data.errors.toLocaleString()],
  ];
  return <>
    <PageHeader title="Analytics" description="Reported SDK evaluations over the last 7 days." />
    <p className="text-muted-foreground mb-4 text-xs">Counts include received events from server SDKs with reporting enabled. Subjects are counted separately in each environment. Events expire after 90 days.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{stats.map(([label, value]) => <section key={label} className="bg-card border rounded-lg p-4"><p className="text-muted-foreground text-xs">{label}</p><p className="mt-2 text-2xl font-medium">{value}</p></section>)}</div>
    {!data.evaluations && <p className="bg-card border rounded-lg p-6 mt-4 text-sm">No evaluation events received yet. Enable telemetry in the Node SDK and issue a server key with the events:write scope to start collecting data.</p>}
    <div className="grid gap-4 mt-4 lg:grid-cols-2">
      <section className="bg-card border rounded-lg p-4"><h2 className="text-sm font-medium mb-3">Daily evaluations · UTC</h2><div className="space-y-2">{data.daily.map((day) => <div key={day.date} className="text-xs"><div className="flex justify-between"><span>{day.date}</span><span>{day.evaluations.toLocaleString()}</span></div><div className="bg-muted mt-1 h-2 rounded"><div className="bg-primary h-2 rounded" style={{ width: `${day.evaluations / Math.max(...data.daily.map((row) => row.evaluations), 1) * 100}%` }} /></div></div>)}</div></section>
      <section className="bg-card border rounded-lg p-4"><h2 className="text-sm font-medium mb-3">Top flags</h2><table className="text-xs w-full"><thead><tr className="text-left"><th className="py-2">Project / flag</th><th className="text-right">Evaluations</th></tr></thead><tbody>{data.topFlags.map((flag) => <tr key={`${flag.projectKey}/${flag.flagKey}`} className="border-t"><td className="py-2">{flag.projectKey} / {flag.flagKey}</td><td className="text-right">{flag.evaluations.toLocaleString()}</td></tr>)}</tbody></table></section>
      <section className="bg-card border rounded-lg p-4"><h2 className="text-sm font-medium mb-3">By environment</h2><ul className="text-xs space-y-2">{data.environments.map((row) => <li key={row.environmentKey} className="flex justify-between"><span>{row.environmentKey}</span><span>{row.evaluations.toLocaleString()}</span></li>)}</ul></section>
    </div>
  </>;
}
