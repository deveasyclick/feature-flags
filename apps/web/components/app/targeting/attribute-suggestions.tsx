import { targetingAttributeOptions } from "@/lib/targeting";

/** The suggestion list every attribute field points at with `list`. */
export function AttributeSuggestions({ id }: { readonly id: string }) {
  return (
    <datalist id={id}>
      {targetingAttributeOptions.map((option) => (
        <option key={option.value} value={option.value} />
      ))}
    </datalist>
  );
}
