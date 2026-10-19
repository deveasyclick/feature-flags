"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  KeyRoundIcon,
  LogOutIcon,
  SettingsIcon,
  UserRoundIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { identify, reset } from "@/shared/analytics";
import { signOut } from "@/lib/auth";
import type { ChromeUser } from "@/lib/scope";

export function AccountMenu({ user }: { readonly user: ChromeUser }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    identify(user.id, {
      email: user.email,
      name: user.name,
      role: user.role,
    });
  }, [user]);

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await signOut(controller.signal);
      reset();
      router.push("/");
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="hover:bg-muted flex shrink-0 items-center gap-0.5 rounded-full p-0.5 transition-colors"
        >
          <Avatar size="sm">
            <AvatarFallback className="bg-nav-active text-[10px] text-white">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <ChevronDownIcon
            aria-hidden="true"
            className="text-muted-foreground size-3.5"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5">
          <Avatar>
            <AvatarFallback className="bg-nav-active text-[11px] text-white">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium">{user.name}</p>
            <p className="text-muted-foreground truncate text-[11px]">
              {user.email}
            </p>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserRoundIcon aria-hidden="true" />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/api-keys">
            <KeyRoundIcon aria-hidden="true" />
            API keys
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={handleSignOut}
        >
          <LogOutIcon aria-hidden="true" />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
