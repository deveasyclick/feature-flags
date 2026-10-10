"use client";

import { useState } from "react";
import type { FlagType, FlagVariationValue } from "@dariise/contracts";
import { FieldError } from "@/components/auth/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * The value control a variation gets, chosen by the flag's declared type.
 *
 * Shared by flag creation and the configuration tab so a value is entered the
 * same way in both, and so neither can drift into offering a shape the server
 * would reject. The type is what an SDK relies on: a `string` flag serving
 * `true` would be a type error on the client.
 */
const DEFAULT_PLACEHOLDER: Record<FlagType, string> = {
  boolean: "",
  string: 'e.g. "adyen"',
  number: "e.g. 25",
  json: 'e.g. {"limit": 25}',
};

export function VariationValueInput({
  id,
  type,
  value,
  disabled = false,
  placeholder,
  onChange,
}: {
  readonly id: string;
  readonly type: FlagType;
  readonly value: FlagVariationValue;
  readonly disabled?: boolean;
  /** Overrides the example this type shows in an empty field. */
  readonly placeholder?: string;
  readonly onChange: (value: FlagVariationValue) => void;
}) {
  const hint = placeholder ?? DEFAULT_PLACEHOLDER[type];
  const [draftText, setDraftText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);

  /**
   * Parse what was typed, without storing text that does not parse.
   *
   * Returns whether the text is a legal value of this type. The caller keeps the
   * raw text in `draftText` either way, which is what lets a half-typed document
   * survive a keystroke: for JSON `JSON.parse` throws and for a number
   * `Number("")` is `0`, so neither is a value that can be handed upward as it is
   * typed. A number field is therefore a text field: `type="number"` would coerce
   * every partial keystroke, and "1" arrives as "1e" or "-" on the way to "1e3".
   */
  function parseText(text: string): boolean {
    if (type === "json") {
      if (text.trim() === "") return false;

      try {
        onChange(JSON.parse(text) as FlagVariationValue);

        return true;
      } catch {
        return false;
      }
    }

    if (text.trim() === "") return false;

    const parsed = Number(text);

    if (Number.isNaN(parsed)) return false;

    onChange(parsed);

    return true;
  }

  /**
   * Check the text when the reader leaves the field, and only then.
   *
   * A message raised on every keystroke would mark a value wrong while it is
   * still being typed, and an empty field is reported by the form's own
   * "every variation needs a value", not here.
   */
  function checkText(): void {
    const text = draftText;

    if (text === null || text.trim() === "") {
      setTextError(null);

      return;
    }

    setTextError(
      parseText(text)
        ? null
        : type === "json"
          ? "This is not a JSON document."
          : "This is not a number.",
    );
  }

  if (type === "boolean") {
    return (
      <Select
        value={String(value)}
        onValueChange={(next) => onChange(next === "true")}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 w-full text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">true</SelectItem>
          <SelectItem value="false">false</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (type === "json") {
    return (
      <div className="space-y-1">
        <Textarea
          id={id}
          rows={3}
          spellCheck={false}
          className="font-mono text-[11px]"
          placeholder={hint}
          disabled={disabled}
          aria-invalid={textError !== null}
          value={draftText ?? JSON.stringify(value)}
          onChange={(event) => {
            setDraftText(event.target.value);
            setTextError(null);
            parseText(event.target.value);
          }}
          onBlur={checkText}
        />
        {textError === null ? null : <FieldError>{textError}</FieldError>}
      </div>
    );
  }

  if (type === "number") {
    return (
      <div className="space-y-1">
        <Input
          id={id}
          className="h-8 text-[12px]"
          placeholder={hint}
          disabled={disabled}
          aria-invalid={textError !== null}
          value={draftText ?? String(value)}
          onChange={(event) => {
            setDraftText(event.target.value);
            setTextError(null);
            parseText(event.target.value);
          }}
          onBlur={checkText}
        />
        {textError === null ? null : <FieldError>{textError}</FieldError>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        id={id}
        className="h-8 text-[12px]"
        placeholder={hint}
        disabled={disabled}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
