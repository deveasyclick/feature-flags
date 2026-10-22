"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TwoFactorSettings({ initiallyEnabled = false, enrollmentOnly = false }: { readonly initiallyEnabled?: boolean; readonly enrollmentOnly?: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [uri, setUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function action(kind: "enable" | "verify" | "disable" | "recover") {
    setBusy(true); setMessage("");
    try {
      if (kind === "enable") {
        const result = await authClient.twoFactor.enable({ password, method: "totp" });
        if (result.error) throw new Error(authErrorMessage(result.error));
        if (result.data?.method === "totp") { setUri(result.data.totpURI); setBackupCodes(result.data.backupCodes); setSavedCodes(false); }
      } else if (kind === "verify") {
        const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
        if (result.error) throw new Error(authErrorMessage(result.error));
        setEnabled(true); setUri(""); setCode(""); setBackupCodes([]); setPassword("");
        setMessage("Two-factor authentication enabled. Other sessions have been signed out.");
        router.refresh(); if (enrollmentOnly) router.push("/overview");
      } else if (kind === "disable") {
        const result = await authClient.twoFactor.disable({ password });
        if (result.error) throw new Error(authErrorMessage(result.error));
        setEnabled(false); setPassword(""); setBackupCodes([]); setMessage("Two-factor authentication disabled."); router.refresh();
      } else {
        const result = await authClient.twoFactor.generateBackupCodes({ password });
        if (result.error) throw new Error(authErrorMessage(result.error));
        setBackupCodes(result.data?.backupCodes ?? []); setSavedCodes(false); setPassword("");
        setMessage("Previous recovery codes have been replaced. Save these codes securely.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update two-factor authentication."); }
    finally { setBusy(false); }
  }
  return <section className="bg-card border rounded-lg p-4 space-y-3">
    <h2 className="text-sm font-medium">Your two-factor authentication · {enabled ? "enabled" : "disabled"}</h2>
    <p className="text-xs text-muted-foreground">Use an authenticator app and keep recovery codes somewhere secure. Verification signs out your other sessions. For accounts created with a social provider, leave the password blank.</p>
    {!uri && <><Label htmlFor="mfa-password">Current password</Label><Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></>}
    {!enabled && !uri && <Button size="sm" disabled={busy} onClick={() => action("enable")}>Set up authenticator</Button>}
    {uri && <div className="space-y-3 text-xs">
      <p>Add a new account manually in your authenticator app with this secret:</p>
      <code className="block break-all bg-muted p-3 rounded select-all">{new URL(uri).searchParams.get("secret")}</code>
      <p>Account: Iwifunni</p>
    </div>}
    {backupCodes.length > 0 && <div className="space-y-2"><p className="text-xs">Save these recovery codes. Each code can be used once.</p><pre className="bg-muted rounded p-3 text-xs select-all">{backupCodes.join("\n")}</pre><label className="flex gap-2 items-center text-xs"><input type="checkbox" checked={savedCodes} onChange={(event) => setSavedCodes(event.target.checked)} />I saved my recovery codes</label></div>}
    {uri && <><Label htmlFor="mfa-enrollment-code">Authenticator code</Label><Input id="mfa-enrollment-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /><Button size="sm" disabled={busy || !savedCodes || !code} onClick={() => action("verify")}>Verify and enable</Button></>}
    {enabled && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => action("recover")}>Replace recovery codes</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => action("disable")}>Disable two-factor authentication</Button></div>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
