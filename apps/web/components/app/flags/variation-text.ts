import type { FlagType, FlagVariationValue } from "@iwifunni/contracts";

/**
 * A value as the text a field shows and edits.
 *
 * `string` and `number` have an obvious reading; JSON is its document form. A
 * null value is the empty string, which is how a reader gets back to the field
 * to type something else.
 */
export function variationText(
  type: FlagType,
  value: FlagVariationValue,
): string {
  if (value === null) return "";

  return type === "json" ? JSON.stringify(value) : String(value);
}

/**
 * Parse what a value field holds.
 *
 * A number field is text rather than `type="number"` because neither browser is
 * usable at the edges: a number input hands back `""` for a half-typed exponent
 * and reports an empty field as `0`, and the spinner steps a value the reader
 * never typed. The caller keeps the raw text and refuses to submit until this
 * returns a value, so a field that is still being typed cannot submit the number
 * it happened to hold a keystroke ago.
 */
/** The message a field shows for text that is not yet a value. */
export function variationValueError(type: FlagType, text: string): string {
  const parsed = parseVariationText(type, text);

  return parsed.ok ? "" : parsed.message;
}

export function parseVariationText(
  type: FlagType,
  text: string,
): { ok: true; value: FlagVariationValue } | { ok: false; message: string } {
  if (type === "boolean") {
    return { ok: true, value: text === "true" };
  }

  if (type === "string") {
    return text.trim() === ""
      ? { ok: false, message: "A string variation needs a value." }
      : { ok: true, value: text };
  }

  if (text.trim() === "") {
    return { ok: false, message: "Every variation needs a value." };
  }

  if (type === "json") {
    try {
      return { ok: true, value: JSON.parse(text) as FlagVariationValue };
    } catch {
      return { ok: false, message: "This is not a JSON document." };
    }
  }

  const parsed = Number(text);

  if (Number.isNaN(parsed)) {
    return { ok: false, message: "This is not a number." };
  }

  if (!Number.isFinite(parsed)) {
    return { ok: false, message: "That number is too large for a flag to serve." };
  }

  return { ok: true, value: parsed };
}
