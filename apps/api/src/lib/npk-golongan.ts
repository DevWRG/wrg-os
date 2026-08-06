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

// Pasal 2.1 — Target Customer Aktif per golongan. Jadi PENYEBUT aspek NPK
// "Customer Count Growth" (Pasal 3.1 baris 2: "Target per level golongan").
// OSP tidak punya target customer sendiri (bertugas membantu AM, Pasal 1.2).
export const TARGET_CUSTOMER: Record<Golongan, number | null> = {
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

// Target customer untuk satu semester. Aspek Customer dinilai atas jumlah customer
// AKTIF (stock), bukan akumulasi — target level dipakai apa adanya, tidak dibagi 2
// dan tidak di-pro-rata (alasan sama dengan jalur HoD, lihat repo/npk.ts).
export const targetCustomerSemester = (g: Golongan | null): number | null =>
  g ? TARGET_CUSTOMER[g] : null;

// Target new customer sepanjang semester = target bulanan × 6.
export const targetNewCustomerSemester = (g: Golongan | null): number | null =>
  g ? TARGET_NEW_CUSTOMER_BULANAN[g] * 6 : null;
