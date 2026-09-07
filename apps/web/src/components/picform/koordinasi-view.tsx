"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

// Jaringan koordinasi antar posisi — Tabel C form PIC (126 pernyataan).
//
// SEMUA baris dikirim penuh dari server (64 edge posisi, 25 pasangan divisi,
// 30 node), jadi DataTable dipakai di mode KLIEN dengan sengaja: pencarian &
// sort di sini menyaring seluruh data, bukan sepotong halaman. Mode server
// justru berlebihan untuk ukuran ini — dan yang berbahaya adalah kebalikannya,
// yaitu memotong di backend lalu menghitung di klien.

export interface KoordNode {
  id: string; label: string; grup: string; keluar: number; masuk: number; derajat: number;
}
export interface KoordEdge { from: string; to: string; bobot: number; topik: string[] }
export interface KoordEdgeDivisi {
  from: string; to: string; bobot: number; bolak_balik: boolean; sepihak: boolean;
}
export interface KoordGraf {
  ringkas: {
    node: number; edge: number; baris: number;
    internal: number; external: number; tak_terklasifikasi: number;
    pasangan_divisi: number; pasangan_bolak_balik: number; pasangan_sepihak: number;
  };
  nodes: KoordNode[];
  edges: KoordEdge[];
  edges_divisi: KoordEdgeDivisi[];
}

const GRUP_GAYA: Record<string, string> = {
  posisi: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  internal: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  external: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "tak-terklasifikasi": "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
};
const chip = (g: string) =>
  `inline-block rounded px-1.5 py-0.5 text-xs font-medium ${GRUP_GAYA[g] ?? "bg-muted text-muted-foreground"}`;

export function KoordinasiView({ graf }: { graf: KoordGraf | null }) {
  if (!graf || graf.ringkas.baris === 0) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-muted-foreground">
          Data koordinasi tidak tersedia. Pastikan <code>apps/api</code> jalan dan data form PIC
          sudah diimpor (<code>scripts/ops/pic-form-import.mjs --apply</code>).
        </p>
      </CardContent></Card>
    );
  }
  const r = graf.ringkas;

  const kolomNode: DataColumn<KoordNode>[] = [
    { id: "id", header: "Node", accessor: (n) => n.id },
    {
      id: "grup", header: "Jenis", accessor: (n) => n.grup,
      cell: (n) => <span className={chip(n.grup)}>{n.grup}</span>,
    },
    { id: "keluar", header: "Menyatakan", align: "right", accessor: (n) => n.keluar, searchable: false },
    { id: "masuk", header: "Disebut", align: "right", accessor: (n) => n.masuk, searchable: false },
    { id: "derajat", header: "Total", align: "right", accessor: (n) => n.derajat, searchable: false },
  ];

  const kolomEdge: DataColumn<KoordEdge>[] = [
    { id: "from", header: "Posisi", accessor: (e) => e.from },
    { id: "to", header: "Berkoordinasi dengan", accessor: (e) => e.to },
    { id: "bobot", header: "Baris", align: "right", accessor: (e) => e.bobot, searchable: false },
    {
      id: "topik", header: "Yang dikoordinasikan", accessor: (e) => e.topik.join(" · "),
      cell: (e) => (
        <ul className="list-inside list-disc space-y-0.5">
          {e.topik.map((t, i) => <li key={i} className="text-xs">{t}</li>)}
        </ul>
      ),
      className: "min-w-[22rem]",
    },
  ];

  const kolomDivisi: DataColumn<KoordEdgeDivisi>[] = [
    { id: "from", header: "Divisi", accessor: (e) => e.from },
    { id: "to", header: "→ Pihak", accessor: (e) => e.to },
    { id: "bobot", header: "Baris", align: "right", accessor: (e) => e.bobot, searchable: false },
    {
      id: "status", header: "Pengakuan", accessor: (e) => (e.bolak_balik ? "bolak-balik" : e.sepihak ? "sepihak" : "eksternal"),
      cell: (e) =>
        e.bolak_balik ? <Badge variant="secondary">bolak-balik</Badge>
          : e.sepihak ? <Badge variant="outline">sepihak</Badge>
            : <span className="text-xs text-muted-foreground">pihak luar</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{r.baris} pernyataan koordinasi</Badge>
            <Badge variant="outline">{r.node} node</Badge>
            <Badge variant="outline">{r.edge} pasangan posisi→pihak</Badge>
            <Badge variant="secondary">{r.internal} divisi internal</Badge>
            <Badge variant="secondary">{r.external} pihak eksternal</Badge>
            {r.tak_terklasifikasi > 0 && (
              <Badge variant="destructive">{r.tak_terklasifikasi} tak terklasifikasi</Badge>
            )}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Ini jaringan <strong>deklaratif</strong>: isi kolom &ldquo;Koordinasi dengan&rdquo; yang
            ditulis tiap PIC untuk posisi di divisinya — bukan hasil pengamatan percakapan.
            Karena tiap PIC hanya mengisi untuk sisinya sendiri, sebuah pasangan bisa diakui satu
            pihak saja.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Antar divisi — {r.pasangan_divisi} pasangan · {r.pasangan_bolak_balik} bolak-balik ·{" "}
            {r.pasangan_sepihak} sepihak
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Asal diangkat dari posisi ke divisinya supaya kedua ujungnya bersatuan sama; koordinasi
            di dalam satu divisi tidak dihitung di sini. <strong>Sepihak</strong> = divisi ini
            mencatat koordinasi ke divisi lawan, tapi divisi lawan tidak mencatat baliknya — layak
            dikonfirmasi, karena biasanya artinya salah satu form belum lengkap. Pihak luar
            (Customer/User, Vendor/Principal, Leadership) tidak pernah ditandai sepihak: mereka
            tak punya form untuk mengakui balik.
          </p>
          <DataTable
            columns={kolomDivisi}
            data={graf.edges_divisi}
            getKey={(e) => `${e.from}→${e.to}`}
            pageSize={25}
            searchPlaceholder="Cari divisi…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Node tersentral</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            <strong>Menyatakan</strong> = berapa kali node ini menyebut pihak lain (hanya posisi
            yang bisa, sebab hanya posisi yang punya baris di form). <strong>Disebut</strong> =
            berapa kali ia disebut pihak lain.
          </p>
          <DataTable
            columns={kolomNode}
            data={graf.nodes}
            getKey={(n) => n.id}
            pageSize={25}
            initialSort={{ id: "derajat", dir: "desc" }}
            searchPlaceholder="Cari node…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Rincian per posisi</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={kolomEdge}
            data={graf.edges}
            getKey={(e) => `${e.from}→${e.to}`}
            pageSize={25}
            initialSort={{ id: "bobot", dir: "desc" }}
            searchPlaceholder="Cari posisi / pihak…"
          />
        </CardContent>
      </Card>
    </div>
  );
}
