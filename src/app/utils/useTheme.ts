import { useCallback, useSyncExternalStore } from "react";

const THEME_KEY = "gili_theme";

export type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage unavailable — fall through to system preference
  }
  // Light regardless of the OS setting. The library is a colour-critical tool —
  // assets are authored against a white canvas — so a visitor whose laptop is on
  // dark mode should still see the artwork the way it was drawn until they ask
  // for dark themselves.
  return "light";
}

/*
 * Module-level store rather than per-component useState.
 *
 * useTheme has more than one caller (the sidebar user menu and the Sonner
 * Toaster). With useState each of those held an independent copy, so toggling
 * the theme in the sidebar left the toaster rendering in whatever theme the app
 * booted with until the next reload. A shared store keeps every consumer on the
 * same value.
 */
let current: Theme = getInitialTheme();
const listeners = new Set<() => void>();

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // no-op — theme just won't persist across reloads
  }
}

// Applied at module load so the class is on <html> before the first paint,
// rather than after an effect flushes.
if (typeof document !== "undefined") apply(current);

function setThemeValue(theme: Theme) {
  if (theme === current) return;
  current = theme;
  apply(theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reads and writes the app theme. Toggling adds/removes `dark` on <html>, which
 * is what the `@custom-variant dark` rule in globals.css keys off, and persists
 * the choice. Defaults to light the first time the app is opened.
 */
export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => current
  );

  const setTheme = useCallback((next: Theme) => setThemeValue(next), []);
  const toggleTheme = useCallback(
    () => setThemeValue(current === "dark" ? "light" : "dark"),
    []
  );

  return { theme, setTheme, toggleTheme };
}
