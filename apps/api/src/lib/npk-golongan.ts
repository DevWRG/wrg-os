// Konstanta jenjang karir AM — SK/WRG/Sales/001/V/2026 Pasal 2.1 + Tabel 6.
// Ditaruh di kode, bukan tabel config: angka-angka ini bagian dari SK bertanda
// tangan, mengubahnya = merevisi SK (Pasal 9.2: rekalibrasi ≥1×/tahun, resmi).

export const GOLONGAN = ["OSP", "AM-0", "AM-1", "AM-2", "AM-3", "AM-4"] as const;
export type Golongan = (typeof GOLONGAN)[number];

export const isGolongan = (v: unknown): v is Golongan =>
  typeof v === "string" && (GOLONGAN as readonly string[]).includes(v);

export const GOLONGAN_LABEL: Record<Golongan, string> = {
  "OSP": "OSP (Probasi)",
  "AM-0": "AM Junior I",
  "AM-1": "AM Junior II",
  "AM-2": "AM Senior I",
  "AM-3": "AM Senior II",
  "AM-4": "AM Region",
};

// Pasal 2.1 — Customer Aktif MINIMUM per golongan.
//
// ⚠️ BUKAN penyebut aspek NPK "Customer". Sempat dipakai begitu (v1.165.0) dan itu
// KELIRU: Pasal 2.1 sendiri menegaskan angka ini "syarat MINIMUM untuk eligible naik
// golongan, bukan target program". Roster ACE Bagian 6 memberi target program per AM
// yang jauh lebih tinggi — Arif 71 · Luri 50 · Firman 40 vs minimum AM-2 yang cuma 28.
// Memakai minimum sebagai penyebut membuat AM senior dinilai 71÷28 = 253% → mentok
// nilai penuh, dan aspek Customer kehilangan daya bedanya.
// Penyebut yang benar: target program per AM di `sales_target_am.target_customer`.
// Konstanta ini disimpan untuk kelayakan naik golongan (Pasal 2.2), bukan penskoran.
export const TARGET_CUSTOMER_MINIMUM: Record<Golongan, number | null> = {
  "OSP": null, "AM-0": 10, "AM-1": 20, "AM-2": 28, "AM-3": 35, "AM-4": 45,
};

// Pasal 2.1 — Target revenue MINIMUM per bulan. CATATAN PENTING: SK menyebut ini
// syarat minimum eligible NAIK GOLONGAN, "bukan target program" — target program
// per AM datang dari Baseline KPI ACE (di sistem: sales_target_am). Jangan dipakai
// sebagai penyebut aspek Revenue; disimpan di sini untuk fitur Pasal 2.2 nanti.
export const REVENUE_MINIMUM_BULANAN: Record<Golongan, number | null> = {
  "OSP": null, "AM-0": 300_000_000, "AM-1": 500_000_000,
  "AM-2": 750_000_000, "AM-3": 1_200_000_000, "AM-4": 2_000_000_000,
};

// Tabel 6 — target New Customer per BULAN untuk sub-metrik CRM "New Customer Rate"
// ("target per level: Jr=1, Sr=2, Region=3"). OSP mengikuti tingkat Junior.
export const TARGET_NEW_CUSTOMER_BULANAN: Record<Golongan, number> = {
  "OSP": 1, "AM-0": 1, "AM-1": 1, "AM-2": 2, "AM-3": 2, "AM-4": 3,
};

// Golongan Roster ACE ("AM Senior", tanpa I/II) → kode SK. Roster Bagian 1 hanya
// mengenal 5 level, SK Pasal 2.1 memecah Senior jadi AM-2/AM-3 → 7 orang berlabel
// "AM Senior" tak bisa dipetakan pasti (klarifikasi ADR-040 A3). Sampai dijawab,
// dipakai AM-2 (yang LEBIH RENDAH) — mengecilkan lebih aman daripada membesarkan,
// dan untuk NPK tak berpengaruh sama sekali: target New Customer Sr=2 identik di
// AM-2 maupun AM-3, sedangkan target Customer datang dari target program per AM.
export const GOLONGAN_DARI_ROSTER: Record<string, Golongan> = {
  "OSP": "OSP",
  "AM JR I": "AM-0",
  "AM JR II": "AM-1",
  "AM SENIOR": "AM-2",     // ambigu AM-2/AM-3 — lihat catatan di atas
  "AM REGION": "AM-4",
};

// Target new customer sepanjang semester = target bulanan × 6.
export const targetNewCustomerSemester = (g: Golongan | null): number | null =>
  g ? TARGET_NEW_CUSTOMER_BULANAN[g] * 6 : null;
