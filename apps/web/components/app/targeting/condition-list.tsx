"use client";

import { useId } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import type { TargetingOperator } from "@dariise/contracts";
import { AttributeSuggestions } from "@/components/app/targeting/attribute-suggestions";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  attributeTypeOf,
  operatorsForAttributeType,
  valuePlaceholder,
  withAttribute,
  type ConditionDraft,
} from "@/lib/targeting";

/**
 * The conditions one rule — or one segment — is a conjunction of.
 *
 * The attribute is free text with the known names offered as suggestions,
 * because the contract takes any attribute and a condition another client wrote
 * has to stay editable. The operator list follows the attribute's type, which
 * decides whether a comparison the engine would resolve to false can be built.
 */
export function ConditionList({
  conditions,
  attributesId,
  disabled = false,
  emptyLabel,
  onChange,
  onAdd,
  onRemove,
}: {
  readonly conditions: ConditionDraft[];
  /** The suggestion list to share; this list renders its own when omitted. */
  readonly attributesId?: string;
  readonly disabled?: boolean;
  readonly emptyLabel: string;
  readonly onChange: (id: string, patch: Partial<ConditionDraft>) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
}) {
  const generated = useId();
  const listId = attributesId ?? `${generated}-attributes`;

  return (
    <div>
      {attributesId === undefined ? <AttributeSuggestions id={listId} /> : null}

      {conditions.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-[11px]">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-2">
          {conditions.map((condition, index) => {
            const attributeType = attributeTypeOf(condition.attribute);

            return (
              <li
                key={condition.id}
                className="bg-muted/30 flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
              >
                <span className="text-muted-foreground w-7 text-[10px] uppercase">
                  {index === 0 ? "if" : "and"}
                </span>

                <Input
                  list={listId}
                  value={condition.attribute}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      condition.id,
                      withAttribute(condition, event.target.value),
                    )
                  }
                  aria-label={`Attribute for condition ${index + 1}`}
                  className="h-7 w-40 font-mono text-[11px]"
                />

                <Select
                  value={condition.operator}
                  disabled={disabled}
                  onValueChange={(value) =>
                    onChange(condition.id, {
                      operator: value as TargetingOperator,
                    })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Operator for condition ${index + 1}`}
                    className="text-[11px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operatorsForAttributeType(attributeType).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Input
                  value={condition.values}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(condition.id, { values: event.target.value })
                  }
                  aria-label={`Values for condition ${index + 1}`}
                  placeholder={valuePlaceholder(attributeType)}
                  className="h-7 min-w-28 flex-1 font-mono text-[11px]"
                />

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(condition.id)}
                  aria-label={`Remove condition ${index + 1}`}
                  className="text-muted-foreground hover:text-danger-ink rounded p-1 transition-colors disabled:opacity-60"
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onAdd}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[11px] underline-offset-2 hover:underline disabled:opacity-60"
        >
          <PlusIcon aria-hidden="true" className="size-3.5" />
          Add condition
        </button>
        <p className="text-muted-foreground text-[10px]">
          Separate multiple values with commas.
        </p>
      </div>
    </div>
  );
}
