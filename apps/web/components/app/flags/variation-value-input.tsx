"use client";

import type { FlagType } from "@iwifunni/contracts";
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
 *
 * The raw text belongs to the caller, not to this control. A number or a JSON
 * document is entered over several keystrokes, and most of those states are not
 * a value the flag could serve, so the caller holds what was typed, refuses to
 * submit while it does not parse, and this control only reports what it shows.
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
  text,
  onChange,
  error = null,
  disabled = false,
  placeholder,
}: {
  readonly id: string;
  readonly type: FlagType;
  /** What the field shows, exactly as the caller stores it. */
  readonly text: string;
  readonly onChange: (text: string) => void;
  /** A parse failure to show under the field, once the reader has left it. */
  readonly error?: string | null;
  readonly disabled?: boolean;
  /** Overrides the example this type shows in an empty field. */
  readonly placeholder?: string;
}) {
  const hint = placeholder ?? DEFAULT_PLACEHOLDER[type];
  const message = error === null ? null : <FieldError>{error}</FieldError>;

  if (type === "boolean") {
    return (
      <Select
        value={text === "true" ? "true" : "false"}
        onValueChange={(next) => onChange(next)}
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
          aria-invalid={error !== null}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
        {message}
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
        aria-invalid={error !== null}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      {message}
    </div>
  );
}
