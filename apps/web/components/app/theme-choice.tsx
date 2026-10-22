import { cn } from "cn";
import {
  themeOptions,
  type WorkspaceTheme,
} from "@/components/app/settings/settings-options";

export function ThemeChoice({ theme, onChange, disabled }: { readonly theme: WorkspaceTheme; readonly onChange?: (theme: WorkspaceTheme) => void; readonly disabled?: boolean }) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      aria-disabled={disabled || !onChange}
      className="bg-muted inline-flex shrink-0 items-center gap-1 rounded-lg p-1"
    >
      {themeOptions.map((option) => {
        const active = option.value === theme;

        return (
          <button
            type="button"
            disabled={disabled || !onChange}
            onClick={() => onChange?.(option.value)}
            key={option.value}
            role="radio"
            aria-checked={active}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px]",
              active
                ? "bg-card text-foreground border font-medium"
                : "text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
