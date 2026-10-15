"use client";

import type { FlagType, FlagVariationValue } from "@iwifunni/contracts";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { VariationValueInput } from "@/components/app/flags/variation-value-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toWorkspaceSlug } from "@/lib/validation";

/** One value a flag is being created with, as the form holds it. */
export interface VariationDraft {
  /** Stable across edits: a name is editable text, so it cannot identify a row. */
  readonly id: string;
  name: string;
  /** The value, kept in step with `text` whenever the text parses. */
  value: FlagVariationValue;
  /** Exactly what the value field shows; a number or JSON edit lives here. */
  text: string;
}

/** What the returned value is called for each type. */
const VALUE_LABELS: Record<FlagType, string> = {
  boolean: "Boolean value",
  string: "String value",
  number: "Number value",
  json: "JSON value",
};

/** The first two rows are the flag's two roles; anything after them is extra. */
const ROLE_TITLES = ["Enabled", "Disabled"] as const;

const ROLE_HINTS = ["Default variation", "Off variation"] as const;

const NAME_PLACEHOLDERS = [
  "e.g. Variation 1",
  "e.g. Variation 2",
  "e.g. New checkout",
] as const;

const labelClass = "text-[10px] tracking-[0.1em] uppercase";

/**
 * The key each draft is created with, in list order.
 *
 * The key is what a targeting rule and the SDK payload name a variation by, and
 * it is never typed here: it follows the name, or the value when the name is
 * left blank. Every type but `string` has to key its two roles `on` and `off`,
 * which is the only pair the contract accepts. A repeated name is suffixed
 * rather than refused.
 */
export function deriveVariationKeys(
  type: FlagType,
  drafts: VariationDraft[],
): string[] {
  const taken = new Set<string>();

  return drafts.map((draft, index) => {
    const role = index === 0 ? "on" : index === 1 ? "off" : null;
    const base =
      role !== null && type !== "string"
        ? role
        : toWorkspaceSlug(draft.name) ||
          (typeof draft.value === "string" ? toWorkspaceSlug(draft.value) : "") ||
          role ||
          `variation-${index + 1}`;
    const key = uniqueKey(base, taken);

    taken.add(key);

    return key;
  });
}

/**
 * The key a name produces for a flag that already holds variations.
 *
 * The name is what the reader types, so this is what the API is sent. Null while
 * the name has no letters or digits to build a key from.
 */
export function variationKeyFromName(
  name: string,
  taken: ReadonlySet<string>,
): string | null {
  const base = toWorkspaceSlug(name);

  return base === "" ? null : uniqueKey(base, taken);
}

/** The base itself, or the first free numeric suffix of it. */
function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  let key = base;
  let attempt = 2;

  while (taken.has(key)) {
    key = `${base}-${attempt}`;
    attempt += 1;
  }

  return key;
}

export function FlagVariationList({
  type,
  variations,
  collapsed,
  onChange,
  onValueTextChange,
  onToggle,
  onAdd,
  onRemove,
}: {
  readonly type: FlagType;
  readonly variations: VariationDraft[];
  /** Ids whose fields are folded away. */
  readonly collapsed: ReadonlySet<string>;
  readonly onChange: (id: string, patch: Partial<VariationDraft>) => void;
  /** A keystroke in a value field, as the text the reader typed. */
  readonly onValueTextChange: (id: string, text: string) => void;
  readonly onToggle: (id: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
}) {
  // Only a string flag may be created with a variation list of its own; the
  // other three types are the fixed `on`/`off` pair the contract accepts.
  const canAdd = type === "string";
  const labelOf = (draft: VariationDraft, index: number) =>
    draft.name.trim() || `Variation ${index + 1}`;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {variations.map((variation, index) => {
          const isRole = index < 2;
          const folded = collapsed.has(variation.id);

          return (
            <li
              key={variation.id}
              className={cn(
                "rounded-lg border p-3",
                isRole ? "border-primary/40" : null,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    onToggle(variation.id);
                  }}
                  aria-expanded={!folded}
                  aria-controls={`${variation.id}-fields`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium">
                      {ROLE_TITLES[index] ?? "Additional"}
                    </span>
                    <span className="text-muted-foreground block text-[10px]">
                      {ROLE_HINTS[index] ?? "Served by a targeting rule"}
                    </span>
                  </span>
                  {folded ? (
                    <span className="text-muted-foreground max-w-[45%] truncate font-mono text-[11px]">
                      {JSON.stringify(variation.value)}
                    </span>
                  ) : null}
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cn(
                      "text-muted-foreground size-3.5 shrink-0 transition-transform",
                      folded ? null : "rotate-180",
                    )}
                  />
                </button>

                {canAdd && !isRole ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      onRemove(variation.id);
                    }}
                    aria-label={`Remove ${labelOf(variation, index)}`}
                  >
                    ×
                  </Button>
                ) : null}
              </div>

              <div
                id={`${variation.id}-fields`}
                hidden={folded}
                className="mt-3 grid gap-3 sm:grid-cols-2"
              >
                <div className="space-y-1">
                  <Label htmlFor={`${variation.id}-name`} className={labelClass}>
                    Name
                  </Label>
                  <Input
                    id={`${variation.id}-name`}
                    value={variation.name}
                    onChange={(event) => {
                      onChange(variation.id, { name: event.target.value });
                    }}
                    placeholder={NAME_PLACEHOLDERS[index] ?? "e.g. New checkout"}
                    className="h-8 text-[12px]"
                  />
                </div>

                <div className="space-y-1">
                  {type === "boolean" ? (
                    <>
                      <span className={labelClass}>{VALUE_LABELS[type]}</span>
                      <p className="font-mono text-[12px] leading-8">
                        {String(variation.value)}
                      </p>
                    </>
                  ) : (
                    <>
                      <Label
                        htmlFor={`${variation.id}-value`}
                        className={labelClass}
                      >
                        {VALUE_LABELS[type]}
                      </Label>
                      <VariationValueInput
                        id={`${variation.id}-value`}
                        type={type}
                        text={variation.text}
                        onChange={(text) => {
                          onValueTextChange(variation.id, text);
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {canAdd ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-[11px]"
          onClick={onAdd}
        >
          Add variation
        </Button>
      ) : null}
    </div>
  );
}
