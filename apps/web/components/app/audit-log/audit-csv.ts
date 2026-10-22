import type { AuditEventView } from "./audit-log-types";

function cell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function auditCsv(events: AuditEventView[]): string {
  return [
    ["ID", "Time", "Actor", "Action", "Target", "Context", "Changes"],
    ...events.map((event) => [event.id, event.absoluteLabel, event.actorName, event.action, event.target ?? "", event.context, JSON.stringify(event.changes)]),
  ].map((row) => row.map(cell).join(",")).join("\r\n");
}
