"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/components/ui/button";

export const THEME_STORAGE_KEY = "animachat-theme";

/**
 * Light/dark switch. The current theme lives on <html data-theme>, applied
 * before paint by the inline script in the root layout (default: light).
 */
export function ThemeToggle() {
  // null until mounted — the server doesn't know the stored theme
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode etc. — theme just won't persist */
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      shape="square"
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
