import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { SpiderNetworkView } from "@/components/picform/spider-network-view";
import type { KoordGraf, PohonPekerjaan } from "@/components/picform/spider/types";

export const dynamic = "force-dynamic";

// Spider Network — dua graf D3 atas data form PIC Divisi (migrasi 168):
// pohon pekerjaan (Tabel A + B) dan jaringan koordinasi (Tabel C), plus tabel
// lama sebagai tab ketiga.
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
// mau ditampilkan lagi, tambahkan sebagai tab keempat, jangan tukar balik: graf
// itu menjawab pertanyaan yang berbeda dari kedua graf di halaman ini.
//
// Dua muatan diambil paralel dan masing-masing boleh gagal sendiri: tab yang
// datanya tak datang menampilkan keadaan kosongnya, sementara tab lain tetap
// terpakai. Satu Promise.all yang melempar akan mematikan seluruh halaman
// gara-gara satu endpoint.
async function ambil<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function NetworkPage() {
  const [graf, pohon] = await Promise.all([
    ambil<KoordGraf>("/picform/koordinasi"),
    ambil<PohonPekerjaan>("/picform/pohon"),
  ]);

  return (
    <>
      <PageHeader
        title="Spider Network"
        description="Pohon pekerjaan per posisi & jaringan koordinasi antar divisi — dari form PIC Divisi (deklaratif, bukan hasil pengamatan chat). (F157)"
      />
      <SpiderNetworkView graf={graf} pohon={pohon} />
    </>
  );
}
