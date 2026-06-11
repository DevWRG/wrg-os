"use client";

import { useEffect, useState } from "react";

export interface SessionUser {
  name?: string | null;
  email?: string;
  role?: string;
}

/** Ambil user sesi dari /api/auth/me (apps/api membungkus { user: {...} }). */
export function useSession(): SessionUser | null {
  const [me, setMe] = useState<SessionUser | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const u = d?.user ?? d;
        if (active && u && (u.name || u.email)) setMe(u as SessionUser);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return me;
}

/** Inisial avatar: 2 huruf — dua kata pertama, atau dua huruf pertama bila satu kata. */
export function initials(s: string): string {
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase() || "WL";
}

export const displayName = (me: SessionUser | null): string =>
  me?.name || me?.email?.split("@")[0] || "Admin";

export const displayRole = (me: SessionUser | null): string =>
  me ? me.role || "user" : "Auth nonaktif · dev";
