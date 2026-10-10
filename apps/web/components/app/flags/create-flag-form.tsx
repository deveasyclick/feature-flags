"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BracesIcon,
  HashIcon,
  LoaderCircleIcon,
  RocketIcon,
  TagIcon,
  ToggleLeftIcon,
  TypeIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  createFlagSchema,
  toFieldErrors,
  type CreateFlagInput,
  type FieldErrors,
  type FlagType,
  type FlagVariationValue,
} from "@dariise/contracts";
import { cn } from "cn";
import {
  deriveVariationKeys,
  FlagVariationList,
  type VariationDraft,
} from "@/components/app/flags/flag-variation-list";
import {
  parseVariationText,
  variationText,
  variationValueError,
} from "@/components/app/flags/variation-text";
import { SdkPreview, sdkSnippet } from "@/components/app/flags/sdk-preview";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, flags as flagsApi } from "@/lib/api";
import { toWorkspaceSlug } from "@/lib/validation";

const flagTypes: Array<{
  value: FlagType;
  label: string;
  hint: string;
  icon: LucideIcon;
}> = [
  {
    value: "boolean",
    label: "Boolean",
    hint: "true / false",
    icon: ToggleLeftIcon,
  },
  { value: "string", label: "String", hint: "Text value", icon: TypeIcon },
  { value: "number", label: "Number", hint: "Numeric value", icon: HashIcon },
  { value: "json", label: "JSON", hint: "Structured value", icon: BracesIcon },
];

const suggestedTags = ["checkout", "frontend", "payments", "internal"];

type CreateFlagField =
  | "key"
  | "name"
  | "description"
  | "type"
  | "variations"
  | "tags";

type CreateFlagErrors = FieldErrors<CreateFlagField>;

/**
 * The value a fresh variation starts at, so none is ever left empty.
 *
 * Position 1 is the Enabled role and gets the value that means "on" for its
 * type, because two rows reading `0` or `{}` make switching the flag on look
 * like it changed nothing.
 */
function blankValue(type: FlagType, position: number): FlagVariationValue {
  switch (type) {
    case "boolean":
      return false;
    case "number":
      return position === 1 ? 1 : 0;
    case "json":
      return { enabled: position === 1 };
    case "string":
      return `variation ${position}`;
  }
}

/** The text a value field shows for a starting value. */
function blankText(type: FlagType, position: number): string {
  return variationText(type, blankValue(type, position));
}

/** A seeded row in full: the value it starts at and the text that shows it. */
function seedRow(
  id: string,
  name: string,
  type: FlagType,
  position: number,
): VariationDraft {
  const value = blankValue(type, position);

  return { id, name, value, text: variationText(type, value) };
}

/** The two rows every flag starts with, labelled for the roles they hold. */
function seedVariations(type: FlagType): VariationDraft[] {
  if (type === "boolean") {
    return [
      seedRow("on", "Enabled", type, 1),
      seedRow("off", "Disabled", type, 2),
    ];
  }

  if (type === "string") {
    return [
      seedRow("first", "Variation 1", type, 1),
      seedRow("second", "Variation 2", type, 2),
    ];
  }

  return [
    seedRow("first", "Enabled", type, 1),
    seedRow("second", "Disabled", type, 2),
  ];
}

/** A string counts as filled in only when it is not blank; the rest carry their zero. */
function hasValue(value: FlagVariationValue): boolean {
  if (typeof value === "string") return value.trim() !== "";

  return value !== null && value !== undefined;
}

/** Distinguishes rows a reader adds, which arrive without a name to go by. */
let addedVariations = 0;

export function CreateFlagForm({
  projectKey,
  environmentKey,
  environmentName,
}: {
  readonly projectKey: string;
  /** The one environment the flag is created into. */
  readonly environmentKey: string;
  readonly environmentName: string;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [type, setType] = useState<FlagType>("boolean");
  const [variations, setVariations] = useState<VariationDraft[]>(() =>
    seedVariations("boolean"),
  );
  // Rows start folded: the summary line already states each role and its value.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(seedVariations("boolean").map((draft) => draft.id)),
  );
  const [errors, setErrors] = useState<CreateFlagErrors>({});
  const [pending, setPending] = useState(false);
  const [editedKey, setEditedKey] = useState(false);
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);

  const keys = useMemo(
    () => deriveVariationKeys(type, variations),
    [type, variations],
  );
  /** The value the flag returns when it is on, for the SDK preview. */
  const defaultDraft: VariationDraft | undefined = variations[0];
  /** The off row, which is what the SDK fallback is seeded from. */
  const offDraft: VariationDraft | undefined = variations[1];

  function clearError(field: keyof CreateFlagErrors) {
    setErrors((previous) => ({
      ...previous,
      form: undefined,
      [field]: undefined,
    }));
  }

  function handleTypeChange(next: FlagType) {
    const drafts = seedVariations(next);

    setType(next);
    // Values typed for the previous type are meaningless in the next one.
    setVariations(drafts);
    setCollapsed(new Set(drafts.map((draft) => draft.id)));
    clearError("type");
    clearError("variations");
  }

  function patchVariation(id: string, patch: Partial<VariationDraft>) {
    setVariations((previous) =>
      previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
    clearError("variations");
  }

  /**
   * Store what was typed, and the value it stands for only when it parses.
   *
   * The row keeps both, so the field never shows one thing while the submitted
   * value is another: while the text does not parse, `validationError` refuses
   * the submit instead of sending the value that parsed a keystroke ago.
   */
  function changeVariationText(id: string, text: string) {
    const draft = variations.find((entry) => entry.id === id);

    if (!draft) return;

    const parsed = parseVariationText(type, text);

    patchVariation(id, parsed.ok ? { text, value: parsed.value } : { text });
  }

  function toggleVariation(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  }

  function addVariation() {
    addedVariations += 1;
    const id = `added-${addedVariations}`;

    setVariations((previous) => [
      ...previous,
      {
        id,
        name: "",
        value: blankValue(type, previous.length + 1),
        text: blankText(type, previous.length + 1),
      },
    ]);
    setCollapsed((previous) => new Set(previous).add(id));
    clearError("variations");
  }

  function removeVariation(id: string) {
    setVariations((previous) => previous.filter((draft) => draft.id !== id));
    setCollapsed((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    clearError("variations");
  }

  function handleNameChange(value: string) {
    setName(value);
    // Keep the key in step with the name until the user takes it over.
    if (!editedKey) setKey(toWorkspaceSlug(value));
    clearError("name");
  }

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;

    setTags((previous) => [...previous, tag]);
    setTagDraft("");
    clearError("tags");
  }

  function validationError(): CreateFlagErrors | null {
    // The text is what the reader sees, so it is what decides whether the row is
    // complete: a field holding something that is not a value yet blocks the
    // submit rather than quietly sending the last value that was one.
    const unparsed = variations.find(
      (draft) => !parseVariationText(type, draft.text).ok,
    );

    if (unparsed) {
      return { variations: variationValueError(type, unparsed.text) };
    }

    if (variations.some((draft) => !hasValue(draft.value))) {
      return { variations: "Every variation needs a value." };
    }

    // `name` is optional on the wire, so leaving one blank is legal — but a
    // blank field the reader was invited to fill is not: sending it would drop
    // the label and let the API label the variation after its key instead.
    if (variations.some((draft) => draft.name.trim() === "")) {
      return { variations: "Every variation needs a name." };
    }

    return null;
  }

  /**
   * Every type ships its variations, including boolean.
   *
   * The pair a boolean gets is the conventional `on`/`off` the contract requires
   * of a non-string flag, so typing over the seeded "Enabled"/"Disabled" labels
   * persists them rather than being discarded.
   */
  function input(): CreateFlagInput {
    const declared = {
      variations: variations.map((draft, index) => ({
        key: keys[index],
        name: draft.name.trim(),
        // A string flag's value is the text itself, so it is taken from there
        // rather than from the copy `changeVariationText` parsed.
        value: type === "string" ? draft.text : draft.value,
      })),
      defaultVariation: keys[0],
      offVariation: keys[1],
    };

    return {
      key: key.trim(),
      name: name.trim(),
      description: description.trim() || null,
      type,
      tags,
      ...declared,
    };
  }

  function validate(): CreateFlagErrors | null {
    const own = validationError();

    if (own) return own;

    const result = createFlagSchema.safeParse(input());

    return result.success ? null : toFieldErrors<CreateFlagField>(result.error);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors = validate();

    if (nextErrors) {
      setErrors(nextErrors);
      // A folded row hides the field the error belongs to.
      if (nextErrors.variations) setCollapsed(new Set());
      return;
    }

    setErrors({});
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const created = await flagsApi.create(projectKey, input(), {
        signal: controller.signal,
      });

      /**
       * Straight to the flag, with no summary screen in between.
       *
       * A new flag is created switched off, so the only thing left to do is
       * configure it — and that happens on its own page. `replace` rather than
       * `push`, so going back cannot land on a filled-in create form and a
       * second submission.
       */
      router.replace(
        `/projects/${projectKey}/flags/${created.key}?environment=${environmentKey}`,
      );
    } catch (error) {
      // Cleared here rather than in a `finally`: on success the route is about
      // to change, and re-enabling the button first would flash a form the user
      // has already submitted.
      setPending(false);

      if ((error as Error)?.name === "AbortError") return;

      if (error instanceof ApiError) {
        if (error.status === 409) {
          setErrors({ key: error.message });
          return;
        }

        setErrors({ form: error.message });
        return;
      }

      setErrors({ form: "Something went wrong. Please try again." });
    }
  }

  const previewFlagKey = key.trim() || "flag-key";

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">
          Create Feature Flag
        </h1>
        <p className="text-muted-foreground mt-0.5 text-[13px]">
          It is created switched off in {environmentName}. An owner can be
          added from the flag once it exists.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <section className="bg-card space-y-4 rounded-lg border p-4">
            <Field
              id="flag-name"
              label="Name"
              name="name"
              placeholder="New checkout experience"
              required
              value={name}
              error={errors.name}
              onChange={(event) => handleNameChange(event.target.value)}
            />

            <div className="space-y-2">
              <Field
                id="flag-key"
                label="Key"
                name="key"
                required
                value={key}
                error={errors.key}
                className="font-mono"
                onChange={(event) => {
                  setEditedKey(true);
                  setKey(event.target.value);
                  clearError("key");
                }}
              />
              <p className="text-muted-foreground text-[11px]">
                {key.trim()
                  ? "Used to evaluate the flag. The key cannot be changed later."
                  : "Lower case and dashes only, e.g. checkout-v2."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="flag-description">Description</Label>
              <Textarea
                id="flag-description"
                name="description"
                rows={3}
                maxLength={280}
                placeholder="What this flag controls and when it can be removed."
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  clearError("description");
                }}
              />
              {errors.description ? (
                <FieldError>{errors.description}</FieldError>
              ) : null}
            </div>

            <div className="space-y-2">
              <p id="flag-type-label" className="text-[13px] font-medium">
                Type
              </p>
              <RadioGroup
                aria-labelledby="flag-type-label"
                value={type}
                onValueChange={(value) => handleTypeChange(value as FlagType)}
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {flagTypes.map((option) => {
                  const Icon = option.icon;
                  const selected = type === option.value;

                  return (
                    <Label
                      key={option.value}
                      htmlFor={`flag-type-${option.value}`}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center font-normal transition-colors",
                        selected
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50",
                      )}
                    >
                      <RadioGroupItem
                        id={`flag-type-${option.value}`}
                        value={option.value}
                        className="sr-only"
                      />
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "size-4",
                          selected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="text-[12px] font-medium">
                        {option.label}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {option.hint}
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            </div>
          </section>

          <section className="bg-card rounded-lg border p-4">
            <h2 className="text-[13px] font-medium">Variations</h2>
            <p className="text-muted-foreground mt-1 text-[11px] leading-4">
              What the flag returns. Each variation&apos;s key is derived from
              its name, and that key is what a targeting rule points at.
            </p>

            <div className="mt-4">
              <FlagVariationList
                type={type}
                variations={variations}
                collapsed={collapsed}
                onChange={patchVariation}
                onValueTextChange={changeVariationText}
                onToggle={toggleVariation}
                onAdd={addVariation}
                onRemove={removeVariation}
              />
            </div>

            {errors.variations ? (
              <FieldError>{errors.variations}</FieldError>
            ) : null}
          </section>

          <section className="bg-card rounded-lg border p-4">
            <h2 className="text-[13px] font-medium">Tags</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => {
                      setTags((previous) =>
                        previous.filter((item) => item !== tag),
                      );
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                  </button>
                </span>
              ))}

              <div className="flex items-center gap-1.5">
                <TagIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-3.5"
                />
                <Input
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag(tagDraft);
                    }
                  }}
                  aria-label="Add a tag"
                  placeholder="Add Tag"
                  className="h-7 w-28 text-[11px]"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestedTags
                .filter((tag) => !tags.includes(tag))
                .map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addTag(tag)}
                    className="text-muted-foreground hover:text-foreground border-border rounded-md border border-dashed px-2 py-0.5 text-[10px] transition-colors"
                  >
                    + {tag}
                  </button>
                ))}
            </div>

            {errors.tags ? <FieldError>{errors.tags}</FieldError> : null}
          </section>

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}

          <div className="flex items-center justify-between gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/environments/${environmentKey}/flags`}>Cancel</Link>
            </Button>

            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={pending}
            >
              {pending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <RocketIcon aria-hidden="true" className="size-3.5" />
              )}
              {pending ? "Creating…" : "Create Flag"}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <SdkPreview
            lines={sdkSnippet({
              flagKey: previewFlagKey,
              type,
              // The value the flag returns when it is on, and the value the
              // calling application keeps for itself when the SDK cannot answer
              // at all. They are different arguments even when they agree here.
              defaultValue: defaultDraft?.value ?? null,
              fallback: offDraft?.value ?? null,
            })}
          />
        </div>
      </div>
    </form>
  );
}
