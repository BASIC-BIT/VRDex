"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ColorTheme = "dark" | "light";

const storageKey = "vrdex-theme";

function currentTheme(): ColorTheme {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(storageKey, theme);
}

export function ThemeToggle({ className }: { className?: string }) {
  return (
    <Button
      aria-label="Toggle color theme"
      className={className}
      size="md"
      title="Toggle color theme"
      type="button"
      variant="ghost"
      onClick={() => {
        const theme = currentTheme();
        const nextTheme = theme === "dark" ? "light" : "dark";
        applyTheme(nextTheme);
      }}
    >
      <Sun aria-hidden="true" className="theme-toggle__sun size-4" />
      <Moon aria-hidden="true" className="theme-toggle__moon size-4" />
    </Button>
  );
}
