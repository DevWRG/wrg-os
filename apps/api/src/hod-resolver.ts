// F121 — HoD Name Canonical Resolver. Resolve `atasan_raw` (teks bebas transkrip,
// mis. "Pak Yogi (HOD)", "Rocky Gunawan (HOD Sales East)", "Bu Ika (HOD Finance & SC)",
// "4 HOD (Rocky/Yogi/Arman/Mufid)") → key HoD kanonik. Strategi berlapis:
//   1) alias nama (word-boundary),  2) hint role ("HOD Sales West" dst),
//   3) fuzzy (Levenshtein ≤1, hanya token & alias ≥5 huruf — hindari false-positive).
// Foundation utk hod_key + Org Chart reporting-line (ORG_OPTIMAL).

// Daftar HoD kanonik ada di tabel `master_hod` (migrasi 198) — dibaca lewat
// repo/master-hod.ts lalu dioper ke sini. Modul ini sengaja tetap murni (tanpa DB)
// supaya bisa diuji dengan daftar buatan.
export interface Hod {
  key: string;
  name: string;      // nama lengkap (Org Chart, NPK)
  panggilan: string; // nama pendek (WatchPoint, dropdown)
  peran: string;     // tanpa awalan, mis. "Sales East"
  role: string;      // "HoD " + peran — bentuk yang dulu dipakai HODS
  aliases: string[];
  roleHints: string[];
}

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
export function resolveHods(raw: string, hods: readonly Hod[]): string[] {
  const t = norm(raw);
  if (!t) return [];
  const matched = new Set<string>();
  for (const h of hods) {
    if (h.aliases.some((a) => new RegExp(`\\b${a}\\b`).test(t))) matched.add(h.key);
    else if (h.roleHints.some((rh) => t.includes(rh))) matched.add(h.key);
  }
  // Fuzzy fallback (typo) — hanya bila belum ada match, & alias/token ≥5 huruf.
  if (matched.size === 0) {
    const tokens = t.split(/[^a-z]+/).filter((x) => x.length >= 5);
    for (const h of hods) for (const a of h.aliases) {
      if (a.length < 5) continue;
      if (tokens.some((tok) => lev(tok, a) <= 1)) matched.add(h.key);
    }
  }
  return [...matched];
}

export type HodStatus = "resolved" | "ambiguous" | "none";

// Resolusi tunggal: 1 match → key; 0 atau >1 → null (perlu review manual).
export function resolveHod(raw: string, hods: readonly Hod[]): string | null {
  const m = resolveHods(raw, hods);
  return m.length === 1 ? m[0] : null;
}

export function hodStatus(raw: string, hods: readonly Hod[]): HodStatus {
  const n = resolveHods(raw, hods).length;
  return n === 1 ? "resolved" : n > 1 ? "ambiguous" : "none";
}
