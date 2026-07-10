// F121 — HoD Name Canonical Resolver. Resolve `atasan_raw` (teks bebas transkrip,
// mis. "Pak Yogi (HOD)", "Rocky Gunawan (HOD Sales East)", "Bu Ika (HOD Finance & SC)",
// "4 HOD (Rocky/Yogi/Arman/Mufid)") → key HoD kanonik. Strategi berlapis:
//   1) alias nama (word-boundary),  2) hint role ("HOD Sales West" dst),
//   3) fuzzy (Levenshtein ≤1, hanya token & alias ≥5 huruf — hindari false-positive).
// Foundation utk hod_key + Org Chart reporting-line (ORG_OPTIMAL). Tanpa dependensi.

export interface Hod { key: string; name: string; role: string; aliases: string[]; roleHints: string[] }

export const HODS: Hod[] = [
  { key: "rocky", name: "Rocky Gunawan", role: "HoD Sales East",      aliases: ["rocky", "roki", "roky"], roleHints: ["hod sales east", "sales east"] },
  { key: "yogi",  name: "Yogi",          role: "HoD Sales West",      aliases: ["yogi"],                  roleHints: ["hod sales west", "sales west"] },
  { key: "muhid", name: "Muhid",         role: "HoD Aftersales",      aliases: ["muhid", "muhit"],        roleHints: ["hod aftersales", "aftersales"] },
  { key: "ika",   name: "Ika",           role: "HoD Finance & SC",    aliases: ["ika"],                   roleHints: ["hod finance", "finance & sc", "finance dan sc"] },
  { key: "mufid", name: "Mufid",         role: "HoD Business IVD",    aliases: ["mufid"],                 roleHints: ["business ivd", "hod business ivd"] },
  { key: "arman", name: "Arman",         role: "HoD Business Medical", aliases: ["arman"],                roleHints: ["business medical", "hod business medical"] },
  { key: "fafa",  name: "Fafa",          role: "HoD Accounting & Tax", aliases: ["fafa"],                 roleHints: ["hod accounting", "acc & tax", "accounting & tax", "acc&tax", "acc tax"] },
  { key: "husni", name: "Husni",         role: "HoD BD & GA",         aliases: ["husni"],                 roleHints: ["hod bd", "bd & ga", "bd&ga", "bd/ga"] },
];

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

// Semua HoD yang cocok dengan string (0, 1, atau banyak untuk kasus multi-HOD).
export function resolveHods(raw: string): string[] {
  const t = norm(raw);
  if (!t) return [];
  const matched = new Set<string>();
  for (const h of HODS) {
    if (h.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(t))) matched.add(h.key);
    else if (h.roleHints.some((rh) => t.includes(rh))) matched.add(h.key);
  }
  // Fuzzy fallback (typo) — hanya bila belum ada match, & alias/token ≥5 huruf.
  if (matched.size === 0) {
    const tokens = t.split(/[^a-z]+/).filter((x) => x.length >= 5);
    for (const h of HODS) for (const a of h.aliases) {
      if (a.length < 5) continue;
      if (tokens.some((tok) => lev(tok, a) <= 1)) matched.add(h.key);
    }
  }
  return [...matched];
}

export type HodStatus = "resolved" | "ambiguous" | "none";

// Resolusi tunggal: 1 match → key; 0 atau >1 → null (perlu review manual).
export function resolveHod(raw: string): string | null {
  const m = resolveHods(raw);
  return m.length === 1 ? m[0] : null;
}

export function hodStatus(raw: string): HodStatus {
  const n = resolveHods(raw).length;
  return n === 1 ? "resolved" : n > 1 ? "ambiguous" : "none";
}
