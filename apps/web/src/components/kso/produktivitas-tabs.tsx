"use client";

// Dua muka Produktivitas KSO sebagai TAB, bukan dua menu (keputusan user 2026-08-18).
//
// Aman dijadikan tab justru karena keduanya sudah memakai kunci izin yang SAMA
// ('kso-simulator'). Alasan biasa untuk memisah menu — "sebuah tab tidak bisa dicentang
// sendiri di matriks Akses Grup", seperti pada /pricebook — tidak berlaku di sini:
// tidak ada izin yang hilang saat digabung, karena tidak pernah ada dua izin.
//
// FILTER DIANGKAT KE SINI, bukan dipanggil di tiap view. Dulu tiap halaman memanggil
// useFilterKso sendiri, jadi memilih "Kota: KAB. JEMBER" di tabel lalu pindah ke
// ringkasan mengembalikan tampilan ke "semua kota" tanpa peringatan apa pun. Sekarang
// satu keadaan dipakai berdua: berpindah tab mempertahankan penyaringan, dan angka di
// dua tab dijamin berasal dari irisan yang sama.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, Table2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBarKso, useFilterKso, type KsoProduktivitas } from "./produktivitas-shared";
import { KsoProduktivitasTabel } from "./produktivitas-view";
import { KsoRingkasanPanel } from "./ringkasan-view";

const TAB_RINGKASAN = "ringkasan";
const TAB_TABEL = "tabel";

export function KsoProduktivitasTabs({ data }: { data: KsoProduktivitas }) {
  const f = useFilterKso(data);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Tab disimpan di URL (?tab=), BUKAN di useState. Dua alasan yang dua-duanya nyata:
  // halaman ini sering dikirim lewat WA sebagai tautan, dan sebelum jadi tab ringkasan
  // punya URL sendiri (/kso-produktivitas/ringkasan) yang sudah pernah live — tautan
  // lama diarahkan ke sini dengan ?tab=ringkasan, jadi bookmark tidak mati.
  const tab = params.get("tab") === TAB_RINGKASAN ? TAB_RINGKASAN : TAB_TABEL;

  const pindah = useCallback((v: string) => {
    const q = new URLSearchParams(params.toString());
    if (v === TAB_TABEL) q.delete("tab"); else q.set("tab", v);
    const s = q.toString();
    // replace, bukan push: berpindah tab bukan navigasi yang layak menumpuk di riwayat —
    // tombol Back semestinya membawa keluar dari halaman ini, bukan menelusuri tab.
    // scroll:false supaya posisi baca tidak melompat ke atas saat berganti tab.
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  return (
    <Tabs value={tab} onValueChange={(v) => pindah(String(v))}>
      {/* Tab strip di kartunya SENDIRI, terpisah dari filter (permintaan user
          2026-08-19). Sempat digabung jadi satu kartu; dipisah lagi karena keduanya
          menjawab pertanyaan berbeda — tab memilih MUKA, filter memilih IRISAN — dan
          menempelkannya membuat tab terbaca seperti bagian dari baris filter. */}
      <Card className="py-0">
        <CardContent className="px-3 py-2.5">
          <TabsList>
            <TabsTrigger value={TAB_TABEL} className="gap-1.5">
              <Table2 className="size-4" /> Tabel per faskes
            </TabsTrigger>
            <TabsTrigger value={TAB_RINGKASAN} className="gap-1.5">
              <BarChart3 className="size-4" /> Ringkasan
            </TabsTrigger>
          </TabsList>
        </CardContent>
      </Card>

      {/* Filter sengaja di LUAR panel tab: satu baris kendali yang berlaku bagi
          dua-duanya. Menaruhnya di dalam tiap panel membuatnya terlihat seperti dua
          filter berbeda padahal keadaannya satu. */}
      <div className="mt-3">
        <FilterBarKso f={f} />
      </div>

      <TabsContent value={TAB_TABEL} className="mt-4">
        <KsoProduktivitasTabel f={f} />
      </TabsContent>
      <TabsContent value={TAB_RINGKASAN} className="mt-4">
        <KsoRingkasanPanel f={f} data={data} />
      </TabsContent>
    </Tabs>
  );
}
