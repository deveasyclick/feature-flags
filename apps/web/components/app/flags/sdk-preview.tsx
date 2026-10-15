import { CopyIcon } from "lucide-react";
import { cn } from "cn";
import type { FlagType, FlagVariationValue } from "@iwifunni/contracts";

interface SdkPreviewProps {
  /** Code lines, rendered one per row so indentation is preserved. */
  readonly lines: string[];
  /** Optional label for the code block header, e.g. a language. */
  readonly language?: string;
  readonly title?: string;
  readonly className?: string;
}

/**
 * Read-only SDK snippet.
 *
 * Copy is presentational for now — the clipboard API needs a client boundary
 * and the snippet is not sourced from a live config yet.
 */
export function SdkPreview({
  lines,
  language = "TypeScript",
  title = "SDK preview",
  className,
}: SdkPreviewProps) {
  return (
    <div className={cn("bg-card overflow-hidden rounded-lg border", className)}>
      <header className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <h2 className="text-[12px] font-medium">{title}</h2>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px]">
          {language}
          <CopyIcon aria-hidden="true" className="size-3" />
        </span>
      </header>

      <pre className="overflow-x-auto p-3 text-[11px] leading-5">
        <code className="font-mono">
          {lines.map((line, index) => (
            <span key={index} className="block">
              {line.length > 0 ? line : "\u00A0"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** The getter that carries a flag's type. */
const GETTERS: Record<FlagType, { method: string; type: string }> = {
  boolean: { method: "getBoolean", type: "boolean" },
  string: { method: "getString", type: "string" },
  number: { method: "getNumber", type: "number" },
  json: { method: "getJson<CheckoutConfig>", type: "CheckoutConfig" },
};

/**
 * A variation's value as the literal a caller would write.
 *
 * A value is arbitrary JSON, so `null` is legal and `JSON.stringify` renders it
 * as `"null"`; anything it cannot represent falls back to `null` rather than to a
 * bare `undefined`, which would not be valid inside the generated call.
 */
export function valueLiteral(value: FlagVariationValue): string {
  if (typeof value === "string") return JSON.stringify(value);

  return JSON.stringify(value) ?? "null";
}

/**
 * Build the evaluation snippet for a flag.
 *
 * Shared by the create screen and the Configuration tab so the shape of the
 * snippet lives in exactly one place. The getter follows the flag's type,
 * because the SDK's callers pass the default their own code needs rather than a
 * value the flag happens to serve — a `getBoolean` fallback cannot be a string.
 */
export function sdkSnippet(options: {
  flagKey: string;
  type: FlagType;
  /** The value the flag itself returns in this environment. */
  defaultValue: FlagVariationValue;
  /** What the calling application uses when the SDK cannot answer at all. */
  fallback: FlagVariationValue;
  environment?: string;
}): string[] {
  const { flagKey, type, defaultValue, fallback, environment } = options;
  const getter = GETTERS[type];

  return [
    'import { FeatureFlags } from "@iwifunni/node";',
    "",
    "const client = new FeatureFlags({",
    '  sdkKey: process.env.IWIFUNNI_SDK_KEY,',
    ...(environment ? [`  environment: "${environment}",`] : []),
    "});",
    "",
    "await client.initialize();",
    "",
    `const value: ${getter.type} = client.${getter.method}(`,
    `  "${flagKey}",`,
    `  ${valueLiteral(fallback)},`,
    '  { userId: "user_123" },',
    ");",
    "",
    `// Configured value in this environment: ${valueLiteral(defaultValue)}`,
  ];
}
