"use client";

import { Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/button";

export const THEME_STORAGE_KEY = "animachat-theme";

type Mode = "light" | "dark" | "auto";

const systemTheme = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/**
 * Theme switch cycling light → dark → auto. The resolved theme lives on
 * <html data-theme>, applied before paint by the inline script in the root
 * layout; "auto" (the default) follows prefers-color-scheme, live.
 */
export function ThemeToggle() {
  // null until mounted — the server doesn't know the stored mode
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* private mode etc. */
    }
    setMode(stored === "dark" || stored === "light" ? stored : "auto");
  }, []);

  // in auto, track OS theme changes while the app is open
  useEffect(() => {
    if (mode !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  function cycle() {
    const next: Mode = mode === "light" ? "dark" : mode === "dark" ? "auto" : "light";
    setMode(next);
    document.documentElement.dataset.theme = next === "auto" ? systemTheme() : next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode etc. — theme just won't persist */
    }
  }

  const label =
    mode === "auto"
      ? "Theme: auto (follows system) — switch to light"
      : mode === "dark"
        ? "Theme: dark — switch to auto"
        : "Theme: light — switch to dark";

  return (
    <Button
      variant="ghost"
      size="sm"
      shape="square"
      title={label}
      aria-label={label}
      onClick={cycle}
    >
      {mode === "dark" ? <Moon /> : mode === "auto" ? <SunMoon /> : <Sun />}
    </Button>
  );
}
