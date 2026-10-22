"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { AuthCard } from "./auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TwoFactorChallenge() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = backup ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
      if (result.error) throw new Error(authErrorMessage(result.error));
      router.refresh(); router.push("/overview");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to verify code."); }
    finally { setBusy(false); }
  }
  return <AuthCard title="Verify your sign-in" description={backup ? "Enter one of your unused recovery codes." : "Enter the code from your authenticator app."}>
    <form onSubmit={verify} className="space-y-4">
      <Label htmlFor="two-factor-code">{backup ? "Recovery code" : "Authenticator code"}</Label>
      <Input id="two-factor-code" autoComplete="one-time-code" inputMode={backup ? "text" : "numeric"} required value={code} onChange={(event) => setCode(event.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} className="w-full">Verify</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => { setBackup(!backup); setCode(""); setError(""); }}>{backup ? "Use authenticator app" : "Use a recovery code"}</Button>
    </form>
  </AuthCard>;
}
