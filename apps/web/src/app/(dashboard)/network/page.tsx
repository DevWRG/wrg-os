import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { KoordinasiView, type KoordGraf } from "@/components/picform/koordinasi-view";

export const dynamic = "force-dynamic";

// Spider Network — jaringan koordinasi antar posisi dari Tabel C form PIC
// (posisi_koordinasi, migrasi 168).
//
// SUMBER HALAMAN INI BERPINDAH 2026-09-07, dan alasannya perlu bertahan:
// sebelumnya ia merender /network/graph — graf co-occurrence ENTITY dari anotasi
// A8 (node = entity + nama pengirim, edge = "muncul bersama dalam satu pesan").
// Dua masalah sekaligus:
//   1. `message_annotation` KOSONG di prod (0 baris), jadi halaman ini selama
//      ini hanya menampilkan "Graf kosong. Jalankan A8 (anotasi) lalu A9.";
//   2. graf entity itu bukan jaringan koordinasi organisasi, padahal itu yang
//      dicari orang saat membuka menu bernama "Spider Network".
//
// Endpoint /network/graph dan apps/api/src/repo/network.ts SENGAJA TIDAK
// DIHAPUS — A9 bisa dihidupkan kapan saja tanpa dibangun ulang. Yang berubah
// hanya apa yang dirender di sini. Kalau A8/A9 nanti jalan dan graf entity-nya
// mau ditampilkan lagi, tambahkan sebagai tab kedua, jangan tukar balik: dua
// graf ini menjawab pertanyaan yang berbeda.
async function getKoordinasi(): Promise<KoordGraf | null> {
  try {
    const res = await gatewayFetch("/picform/koordinasi");
    return res.ok ? ((await res.json()) as KoordGraf) : null;
  } catch {
    return null;
  }
}

export default async function NetworkPage() {
  const graf = await getKoordinasi();

  return (
    <>
      <PageHeader
        title="Spider Network"
        description="Jaringan koordinasi antar posisi & pihak eksternal — dari Tabel C form PIC Divisi (deklaratif, bukan hasil pengamatan chat). (F157)"
      />
      <KoordinasiView graf={graf} />
    </>
  );
}
