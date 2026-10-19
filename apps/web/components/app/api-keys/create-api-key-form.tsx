"use client";

import { useRef, useState } from "react";
import { KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
import {
  createApiKeySchema,
  toFieldErrors,
  type CreateApiKeyInput,
  type CreatedApiKey,
  type FieldErrors,
} from "@iwifunni/contracts";
import {
  KeyShownOnceCard,
  SecurityBestPracticesCard,
} from "@/components/app/api-keys/api-key-notes";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, apiKeys } from "@/lib/api";
import { capture } from "@/shared/analytics";

type CreateApiKeyField = "name" | "expiresInDays";

type CreateApiKeyErrors = FieldErrors<CreateApiKeyField>;

type ApiKeyExpiration = "never" | "30d" | "90d" | "1y";

const expirations: Array<{
  value: ApiKeyExpiration;
  label: string;
  days: number | null;
}> = [
  { value: "never", label: "Never", days: null },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "1y", label: "1 year", days: 365 },
];

/**
 * Issues a key into the environment the dashboard is scoped to.
 *
 * Neither the environment nor the scopes are fields. The chrome already names
 * the environment, and the scopes follow from the kind — a management key is the
 * credential for driving the API, so the server records every management scope
 * rather than asking somebody to tick boxes that cannot narrow it yet.
 *
 * It is rendered inside a dialog, so it owns no navigation: the caller closes
 * the dialog in `onCreated` and the list picks the key up from the provider.
 */
export function CreateApiKeyForm({
  projectKey,
  environmentKey,
  onCreated,
  onCancel,
}: {
  readonly projectKey: string;
  /** The environment the dashboard is scoped to; the key is issued into it. */
  readonly environmentKey: string;
  /** Handed the created key so its dialog can show the secret. */
  readonly onCreated: (created: CreatedApiKey) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [expiration, setExpiration] = useState<ApiKeyExpiration>("never");
  const [errors, setErrors] = useState<CreateApiKeyErrors>({});
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  function clearError(field: keyof CreateApiKeyErrors) {
    setErrors((previous) => ({
      ...previous,
      form: undefined,
      [field]: undefined,
    }));
  }

  function input(): CreateApiKeyInput {
    return {
      name: name.trim(),
      environmentKey,
      expiresInDays:
        expirations.find((option) => option.value === expiration)?.days ??
        null,
    };
  }

  function validate(): CreateApiKeyErrors | null {
    const result = createApiKeySchema.safeParse(input());

    return result.success
      ? null
      : toFieldErrors<CreateApiKeyField>(result.error);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors = validate();
    if (nextErrors) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const created = await apiKeys.create(projectKey, input(), {
        signal: controller.signal,
      });
      capture("api_key_created", {
        expiration,
      });
      onCreated(created);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;

      setErrors({
        form:
          error instanceof ApiError
            ? error.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <section className="bg-card rounded-lg border p-4">
        <h2 className="text-[13px] font-medium">Key details</h2>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Field
              id="api-key-name"
              label="Name"
              name="name"
              placeholder="Production SDK"
              required
              maxLength={80}
              value={name}
              error={errors.name}
              onChange={(event) => {
                setName(event.target.value);
                clearError("name");
              }}
            />
            <p className="text-muted-foreground text-[11px]">
              Shown in the dashboard and audit log.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key-expiration">Expiration</Label>
            <Select
              value={expiration}
              onValueChange={(value) =>
                setExpiration(value as ApiKeyExpiration)
              }
            >
              <SelectTrigger
                id="api-key-expiration"
                className="h-8 w-full text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {expirations.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-[11px]">
              Rotate keys regularly for production workloads.
            </p>
          </div>
        </div>
      </section>

      <KeyShownOnceCard />
      <SecurityBestPracticesCard />

      {errors.form ? <FieldError>{errors.form}</FieldError> : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>

        <Button type="submit" size="sm" className="gap-1.5" disabled={pending}>
          {pending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <KeyRoundIcon aria-hidden="true" className="size-3.5" />
          )}
          {pending ? "Creating…" : "Create key"}
        </Button>
      </div>
    </form>
  );
}
