"use client";

import { useEffect, type ReactNode } from "react";
import { identify } from "@/shared/analytics";
import {
  AuthBrandPanel,
  type AuthPanelVariant,
} from "@/components/auth/auth-brand-panel";
import { useSession } from "@/lib/auth-client";

interface AuthShellProps {
  /** Copy the brand panel shows; see `AuthBrandPanel`. */
  readonly variant?: AuthPanelVariant;
  readonly children: ReactNode;
}

/**
 * Two-column shell shared by the access and onboarding screens: the brand panel
 * beside the form.
 *
 * The route groups own the layouts so each group can pick the panel copy it
 * shows, while the column geometry and the form column live here once.
 */
export function AuthShell({ variant, children }: AuthShellProps) {
  const { data: session } = useSession();

  useEffect(() => {
    const user = session?.user;

    if (!user?.id) {
      return;
    }

    identify(user.id, {
      email: user.email,
      name: user.name,
    });
  }, [session]);

  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <AuthBrandPanel variant={variant} />
      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        {children}
      </main>
    </div>
  );
}
