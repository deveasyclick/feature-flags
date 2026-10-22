"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Theme } from "@iwifunni/contracts";

const ThemeContext = createContext<{ setTheme: (theme: Theme) => void }>({ setTheme: () => {} });

export function PersonalTheme({ initialTheme, children }: { readonly initialTheme: Theme; readonly children: ReactNode }) {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => { media.removeEventListener("change", apply); document.documentElement.classList.remove("dark"); };
  }, [theme]);
  return <ThemeContext.Provider value={{ setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
