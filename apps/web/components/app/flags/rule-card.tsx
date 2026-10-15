"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  MoreHorizontalIcon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "cn";
import type { FlagVariation, SegmentSummary } from "@dariise/contracts";
import { ConditionList } from "@/components/app/targeting/condition-list";
import { FieldError } from "@/components/auth/field";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  conditionErrors,
  formatRuleSummary,
  variationNameOf,
  type ConditionDraft,
} from "@/lib/targeting";
import type { RuleDraft, RuleRolloutDraft } from "@/components/app/flags/flag-targeting";

/** The percentage and bucketing attribute of one rule's own rollout. */
export function RuleRolloutControls({
  rollout,
  index,
  disabled,
  attributesId,
  onChange,
} : {
  readonly rollout: RuleRolloutDraft;
  readonly index: number;
  readonly disabled: boolean;
  readonly attributesId: string;
  readonly onChange: (rollout: RuleRolloutDraft) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={rollout.percentage}
        disabled={disabled}
        inputMode="numeric"
        aria-label={`Rollout percentage for rule ${index + 1}`}
        onChange={(event) => onChange({ ...rollout, percentage: event.target.value })}
        className="h-7 w-16 text-[11px]"
      />
      <span className="text-muted-foreground text-[11px]">
        % of the subjects this rule matches, bucketed by
      </span>
      <Input
        list={attributesId}
        value={rollout.bucketBy}
        disabled={disabled}
        placeholder="userId"
        aria-label={`Bucketing attribute for rule ${index + 1}`}
        onChange={(event) => onChange({ ...rollout, bucketBy: event.target.value })}
        className="h-7 w-36 font-mono text-[11px]"
      />
    </div>
  );
}

/**
 * The segments one rule is gated on: every attached one has to match as well.
 *
 * The project's active segments are toggles. A key that no active segment
 * answers to stays listed because evaluation still resolves an archived one,
 * and dropping it silently would change what the rule serves.
 */
function RuleSegments({
  rule,
  segments,
  index,
  disabled,
  onToggle,
}: {
  readonly rule: RuleDraft;
  readonly segments: SegmentSummary[];
  readonly index: number;
  readonly disabled: boolean;
  readonly onToggle: (key: string) => void;
}) {
  const known = new Set(segments.map((segment) => segment.key));
  const unknown = rule.segmentKeys.filter((key) => !known.has(key));

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground mr-0.5 text-[10px] uppercase">
        segments
      </span>

      {segments.map((segment) => {
        const attached = rule.segmentKeys.includes(segment.key);

        return (
          <button
            key={segment.key}
            type="button"
            aria-pressed={attached}
            disabled={disabled}
            onClick={() => onToggle(segment.key)}
            aria-label={`${attached ? "Detach" : "Attach"} segment ${segment.name} ${attached ? "from" : "to"} rule ${index + 1}`}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-60",
              attached
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {segment.name}
          </button>
        );
      })}

      {unknown.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed
          disabled={disabled}
          onClick={() => onToggle(key)}
          title="This segment is not in the project's active list; evaluation still resolves it."
          className="border-primary bg-primary/10 text-primary rounded-md border px-2 py-0.5 font-mono text-[10px] disabled:opacity-60"
        >
          {key}
        </button>
      ))}

      {segments.length === 0 && unknown.length === 0 ? (
        <span className="text-muted-foreground text-[10px]">
          This project has no segments yet.
        </span>
      ) : null}
    </div>
  );
}

/**
 * One rule as a card: a header that always summarises it, and a body it shows
 * only while it is the rule being edited.
 *
 * The header is the whole summary - number, how many conditions, whether they
 * are complete, what it catches, what it serves - because a list of rules is read
 * by scanning which rule catches whom before any of them is opened. Only one card
 * is open at a time, which is what keeps ten rules on one screen.
 *
 * Presentational: the draft, its neighbours' existence and every mutation come
 * from the screen, so nothing here fetches, routes or decides order.
 */
export function RuleCard({
  rule,
  index,
  total,
  expanded,
  disabled,
  variations,
  segments,
  attributesId,
  onToggle,
  onDuplicate,
  onMove,
  onDelete,
  onDescription,
  onVariation,
  onConditionChange,
  onConditionAdd,
  onConditionRemove,
  onSegmentToggle,
  onRolloutToggle,
  onRolloutChange,
}: {
  readonly rule: RuleDraft;
  readonly index: number;
  readonly total: number;
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly variations: FlagVariation[];
  readonly segments: SegmentSummary[];
  readonly attributesId: string;
  readonly onToggle: () => void;
  readonly onDuplicate: () => void;
  readonly onMove: (offset: number) => void;
  readonly onDelete: () => void;
  readonly onDescription: (description: string) => void;
  readonly onVariation: (variation: string) => void;
  readonly onConditionChange: (
    conditionId: string,
    patch: Partial<ConditionDraft>,
  ) => void;
  readonly onConditionAdd: () => void;
  readonly onConditionRemove: (conditionId: string) => void;
  readonly onSegmentToggle: (key: string) => void;
  readonly onRolloutToggle: (enabled: boolean) => void;
  readonly onRolloutChange: (rollout: RuleRolloutDraft) => void;
}) {
  const number = index + 1;
  const issues = conditionErrors(rule.conditions);
  const description = rule.description.trim();
  // A rule's own name reads before its conditions: it is what the author called
  // the rule, and the conditions are how it is spelled out.
  const summary = description
    ? description + " - " + formatRuleSummary(rule)
    : formatRuleSummary(rule);
  const panelId = `rule-${rule.id}-editor`;

  return (
    <li className="bg-card rounded-lg border">
      <div className="flex items-center gap-1 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`Rule ${number}`}
          className="hover:bg-muted/50 flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left transition-colors"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform",
              expanded ? "" : "-rotate-90",
            )}
          />
          <span className="shrink-0 text-[11px] font-medium">Rule {number}</span>
          <span className="text-muted-foreground shrink-0 text-[10px]">
            {rule.conditions.length} condition
            {rule.conditions.length === 1 ? "" : "s"}
          </span>

          {issues.length > 0 ? (
            <span className="text-danger-ink inline-flex shrink-0 items-center gap-1 text-[10px]">
              <TriangleAlertIcon aria-hidden="true" className="size-3" />
              {issues.length} need attention
            </span>
          ) : (
            <span className="text-ok-ink shrink-0 text-[10px]">Valid</span>
          )}

          <span className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">
            {summary}
          </span>

          <span className="text-muted-foreground shrink-0 text-[10px]">
            serve
          </span>
          <span className="shrink-0 text-[11px]">
            {variationNameOf(variations, rule.variation)}
          </span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Actions for rule ${number}`}
              className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors disabled:opacity-50"
            >
              <MoreHorizontalIcon aria-hidden="true" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              disabled={disabled}
              onSelect={onDuplicate}
              className="gap-2 text-[11px]"
            >
              <CopyIcon aria-hidden="true" className="size-3.5" />
              Duplicate rule
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled || index === 0}
              onSelect={() => onMove(-1)}
              className="gap-2 text-[11px]"
            >
              <ArrowUpIcon aria-hidden="true" className="size-3.5" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled || index === total - 1}
              onSelect={() => onMove(1)}
              className="gap-2 text-[11px]"
            >
              <ArrowDownIcon aria-hidden="true" className="size-3.5" />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={disabled}
              onSelect={onDelete}
              variant="destructive"
              className="gap-2 text-[11px]"
            >
              <TrashIcon aria-hidden="true" className="size-3.5" />
              Delete rule
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded ? (
        <div id={panelId} className="space-y-3 border-t p-3">
          <Input
            value={rule.description}
            disabled={disabled}
            placeholder="What this rule is for"
            aria-label={`Description for rule ${number}`}
            onChange={(event) => onDescription(event.target.value)}
            className="h-7 text-[11px]"
          />

          <ConditionList
            conditions={rule.conditions}
            disabled={disabled}
            groupLabel="All conditions must match"
            emptyLabel="No conditions: this rule matches everybody."
            onChange={onConditionChange}
            onAdd={onConditionAdd}
            onRemove={onConditionRemove}
          />

          <RuleSegments
            rule={rule}
            segments={segments}
            index={index}
            disabled={disabled}
            onToggle={onSegmentToggle}
          />

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={rule.rollout !== null}
                disabled={disabled}
                onChange={(event) => onRolloutToggle(event.target.checked)}
                className="size-3.5"
              />
              Apply this rule to a percentage of the subjects it matches
            </label>

            {rule.rollout ? (
              <RuleRolloutControls
                rollout={rule.rollout}
                index={index}
                disabled={disabled}
                attributesId={attributesId}
                onChange={onRolloutChange}
              />
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t pt-3">
            <span className="text-muted-foreground text-[10px] uppercase">
              serve variation
            </span>
            <Select
              value={rule.variation}
              disabled={disabled}
              onValueChange={onVariation}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Variation served by rule ${number}`}
                className="text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variations.map((variation) => (
                  <SelectItem key={variation.key} value={variation.key}>
                    {variation.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {issues.length > 0 ? (
            <FieldError>{issues[0]?.message}</FieldError>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
