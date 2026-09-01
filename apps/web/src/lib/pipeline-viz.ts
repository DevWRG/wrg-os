// Warna tahap pipeline (F1 SPT) — SATU sumber untuk semua permukaan yang
// menggambar deal: board /pipeline (pipeline-insights.tsx) dan tab Pipeline di
// /report (sales-analytics/pipeline-report-view.tsx). Sebelumnya tiap file punya
// salinan sendiri → dua surface bisa beda warna untuk tahap yang sama.
//
// Tahap itu ORDINAL (urut funnel), bukan kategori bebas: 5 tahap terbuka pakai
// ramp satu-hue makin gelap makin dekat closing (monoton, jadi urutannya terbaca
// walau buta warna), sedangkan Won/Lost pakai warna status yang direservasi
// (hijau/merah) supaya "sudah diputus" beda kelas dari "masih jalan".
//
// Palet lama Negotiation #f59e0b vs Closing #fb923c cuma terpisah ΔE 4,2 di
// penglihatan normal (praktis kembar) — itu sebabnya ramp ini menggantinya.
const STAGE_FILL: Record<string, string> = {
  Prospecting: "#93c5fd",
  Presentation: "#60a5fa",
  Quotation: "#3b82f6",
  Negotiation: "#2563eb",
  Closing: "#1d4ed8",
  "Closing-Won": "#059669",
  "Closing-Lost": "#dc2626",
};
export const stageFill = (s: string) => STAGE_FILL[s] ?? "#94a3b8";

// Warna teks untuk label yang duduk DI ATAS fill tahap. Dua langkah pertama ramp
// masih terang (tinta gelap), sisanya gelap (tinta putih) — tanpa ini label
// "4 deal" jadi tulisan gelap di atas biru tua/merah, nyaris tak terbaca.
const LIGHT_STEPS = new Set(["Prospecting", "Presentation"]);
export const stageInk = (s: string) => (LIGHT_STEPS.has(s) ? "#0f172a" : "#ffffff");

// Hue tunggal untuk bar perbandingan besaran (brand / AM / bulan): identitas
// sudah dibawa label sumbu, jadi warna tak perlu ikut membedakan baris —
// mencampur 8 hue di sana justru bikin rank terlihat seperti kategori.
export const BAR_FILL = "#2563a8";
// Warna status hasil deal — dipakai di komposisi Won/Lost/masih jalan.
export const RESULT_FILL = { won: "#059669", lost: "#dc2626", open: "#94a3b8" };
