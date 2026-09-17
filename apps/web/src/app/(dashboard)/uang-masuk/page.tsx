import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { CashinClient } from "@/components/cashin/cashin-client";
import type {
  CashinAccount,
  CashinKelengkapan,
  CashinRingkasan,
  CashinStatement,
} from "@/components/cashin/cashin-types";

export const dynamic = "force-dynamic";

const RINGKASAN_KOSONG: CashinRingkasan = {
  tanggal: "",
  uang_masuk_riil: 0,
  afiliasi_grup: 0,
  puteran_internal: 0,
  bunga: 0,
  deposito: 0,
  refund: 0,
  belum_ditriage: 0,
  pengeluaran: 0,
  non_kas_kredit: 0,
  non_kas_debit: 0,
  rekening_wajib: 0,
  rekening_masuk: 0,
  rekening_belum: [],
  statement_perlu_review: [],
  penerimaan_terbesar: [],
  puteran_detail: [],
};

// Tanggal WIB, bukan tanggal server. Tanpa offset, halaman yang dibuka sebelum
// jam 07:00 WIB akan menampilkan HARI SEBELUMNYA.
//
// Ditaruh di fungsi tingkat modul (pola sama courier-performance/page.tsx):
// aturan lint react-hooks/purity melarang Date.now() di dalam komponen.
function hariIniWib(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function ambil<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export default async function UangMasukPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const sp = await searchParams;
  const hariIni = hariIniWib();
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal ?? "") ? sp.tanggal! : hariIni;

  const [harian, akun, kelengkapan] = await Promise.all([
    ambil<{ ringkasan: CashinRingkasan; statement: CashinStatement[] }>(`/cashin/harian?tanggal=${tanggal}`, {
      ringkasan: { ...RINGKASAN_KOSONG, tanggal },
      statement: [],
    }),
    ambil<{ accounts: CashinAccount[] }>("/cashin/accounts", { accounts: [] }),
    ambil<CashinKelengkapan>(`/cashin/kelengkapan?sampai=${tanggal}`, {
      dari: tanggal,
      sampai: tanggal,
      rekening: [],
      isi: {},
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Uang Masuk"
        description="Rekap penerimaan harian dari rekening koran. Dana puteran antar rekening WRG dipisahkan otomatis lewat pencocokan pasangan debit–kredit, jadi angka 'uang masuk riil' tidak ikut menghitung dana yang cuma berpindah tempat. Setor koran lewat tombol upload atau WhatsApp #KORAN + lampiran."
      />
      <CashinClient
        tanggal={tanggal}
        ringkasan={harian.ringkasan ?? { ...RINGKASAN_KOSONG, tanggal }}
        statement={harian.statement ?? []}
        accounts={akun.accounts ?? []}
        kelengkapan={kelengkapan}
      />
    </>
  );
}
