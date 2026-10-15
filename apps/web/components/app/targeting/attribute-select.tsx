"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { targetingAttributeOptions } from "@/lib/targeting";

const optionId = (listId: string, value: string) => `${listId}-${value}`;

/**
 * The attribute field: the suggested keys with their types, or a custom key.
 *
 * The suggestions are one project-wide constant, not a registry - nothing in the
 * product records which attributes an application actually sends - so the list is
 * an aid and the field stays free text. Each suggestion carries the type the
 * dashboard guesses, shown beside the name, because the type decides which
 * operators the row offers and the reader cannot see that decision otherwise.
 * A key the list does not name keeps the `string` comparisons, which are the
 * ones that work on a value the engine holds as text; the row's own type control
 * is how a reader says a custom key is something else.
 */
export function AttributeSelect({
  value,
  disabled = false,
  onChange,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (attribute: string) => void;
  readonly "aria-label": string;
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
}) {
  const generated = useId();
  const listId = `${generated}-options`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const query = value.trim();
  const matches = useMemo(
    () =>
      query === ""
        ? targetingAttributeOptions
        : targetingAttributeOptions.filter((option) =>
            option.value.toLowerCase().includes(query.toLowerCase()),
          ),
    [query],
  );

  const exact = targetingAttributeOptions.some(
    (option) => option.value === query,
  );
  const active = matches[activeIndex];

  function commit(attribute: string) {
    onChange(attribute);
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);

      if (matches.length === 0) return;

      setActiveIndex((current) =>
        event.key === "ArrowDown"
          ? (current + 1) % matches.length
          : (current - 1 + matches.length) % matches.length,
      );
      return;
    }

    if (event.key === "Enter" && open && active) {
      event.preventDefault();
      commit(active.value);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        // Focus moving to another control closes the list; a click landing on a
        // suggestion keeps it open until that option is committed.
        const next = event.relatedTarget;

        if (
          next instanceof Node &&
          containerRef.current?.contains(next) === true
        ) {
          return;
        }

        setOpen(false);
      }}
    >
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
        />
        <Input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active ? optionId(listId, active.value) : undefined
          }
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid ? true : undefined}
          value={value}
          disabled={disabled}
          placeholder="Select or type an attribute"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          className="h-7 w-56 pl-7 font-mono text-[11px]"
        />
      </div>

      {open && !disabled ? (
        <div className="bg-popover text-popover-foreground absolute top-8 left-0 z-50 w-72 rounded-lg border p-1 shadow-md">
          <p className="text-muted-foreground px-2 py-1.5 text-[10px]">
            Suggested attributes, with the types this dashboard suggests. They
            are not a declaration your application made.
          </p>

          <ul
            id={listId}
            role="listbox"
            aria-label="Suggested attributes"
            className="max-h-56 overflow-y-auto"
          >
            {matches.length === 0 ? (
              <li className="text-muted-foreground px-2 py-1.5 text-[11px]">
                No suggestion matches. Whatever you type is used as the key.
              </li>
            ) : (
              matches.map((option, index) => {
                const selected = option.value === query;

                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      id={optionId(listId, option.value)}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => commit(option.value)}
                      className={
                        "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors " +
                        (index === activeIndex ? "bg-accent text-accent-foreground" : "")
                      }
                    >
                      <span className="flex items-center gap-1.5 font-mono">
                        {selected ? (
                          <CheckIcon aria-hidden="true" className="size-3" />
                        ) : (
                          <span aria-hidden="true" className="size-3" />
                        )}
                        {option.value}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {option.type}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {query !== "" && !exact ? (
            <p className="text-muted-foreground mt-1 border-t px-2 pt-1.5 pb-1 text-[10px] leading-4">
              <span className="text-foreground font-mono">{query}</span> is not a
              suggestion. It is used as the exact key, and the engine will match
              an attribute of that name. No attribute is verified to exist - set
              its type on the row if it is not text.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
