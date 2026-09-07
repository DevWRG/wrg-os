"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

// Jembatan orang → posisi → proses. TAMBAHAN di bawah matriks RACI F120, bukan
// penggantinya.
//
// Dua pertanyaan berbeda atas dua sumber berbeda:
//   F120 (raci_assignment, grain karyawan, turunan transkrip wawancara)
//        → "orang ini terlibat di proses apa saja, sebagai R/A/C/I"
//   bagian ini (posisi_employee + posisi_tugas, grain posisi, dari form PIC)
//        → "orang ini memegang posisi apa, dan posisi itu bertanggung jawab
//           atas berapa proses"
// Keduanya bisa berbeda untuk orang yang sama, dan itu bukan kontradiksi —
// sumbernya beda, waktunya beda, dan penulisnya beda.

export interface RantaiRow {
  employee_id: string; karyawan: string; panggilan: string | null; dept: string | null;
  cabang: string | null; role_roster: string | null;
  posisi_id: number; posisi: string; jumlah_orang: number | null;
  divisi_key: string; divisi: string; sumber: string; dasar_tautan: string | null;
  proses: number;
}
export interface GapRow {
  employee_id: string; karyawan: string; panggilan: string | null;
  dept: string | null; role_roster: string | null; alasan: string; kandidat: string | null;
}
export interface RaciKaryawan {
  ringkas: { karyawan_total: number; tertaut: number; belum: number; baris_tautan: number };
  rantai: RantaiRow[];
  gap: GapRow[];
}

const SUMBER_LABEL: Record<string, string> = {
  nama_di_catatan: "nama di form",
  nama_posisi_di_role: "nama posisi di role",
  alias_jabatan: "alias jabatan",
  manual: "diputuskan orang",
};

export function RaciPosisiBridge({ data }: { data: RaciKaryawan | null }) {
  if (!data) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-muted-foreground">
          Data jembatan posisi tidak tersedia. Pastikan <code>apps/api</code> jalan dan{" "}
          <code>scripts/ops/posisi-employee-match.mjs --apply</code> sudah dijalankan.
        </p>
      </CardContent></Card>
    );
  }
  const r = data.ringkas;
  const pct = r.karyawan_total > 0 ? Math.round((r.tertaut / r.karyawan_total) * 1000) / 10 : null;

  const kolomRantai: DataColumn<RantaiRow>[] = [
    { id: "karyawan", header: "Karyawan", accessor: (x) => x.karyawan },
    { id: "dept", header: "Dept", accessor: (x) => x.dept ?? "" },
    { id: "divisi", header: "Divisi (form)", accessor: (x) => x.divisi },
    { id: "posisi", header: "Posisi", accessor: (x) => x.posisi },
    {
      id: "proses", header: "Proses", align: "right",
      accessor: (x) => x.proses,
      cell: (x) => <span className="tabular-nums">{x.proses}</span>,
    },
    {
      id: "sumber", header: "Dasar tautan", accessor: (x) => x.sumber,
      cell: (x) => (
        <span title={x.dasar_tautan ?? undefined} className="text-xs">
          {SUMBER_LABEL[x.sumber] ?? x.sumber}
        </span>
      ),
    },
    { id: "role", header: "Role di roster", accessor: (x) => x.role_roster ?? "", className: "min-w-[16rem]" },
  ];

  const kolomGap: DataColumn<GapRow>[] = [
    { id: "karyawan", header: "Karyawan", accessor: (x) => x.karyawan },
    { id: "dept", header: "Dept", accessor: (x) => x.dept ?? "" },
    { id: "role", header: "Role di roster", accessor: (x) => x.role_roster ?? "", className: "min-w-[16rem]" },
    {
      id: "alasan", header: "Kenapa belum dipetakan", accessor: (x) => x.alasan,
      cell: (x) => <span className="text-xs">{x.alasan}</span>,
      className: "min-w-[20rem]",
    },
    {
      id: "kandidat", header: "Posisi yang mungkin", accessor: (x) => x.kandidat ?? "",
      cell: (x) =>
        x.kandidat
          ? <span className="text-xs text-muted-foreground">{x.kandidat}</span>
          : <span className="text-xs text-muted-foreground">—</span>,
      className: "min-w-[18rem]",
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Posisi &amp; proses per karyawan (form PIC)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{r.tertaut} dari {r.karyawan_total} karyawan tertaut</Badge>
            {pct != null && <Badge variant="outline">{pct}%</Badge>}
            <Badge variant="outline">{r.baris_tautan} baris tautan</Badge>
            {r.belum > 0 && <Badge variant="destructive">{r.belum} belum dipetakan</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Matriks di atas menjawab &ldquo;orang ini terlibat di proses apa&rdquo; menurut
            transkrip wawancara. Tabel ini menjawab pertanyaan lain: &ldquo;orang ini memegang
            posisi apa menurut form PIC, dan posisi itu memikul berapa proses&rdquo;. Sumber, waktu,
            dan penulisnya berbeda — kalau keduanya tidak sama untuk orang yang sama, itu bukan
            kontradiksi, itu bahan konfirmasi.
          </p>
          <p className="text-sm text-muted-foreground">
            Baris bisa lebih banyak dari jumlah orang: seseorang boleh memegang lebih dari satu
            posisi (&ldquo;merangkap&rdquo;) — kolom <em>Proses</em> dihitung per posisi, jadi jangan
            dijumlahkan begitu saja untuk mendapat beban satu orang.
          </p>
          <DataTable
            columns={kolomRantai}
            data={data.rantai}
            getKey={(x) => `${x.employee_id}|${x.posisi_id}`}
            pageSize={25}
            initialSort={{ id: "proses", dir: "desc" }}
            searchPlaceholder="Cari karyawan / posisi…"
          />
        </CardContent>
      </Card>

      {r.belum > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Belum dipetakan — {r.belum} karyawan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Mereka <strong>tidak</strong> berarti tanpa tanggung jawab — hanya belum bisa
              dipasangkan ke posisi secara otomatis, dan alasannya ditulis apa adanya di bawah.
              Sebagian besar karena form menyebut kapasitas lebih kecil dari jumlah orang yang
              cocok (mis. <em>Kirim Tagih</em> diisi 1 orang padahal 12 orang rolenya memuatnya),
              atau karena dua orang punya role yang identik untuk dua posisi berbeda. Keduanya
              butuh keputusan HoD/PIC, bukan tebakan sistem.
            </p>
            <DataTable
              columns={kolomGap}
              data={data.gap}
              getKey={(x) => x.employee_id}
              pageSize={25}
              searchPlaceholder="Cari karyawan / alasan…"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
