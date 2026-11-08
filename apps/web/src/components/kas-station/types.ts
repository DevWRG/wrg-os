// Bentuk data F33 — selaras apps/api/src/repo/kas-station.ts (HarianRow / RekapDetail).

export type StatusRekap = "draft" | "submitted" | "approved" | "rejected";
export type JenisTransaksi = "masuk" | "keluar";

export interface Transaksi {
  id: string; harian_id: string; jenis: JenisTransaksi; nominal: number; uraian: string;
  bukti_ref: string | null; created_by: string | null; created_at: string;
}

export interface Harian {
  id: string; cabang: string; tanggal: string; saldo_awal: number; total_masuk: number; total_keluar: number;
  saldo_akhir: number; saldo_fisik: number | null; selisih: number | null; keterangan: string | null;
  jumlah_transaksi: number; created_by: string | null; terkunci: boolean; bisa_diubah: boolean;
}
export interface HarianDetail extends Harian { transaksi: Transaksi[] }

export interface Rekap {
  id: string; cabang: string; periode_awal: string; periode_akhir: string; status: StatusRekap;
  jumlah_hari: number; saldo_awal: number; total_masuk: number; total_keluar: number; saldo_akhir: number;
  total_selisih: number; jumlah_hari_selisih: number; submit_count: number;
  submitted_by: string | null; submitted_at: string | null; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; realisasi_nominal: number | null; realisasi_by: string | null; realisasi_at: string | null;
}
export interface RekapDetail extends Rekap { harian: HarianDetail[]; hari_tanpa_catatan: string[] }

/** Izin user yang sudah dihitung di server (lib/kas-station-access.ts). */
export interface IzinKasStation {
  stationView: boolean; stationCreate: boolean; stationEdit: boolean; stationDelete: boolean;
  reviewView: boolean; reviewEdit: boolean;
}

/** Selaras RingkasanStation di API (GET /kas-station/ringkasan). */
export interface RingkasanStation {
  cabang: string; tanggal_terakhir: string | null; saldo_akhir: number | null; selisih: number | null;
  hari_7: number; rekap_menunggu: number; rekap_belum_realisasi: number; rekap_ditolak: number;
}

export const STATUS_LABEL: Record<StatusRekap, string> = {
  draft: "Draft", submitted: "Menunggu review pusat", approved: "Disetujui", rejected: "Ditolak",
};

export const rp = (n: number): string => `Rp ${n.toLocaleString("id-ID")}`;

/** Selisih bertanda: "+Rp 5.000" / "−Rp 5.000" / "Cocok". */
export const rpSelisih = (n: number): string => (n === 0 ? "Cocok" : `${n > 0 ? "+" : "−"}${rp(Math.abs(n))}`);

export const NAMA_HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

/** Jumlah hari dari `dari` ke `ke` (YYYY-MM-DD). */
export const selisihHari = (dari: string, ke: string): number =>
  Math.round((Date.parse(`${ke}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000);

export const tglPendek = (t: string): string =>
  new Date(`${t.slice(0, 10)}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2–8 Nov 2026" untuk satu minggu Senin–Minggu. */
export const labelMinggu = (senin: string): string => {
  const akhir = tambahHari(senin, 6);
  const a = new Date(`${senin}T00:00:00Z`); const b = new Date(`${akhir}T00:00:00Z`);
  const bln = (d: Date) => d.toLocaleDateString("id-ID", { month: "short", timeZone: "UTC" });
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${bln(b)} ${b.getUTCFullYear()}`
    : `${a.getUTCDate()} ${bln(a)} – ${b.getUTCDate()} ${bln(b)} ${b.getUTCFullYear()}`;
};

/** Tanggal WIB hari ini (YYYY-MM-DD), sama dengan wibHariIni di API. */
export const hariIniWib = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export function tambahHari(tanggal: string, n: number): string {
  return new Date(new Date(`${tanggal}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Senin dari minggu yang memuat `tanggal`. */
export function awalMinggu(tanggal: string): string {
  const dow = new Date(`${tanggal}T00:00:00Z`).getUTCDay();
  return tambahHari(tanggal, -((dow + 6) % 7));
}

export const tgl = (t: string | null): string =>
  t ? new Date(`${t.slice(0, 10)}T00:00:00Z`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/**
 * Daftar tanggal → teks ringkas; hari berurutan digabung jadi rentang, tahun ditulis sekali bila sama.
 * 2..7 Nov → "2–7 Nov 2026"; 2 & 4 Nov → "2 Nov, 4 Nov 2026"; 30 Nov..2 Des → "30 Nov – 2 Des 2026".
 */
export function rentangTanggal(daftar: string[]): string {
  const urut = [...new Set(daftar.map((t) => t.slice(0, 10)))].sort();
  if (urut.length === 0) return "";
  const grup: [string, string][] = [];
  for (const t of urut) {
    const akhir = grup[grup.length - 1];
    if (akhir && tambahHari(akhir[1], 1) === t) akhir[1] = t;
    else grup.push([t, t]);
  }
  const satuTahun = urut[0].slice(0, 4) === urut[urut.length - 1].slice(0, 4);
  const bulan = (t: string) => new Date(`${t}T00:00:00Z`).toLocaleDateString("id-ID", { month: "short", timeZone: "UTC" });
  const hari = (t: string) => String(Number(t.slice(8, 10)));
  const thn = (t: string) => (satuTahun ? "" : ` ${t.slice(0, 4)}`);
  const teks = grup.map(([a, b]) => {
    if (a === b) return `${hari(a)} ${bulan(a)}${thn(a)}`;
    if (a.slice(0, 7) === b.slice(0, 7)) return `${hari(a)}–${hari(b)} ${bulan(b)}${thn(b)}`;
    return `${hari(a)} ${bulan(a)}${thn(a)} – ${hari(b)} ${bulan(b)}${thn(b)}`;
  });
  return teks.join(", ") + (satuTahun ? ` ${urut[0].slice(0, 4)}` : "");
}

// timestamptz::text dari Postgres = "2026-10-18 02:00:00.123+07" → ISO-8601 yang dikenal Date.
export const waktu = (t: string | null): string => {
  if (!t) return "—";
  const d = new Date(t.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
};

export const selCls = "w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm";

/** Panggil BFF /api/kas-station/*; lempar Error berisi pesan dari API bila gagal. */
export async function kasApi<T>(path: string, init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/kas-station/${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error("Tidak bisa menghubungi server — periksa koneksi lalu coba lagi.");
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    if (res.status === 503 && data?.error === "migration_pending") throw new Error("Fitur belum siap: migrasi database belum diterapkan.");
    if (res.status === 401) throw new Error("Sesi berakhir — masuk lagi.");
    if (res.status === 403) throw new Error("Anda tidak punya izin untuk aksi ini.");
    throw new Error(data?.error ?? `Gagal (HTTP ${res.status})`);
  }
  return data as T;
}
