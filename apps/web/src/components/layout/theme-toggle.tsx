"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

// Dark mode ringan tanpa next-themes: toggle class `dark` di <html> + simpan
// ke localStorage. globals.css memakai selector `.dark`, jadi ini cukup.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isDark = stored ? stored === "dark" : document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", isDark);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(isDark);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={dark ? "Mode terang" : "Mode gelap"}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
