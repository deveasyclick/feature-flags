"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheckIcon,
  LoaderCircleIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  createFlagVariationSchema,
  type FlagType,
  type FlagVariation,
  type FlagVariationValue,
} from "@dariise/contracts";
import { VariationValueInput } from "@/components/app/flags/variation-value-input";
import {
  parseVariationText,
  variationValueError,
} from "@/components/app/flags/variation-text";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, flags as flagsApi } from "@/lib/api";

/** A variation as the editor holds it: the saved shape plus what changed. */
interface VariationRow extends FlagVariation {
  /** What the API already has, so an unchanged row does not offer a save. */
  saved: FlagVariation;
}

function toRows(variations: FlagVariation[]): VariationRow[] {
  return variations.map((variation) => ({
    ...variation,
    saved: variation,
  }));
}

/**
 * The text each value field shows, by key, for rows being edited.
 *
 * A value field is text while it is being typed, and a number or a JSON document
 * passes through states that are not a value at all, so the raw text lives here
 * rather than being reconstructed from the value on every keystroke. No entry
 * means the saved value is what the field shows.
 */
/** The value a new variation starts at, as field text. */
function variantSeedText(type: FlagType): string {
  const seed: FlagVariationValue =
    type === "boolean" ? false : type === "number" ? 0 : type === "json" ? {} : "";

  return type === "json" ? JSON.stringify(seed) : String(seed);
}

function savedText(row: VariationRow): string {
  return row.value === null
    ? ""
    : typeof row.value === "string"
      ? row.value
      : JSON.stringify(row.value);
}

function changed(row: VariationRow): boolean {
  return (
    row.name !== row.saved.name ||
    row.description !== row.saved.description ||
    JSON.stringify(row.value) !== JSON.stringify(row.saved.value)
  );
}

/**
 * Variations tab.
 *
 * Variations belong to the flag, so they are edited here rather than in one
 * environment's configuration: every environment picks an off and a default
 * variation from this list. A key is permanent, which is why only the name,
 * value and description are editable, and a variation an environment still
 * refers to cannot be removed — the API's 409 says which environments do.
 */
export function FlagVariations({
  projectKey,
  flagKey,
  type,
  variations: initialVariations,
  protectedEnvironment,
}: {
  readonly projectKey: string;
  readonly flagKey: string;
  /** The flag's declared type; every value has to be one of these. */
  readonly type: FlagType;
  readonly variations: FlagVariation[];
  /** A protected environment has to approve its own configuration, not the values. */
  readonly protectedEnvironment: boolean;
}) {
  const [rows, setRows] = useState<VariationRow[]>(() =>
    toRows(initialVariations),
  );
  const [draft, setDraft] = useState<{
    key: string;
    name: string;
    value: FlagVariationValue;
    description: string;
  }>(() => ({
    key: "",
    name: "",
    value: type === "boolean" ? false : type === "number" ? 0 : type === "json" ? {} : "",
    description: "",
  }));
  /** The text each row's value field shows; absent means the saved value. */
  const [valueTexts, setValueTexts] = useState<Record<string, string>>({});
  /** The text the add form's value field shows, seeded from the type. */
  const [draftText, setDraftText] = useState(() => variantSeedText(type));
  const [adding, setAdding] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  /** The message the add form's value field shows, if it is not a value. */
  const draftValueError = variationValueError(type, draftText);

  function patchRow(key: string, patch: Partial<FlagVariation>) {
    setRows((previous) =>
      previous.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  /**
   * Store what was typed, and the value it stands for only when it parses.
   *
   * The row keeps both, so the field never shows one thing while a save writes
   * another: while the text does not parse, `addVariation`'s schema check and the
   * API both refuse the value that parsed a keystroke ago.
   */
  function changeRowValueText(key: string, text: string) {
    setValueTexts((previous) => ({ ...previous, [key]: text }));

    const parsed = parseVariationText(type, text);

    if (parsed.ok) patchRow(key, { value: parsed.value });
  }

  /** The same, for the row being added. */
  function changeDraftValueText(text: string) {
    setDraftText(text);

    const parsed = parseVariationText(type, text);

    if (parsed.ok) setDraft((previous) => ({ ...previous, value: parsed.value }));
  }

  async function addVariation() {
    if (adding) return;

    // The value is checked as the text the field holds: while it does not parse,
    // the stored value is the one that parsed a keystroke ago, and writing that
    // would save something the reader is no longer looking at.
    const value = parseVariationText(type, draftText);

    if (!value.ok) {
      setError(value.message);
      return;
    }

    const parsed = createFlagVariationSchema.safeParse({
      key: draft.key.trim(),
      name: draft.name.trim(),
      value: value.value,
      description: draft.description.trim() || null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the variation.");
      return;
    }

    setAdding(true);
    setError(null);
    setSavedKey(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      // The API answers a variation write with the flag's whole variation set,
      // so the row is picked out of it and the rest of the editor is untouched.
      const variations = await flagsApi.createVariation(
        projectKey,
        flagKey,
        parsed.data,
        { signal: controller.signal },
      );
      const created = variations.find(
        (variation) => variation.key === parsed.data.key,
      );

      if (!created) {
        setError("The API did not return the new variation.");
        return;
      }

      setRows((previous) => [...previous, { ...created, saved: created }]);
      setDraft((previous) => ({
        ...previous,
        key: "",
        name: "",
        description: "",
      }));
      setDraftText(
        variantSeedText(type),
      );
      router.refresh();
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") return;

      setError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function saveVariation(row: VariationRow) {
    if (pendingKey) return;
    setPendingKey(row.key);
    setSavedKey(null);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const variations = await flagsApi.updateVariation(
        projectKey,
        flagKey,
        row.key,
        {
          name: row.name.trim(),
          value: row.value,
          description: row.description,
        },
        { signal: controller.signal },
      );
      const updated = variations.find(
        (variation) => variation.key === row.key,
      );

      if (!updated) {
        setError("The API did not return the saved variation.");
        return;
      }

      setRows((previous) =>
        previous.map((entry) =>
          entry.key === row.key ? { ...updated, saved: updated } : entry,
        ),
      );
      setSavedKey(row.key);
      router.refresh();
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") return;

      setError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setPendingKey(null);
    }
  }

  async function removeVariation(row: VariationRow) {
    if (pendingKey) return;
    setPendingKey(row.key);
    setSavedKey(null);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await flagsApi.removeVariation(projectKey, flagKey, row.key, {
        signal: controller.signal,
      });

      setRows((previous) => previous.filter((entry) => entry.key !== row.key));
      router.refresh();
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") return;

      // A 409 carries the environments that still refer to this variation, so
      // the API's own message is the one worth showing.
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Variations</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            The values this flag can serve in every environment. Every value is a{" "}
            {type}, because that is what the flag was created as.
          </p>

          {rows.length === 0 ? (
            <p className="text-muted-foreground mt-4 rounded-lg border border-dashed p-4 text-[12px]">
              No variations yet. A flag needs at least one value to serve.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="bg-muted/30 rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="bg-card rounded-md border px-2 py-0.5 font-mono text-[11px]">
                      {row.key}
                    </span>
                    <button
                      type="button"
                      disabled={pendingKey !== null}
                      onClick={() => removeVariation(row)}
                      className="text-muted-foreground hover:text-danger-ink inline-flex items-center gap-1 text-[10px] underline-offset-2 hover:underline disabled:opacity-60"
                    >
                      {pendingKey === row.key ? (
                        <LoaderCircleIcon
                          aria-hidden="true"
                          className="size-3 animate-spin"
                        />
                      ) : (
                        <Trash2Icon aria-hidden="true" className="size-3" />
                      )}
                      Remove
                    </button>
                  </div>

                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label
                        htmlFor={`variation-name-${row.key}`}
                        className="text-[11px]"
                      >
                        name
                      </Label>
                      <Input
                        id={`variation-name-${row.key}`}
                        className="h-8 text-[12px]"
                        value={row.name}
                        onChange={(event) =>
                          patchRow(row.key, { name: event.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-1">
                      <Label
                        htmlFor={`variation-value-${row.key}`}
                        className="text-[11px]"
                      >
                        value
                      </Label>
                      <VariationValueInput
                        id={`variation-value-${row.key}`}
                        type={type}
                        text={valueTexts[row.key] ?? savedText(row)}
                        onChange={(text) => changeRowValueText(row.key, text)}
                      />
                    </div>
                  </div>

                  <div className="mt-2.5 space-y-1">
                    <Label
                      htmlFor={`variation-description-${row.key}`}
                      className="text-[11px]"
                    >
                      description
                    </Label>
                    <Textarea
                      id={`variation-description-${row.key}`}
                      rows={2}
                      maxLength={280}
                      placeholder="What this value means, and when it is served."
                      className="text-[12px]"
                      value={row.description ?? ""}
                      onChange={(event) =>
                        patchRow(row.key, {
                          description: event.target.value || null,
                        })
                      }
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-end gap-2">
                    {savedKey === row.key ? (
                      <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
                        <CheckCheckIcon aria-hidden="true" className="size-3.5" />
                        Saved
                      </span>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-[11px]"
                      disabled={
                        pendingKey !== null ||
                        !changed(row) ||
                        row.name.trim() === ""
                      }
                      onClick={() => saveVariation(row)}
                    >
                      {pendingKey === row.key ? (
                        <LoaderCircleIcon className="animate-spin" />
                      ) : (
                        <SaveIcon aria-hidden="true" className="size-3.5" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-muted-foreground mt-3 text-[11px]">
            Keys stay fixed: the serving behaviour and the off variation of every
            environment refer to them by name.
          </p>

          {error ? (
            <div className="mt-3">
              <FieldError>{error}</FieldError>
            </div>
          ) : null}
        </section>
      </div>

      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Add a variation</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            A new value becomes selectable in every environment straight away.
          </p>

          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-variation-key" className="text-[11px]">
                key
              </Label>
              <Input
                id="new-variation-key"
                className="h-8 font-mono text-[12px]"
                placeholder="treatment"
                value={draft.key}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    key: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="new-variation-name" className="text-[11px]">
                name
              </Label>
              <Input
                id="new-variation-name"
                className="h-8 text-[12px]"
                placeholder="Treatment"
                value={draft.name}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="new-variation-value" className="text-[11px]">
                value
              </Label>
              <VariationValueInput
                id="new-variation-value"
                type={type}
                text={draftText}
                error={draftValueError}
                onChange={changeDraftValueText}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="new-variation-description" className="text-[11px]">
                description
              </Label>
              <Textarea
                id="new-variation-description"
                rows={2}
                maxLength={280}
                placeholder="Optional. What this value means."
                className="text-[12px]"
                value={draft.description}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    description: event.target.value,
                  }))
                }
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setDraft((previous) => ({
                    ...previous,
                    key: "",
                    name: "",
                    description: "",
                  }))
                }
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]"
              >
                <XIcon aria-hidden="true" className="size-3.5" />
                Clear
              </button>
              <Button
                size="sm"
                className="gap-1.5 text-[11px]"
                disabled={adding}
                onClick={addVariation}
              >
                {adding ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <PlusIcon aria-hidden="true" className="size-3.5" />
                )}
                {adding ? "Adding…" : "Add variation"}
              </Button>
            </div>
          </div>
        </section>

        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">
            {protectedEnvironment ? "Protected environment" : "Shared by every environment"}
          </h2>
          <p className="text-muted-foreground mt-1 text-[11px] leading-5">
            {protectedEnvironment
              ? "Variations are flag-wide, so they apply here without an approval; only this environment's configuration is proposed for review."
              : `Adding or changing a variation is visible to every environment of this project, because the value belongs to ${flagKey} rather than to one environment.`}
          </p>
        </section>
      </div>
    </div>
  );
}
