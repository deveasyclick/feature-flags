import { describe, expect, it } from "vitest";
import { auditCsv } from "./audit-csv";
import type { AuditEventView } from "./audit-log-types";

describe("audit CSV export", () => {
  it("escapes quotes and neutralizes spreadsheet formulas in untrusted names", () => {
    const event: AuditEventView = { id: "id", dayLabel: "Today", actor: "actor", actorName: '=HYPERLINK("https://example.test")', action: "flag.created", verb: "created", target: "a,b", context: "project\nDevelopment", environmentId: null, environmentName: "Workspace", targetFieldLabel: "Flag", changes: [], timeLabel: "12:00", absoluteLabel: "2026-10-22", ageHours: 0 };
    const csv = auditCsv([event]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"project\nDevelopment"');
    expect(auditCsv([]).split("\r\n")).toHaveLength(1);
  });
});
