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

export const STATUS_LABEL: Record<StatusRekap, string> = {
  draft: "Draft", submitted: "Menunggu review pusat", approved: "Disetujui", rejected: "Ditolak",
};

export const rp = (n: number): string => `Rp ${n.toLocaleString("id-ID")}`;

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

// timestamptz::text dari Postgres = "2026-10-18 02:00:00.123+07" → ISO-8601 yang dikenal Date.
export const waktu = (t: string | null): string => {
  if (!t) return "—";
  const d = new Date(t.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
};

export const selCls = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

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
