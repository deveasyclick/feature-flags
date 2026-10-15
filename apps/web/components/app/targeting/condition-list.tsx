"use client";

import { PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import {
  TARGETING_ATTRIBUTE_TYPES,
  type TargetingAttributeType,
  type TargetingOperator,
} from "@dariise/contracts";
import { AttributeSelect } from "@/components/app/targeting/attribute-select";
import { FieldError } from "@/components/auth/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  conditionIssues,
  effectiveAttributeType,
  isSuggestedAttributeType,
  operatorsForAttributeType,
  suggestedAttributeType,
  valuePlaceholder,
  withAttribute,
  withAttributeType,
  type ConditionDraft,
} from "@/lib/targeting";

/***
 * The type one row is drawn with.
 *
 * A suggested attribute shows the type the list gives it, labelled as a
 * suggestion: nothing in the product declares an attribute's type, so the row
 * must not present the guess as a fact. A custom key gets the same control as a
 * choice, because `string` is only a sensible default and a number compared as
 * text is a condition the engine resolves to false rather than an error.
 */
function AttributeTypeControl({
  attribute,
  declared,
  index,
  disabled,
  onChange,
}: {
  readonly attribute: string;
  readonly declared?: TargetingAttributeType;
  readonly index: number;
  readonly disabled: boolean;
  readonly onChange: (attributeType: TargetingAttributeType) => void;
}) {
  const suggested = suggestedAttributeType(attribute);
  // An overridden suggestion, and every custom key, reads as a choice. Hiding
  // the selector behind "a type was declared" made it unreachable, because
  // nothing but the selector can declare one.
  const isSuggestedType = isSuggestedAttributeType(attribute, declared);

  if (isSuggestedType) {
    return (
      <span
        title={`The dashboard suggests ${suggested} for "${attribute}". It is not a declared type: nothing records the attributes an application sends, so check the SDK context if the operators below look wrong.`}
        className="text-muted-foreground decoration-dotted underline-offset-2 text-[10px] underline"
      >
        {suggested}?
      </span>
    );
  }

  return (
    <Select
      // Left unset until the reader chooses, so the control shows `type?`
      // rather than presenting its own default as a decision.
      value={declared}
      disabled={disabled}
      onValueChange={(value) =>
        onChange(value as TargetingAttributeType)
      }
    >
      <SelectTrigger
        size="sm"
        aria-label={`Type for condition ${index + 1}`}
        title="The operators follow this type. The engine compares a version, a date and any text the same way, so the numeric comparisons are offered only for a number."
        className="w-24 text-[10px]"
      >
        <SelectValue placeholder="type?" />
      </SelectTrigger>
      <SelectContent>
        {TARGETING_ATTRIBUTE_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {type}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The conditions one rule - or one segment - is a conjunction of.
 *
 * A condition starts with no attribute, and the controls that describe it stay
 * hidden until one is chosen: the attribute decides the type, the type decides
 * the operators and the value control. Showing them first is what let a
 * plausible-looking default attribute be saved as a condition that could never
 * match.
 *
 * The attribute stays free text with the suggested names offered beside it,
 * because the contract takes any attribute and a condition another client wrote
 * has to stay editable. A custom name is allowed and labelled; it is not
 * refused, because this list is not the evaluation context.
 */
export function ConditionList({
  conditions,
  disabled = false,
  emptyLabel,
  onChange,
  onAdd,
  onRemove,
}: {
  readonly conditions: ConditionDraft[];
  readonly disabled?: boolean;
  readonly emptyLabel: string;
  readonly onChange: (id: string, patch: Partial<ConditionDraft>) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
}) {
  // Keyed by draft id, so a row reads its own problem however the list is
  // reordered underneath it.
  const issuesById = new Map(
    conditionIssues(conditions).map((issue) => [issue.id, issue]),
  );

  return (
    <div>
      {conditions.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-[11px]">
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-2">
          {conditions.map((condition, index) => {
            const attribute = condition.attribute.trim();
            const attributeType = effectiveAttributeType(
              attribute,
              condition.attributeType,
            );
            const selected = attribute !== "";
            const issue = issuesById.get(condition.id);
            const attributeName = `condition-${index + 1}-attribute`;

            return (
              <li
                key={condition.id}
                className="bg-muted/30 rounded-lg border p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground w-7 text-[10px] uppercase">
                    {index === 0 ? "if" : "and"}
                  </span>

                  <AttributeSelect
                    value={condition.attribute}
                    disabled={disabled}
                    aria-label={`Attribute for condition ${index + 1}`}
                    aria-invalid={!selected && issue !== undefined}
                    aria-describedby={
                      issue ? `${attributeName}-issue` : undefined
                    }
                    onChange={(next) =>
                      onChange(condition.id, withAttribute(condition, next))
                    }
                  />

                  {selected ? (
                    <>
                      <AttributeTypeControl
                        attribute={attribute}
                        declared={condition.attributeType}
                        index={index}
                        disabled={disabled}
                        onChange={(next) =>
                          onChange(
                            condition.id,
                            withAttributeType(condition, next),
                          )
                        }
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

                      {attributeType === "boolean" ? (
                        <Select
                          value={
                            condition.values === "true" ||
                            condition.values === "false"
                              ? condition.values
                              : undefined
                          }
                          disabled={disabled}
                          onValueChange={(value) =>
                            onChange(condition.id, { values: value })
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Value for condition ${index + 1}`}
                            className="min-w-28 flex-1 font-mono text-[11px]"
                          >
                            <SelectValue placeholder="choose a value" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">true</SelectItem>
                            <SelectItem value="false">false</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
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
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground text-[10px]">
                      Operators and a value appear once an attribute is chosen.
                    </span>
                  )}

                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemove(condition.id)}
                    aria-label={`Remove condition ${index + 1}`}
                    className="text-muted-foreground hover:text-danger-ink rounded p-1 transition-colors disabled:opacity-60"
                  >
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </button>
                </div>

                {issue ? (
                  <div id={`${attributeName}-issue`} className="mt-1.5 pl-9">
                    {issue.severity === "error" ? (
                      <FieldError>{issue.message}</FieldError>
                    ) : (
                      <p className="text-warn-ink flex items-start gap-1.5 text-[11px] leading-4">
                        <TriangleAlertIcon
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0"
                        />
                        <span>{issue.message}</span>
                      </p>
                    )}
                  </div>
                ) : null}
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
        <p className="text-muted-foreground max-w-80 text-right text-[10px] leading-4">
          An attribute is matched by its exact key, so a condition on
          {" "}
          <span className="font-mono">beta</span>
          {" "}
          reads an attribute called beta. The suggested names and their types come
          from this dashboard, not from your application: they are not verified to
          exist at evaluation time, and a custom key is matched just the same.
        </p>
      </div>
    </div>
  );
}
