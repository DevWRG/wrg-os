import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { SpiderNetworkView } from "@/components/picform/spider-network-view";
import type { KoordGraf, PohonPekerjaan } from "@/components/picform/spider/types";
import {
  SopOtomasiView,
  type Summary,
  type KelengkapanRow,
} from "@/components/picform/sop-otomasi-view";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await gatewayFetch(path);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

// Muka data 6 form PIC Divisi (migrasi 168/170/171) — SOP & tingkat otomasi,
// RACI grain posisi, dan kelengkapan pengisian form.
//
// Yang diambil di server hanya yang KECIL & selalu dipakai: ringkasan (agregat
// atas 436 langkah), daftar divisi, dan kelengkapan (6 baris). Tabel langkah
// (436) & RACI (283) diambil client-side per halaman lewat /api/picform/*, jadi
// payload halaman tak menanggung keduanya untuk orang yang cuma melihat kartu.
//
// K14 (evaluasi menu 19 Nov 2026): Spider Network dilebur jadi tab "Peta Koordinasi" —
// keduanya membaca data form PIC (repo/picform). Izin tetap dua key: tab SOP =
// `sop-otomasi` (induk), tab Peta Koordinasi = `network` (entri features; /network →
// ?tab=koordinasi; /api/picform koordinasi/pohon tetap hanya /network). Endpoint
// /network/graph (graf entitas A9) SENGAJA dipertahankan: kalau A9 dihidupkan, graf itu
// jadi tab baru di Peta Koordinasi, bukan pengganti kedua graf yang ada.
const HEADER = (
  <PageHeader
    title="SOP & Peta Koordinasi"
    description="Hasil bedah SOP 6 divisi dari form PIC (tingkat otomasi, RACI per posisi, kelengkapan form) serta pohon pekerjaan & jaringan koordinasi antar divisi — deklaratif dari form, bukan hasil pengamatan chat."
  />
);

export default async function SopOtomasiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/sop-otomasi");
  const fKoord = induk?.features?.find((f) => f.key === "network");
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "sop", label: "SOP & Otomasi" });
  if (fKoord && tabVisible(me, fKoord)) tabs.push({ key: "koordinasi", label: "Peta Koordinasi" });
  const aktif = pilihTab(tabs, tab) ?? "sop";
  const daftar = tabs.length ? tabs : [{ key: "sop", label: "SOP & Otomasi" }];

  if (aktif === "koordinasi") {
    // Dua muatan diambil paralel dan masing-masing boleh gagal sendiri (lihat
    // catatan lama Spider Network): graf yang datanya tak datang tampil kosong.
    const [graf, pohon] = await Promise.all([
      get<KoordGraf>("/picform/koordinasi"),
      get<PohonPekerjaan>("/picform/pohon"),
    ]);
    return <>{HEADER}<PageTabs tabs={daftar} aktif={aktif} /><SpiderNetworkView graf={graf} pohon={pohon} /></>;
  }

  const [summary, divisi, kelengkapan] = await Promise.all([
    get<Summary>("/picform/summary"),
    get<{ divisi: { key: string; label: string }[] }>("/picform/divisi"),
    get<{ rows: KelengkapanRow[] }>("/picform/kelengkapan"),
  ]);

  return (
    <>
      {HEADER}
      <PageTabs tabs={daftar} aktif={aktif} />
      <SopOtomasiView
        summary={summary}
        divisiOpts={(divisi?.divisi ?? []).map((d) => ({ value: d.key, label: d.label }))}
        kelengkapan={kelengkapan?.rows ?? []}
      />
    </>
  );
}
