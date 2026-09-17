// Label & warna perspektif Balanced Scorecard, dipakai bersama tab OKR & KPI.
// Sengaja satu tempat: perspektif yang sama pernah dieja berbeda di beberapa
// komponen ("Finansial" vs "Keuangan"), dan itu membuat dua tabel yang
// sebenarnya memotong data yang sama terlihat seperti dua hal berbeda.

export const PERSP: Record<string, { label: string; color: string }> = {
  fin: { label: "Finansial", color: "#1f6f54" },
  cust: { label: "Pelanggan", color: "#2563a8" },
  proc: { label: "Proses Internal", color: "#7a4ba0" },
  learn: { label: "Pembelajaran & Pertumbuhan", color: "#c2691a" },
};

export const PORDER = ["fin", "cust", "proc", "learn"] as const;

// null dibiarkan "—", tidak di-default ke salah satu perspektif: di
// `divisi_okr` ada objective yang PIC-nya memang belum menentukan perspektif.
export const perspLabel = (p: string | null | undefined) => (p ? (PERSP[p]?.label ?? p) : "—");
export const perspColor = (p: string | null | undefined) => (p ? (PERSP[p]?.color ?? "#64748b") : "#94a3b8");
