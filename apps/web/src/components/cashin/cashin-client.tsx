"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CashinLinesTable } from "./cashin-lines-table";
import { CashinUpload } from "./cashin-upload";
import {
  JENIS_LABEL,
  rupiah,
  type CashinAccount,
  type CashinKelengkapan,
  type CashinRingkasan,
  type CashinStatement,
} from "./cashin-types";

function Angka({ label, nilai, catatan, tegas }: { label: string; nilai: number; catatan?: string; tegas?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={tegas ? "text-2xl font-semibold" : "text-lg"}>{rupiah(nilai)}</div>
      {catatan && <div className="text-muted-foreground text-xs">{catatan}</div>}
    </div>
  );
}

export function CashinClient({
  tanggal,
  ringkasan,
  statement,
  accounts,
  kelengkapan,
}: {
  tanggal: string;
  ringkasan: CashinRingkasan;
  statement: CashinStatement[];
  accounts: CashinAccount[];
  kelengkapan: CashinKelengkapan;
}) {
  const router = useRouter();
  const lengkap = ringkasan.rekening_masuk >= ringkasan.rekening_wajib;

  const kolomStatement: DataColumn<CashinStatement>[] = [
    { id: "label_file", header: "Rekening", sortable: true, accessor: (r) => r.label_file },
    {
      id: "bank",
      header: "Bank",
      cell: (r) => (
        <div>
          <div>{r.nama_bank}</div>
          <div className="text-muted-foreground text-xs">
            {r.no_rekening ?? "nomor belum diisi"} · {JENIS_LABEL[r.jenis] ?? r.jenis}
          </div>
        </div>
      ),
    },
    { id: "baris", header: "Transaksi", align: "right", sortable: true, accessor: (r) => r.jumlah_baris },
    {
      id: "kredit",
      header: "Masuk",
      align: "right",
      sortable: true,
      accessor: (r) => Number(r.total_kredit_tercetak ?? 0),
      cell: (r) => rupiah(r.total_kredit_tercetak),
    },
    {
      id: "debit",
      header: "Keluar",
      align: "right",
      sortable: true,
      accessor: (r) => Number(r.total_debit_tercetak ?? 0),
      cell: (r) => rupiah(r.total_debit_tercetak),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (r) => r.status,
      cell: (r) => (
        <div className="flex flex-col gap-1">
          <Badge variant={r.status === "terverifikasi" ? "default" : "destructive"}>
            {r.status === "terverifikasi" ? "Terverifikasi" : "Perlu review"}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {r.metode === "ocr" ? "dibaca OCR" : "parser teks"} · dari {r.sumber === "wa" ? "WA" : "web"}
          </span>
          {r.parse_error && <span className="text-destructive text-xs">{r.parse_error}</span>}
          {r.saldo_bersambung_ok === false && (
            <span className="text-destructive text-xs">saldo tidak bersambung ke hari berikutnya</span>
          )}
        </div>
      ),
    },
  ];

  const kolomAkun: DataColumn<CashinAccount>[] = [
    { id: "label_file", header: "Label file", sortable: true, accessor: (r) => r.label_file },
    { id: "nama_bank", header: "Bank", sortable: true, accessor: (r) => r.nama_bank },
    {
      id: "no_rekening",
      header: "No. rekening",
      cell: (r) => r.no_rekening ?? <span className="text-destructive text-xs">belum diisi</span>,
    },
    {
      id: "jenis",
      header: "Jenis",
      sortable: true,
      accessor: (r) => r.jenis,
      cell: (r) => (
        <div>
          <Badge variant={r.jenis === "kas" ? "default" : "outline"}>{JENIS_LABEL[r.jenis] ?? r.jenis}</Badge>
          {r.jenis !== "kas" && (
            <div className="text-muted-foreground text-xs">tidak masuk hitungan uang masuk</div>
          )}
        </div>
      ),
    },
    {
      id: "wajib",
      header: "Wajib harian",
      cell: (r) => (r.wajib_harian ? "Ya" : "Tidak"),
    },
    { id: "catatan", header: "Catatan", cell: (r) => <span className="text-xs">{r.catatan ?? "-"}</span> },
  ];

  const tanggalKelengkapan = Object.keys(kelengkapan.isi).sort().reverse();

  return (
    <Tabs defaultValue="harian">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="harian">Harian</TabsTrigger>
          <TabsTrigger value="transaksi">Transaksi</TabsTrigger>
          <TabsTrigger value="rekening">Rekening ({accounts.length})</TabsTrigger>
          <TabsTrigger value="kelengkapan">Kelengkapan</TabsTrigger>
        </TabsList>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Tanggal
          <Input
            type="date"
            value={tanggal}
            className="h-8 w-[10rem]"
            onChange={(e) => router.push(`/uang-masuk?tanggal=${e.target.value}`)}
          />
        </label>
      </div>

      <TabsContent value="harian" className="mt-4">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Angka
                  label="Uang masuk riil"
                  nilai={ringkasan.uang_masuk_riil}
                  tegas
                  catatan="di luar dana puteran WRG, bunga, dan deposito"
                />
                <Angka label="Penerimaan afiliasi grup" nilai={ringkasan.afiliasi_grup} />
                <Angka
                  label="Dana puteran internal"
                  nilai={ringkasan.puteran_internal}
                  catatan="dikecualikan dari uang masuk"
                />
                <Angka
                  label="Belum ditriage"
                  nilai={ringkasan.belum_ditriage}
                  catatan={ringkasan.belum_ditriage > 0 ? "tertahan sampai dikategorikan" : undefined}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Angka label="Bunga" nilai={ringkasan.bunga} />
                <Angka label="Deposito" nilai={ringkasan.deposito} />
                <Angka label="Pengeluaran" nilai={ringkasan.pengeluaran} />
                <Angka
                  label="Rekening pinjaman/escrow"
                  nilai={ringkasan.non_kas_kredit}
                  catatan="mutasi masuk, di luar hitungan"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={lengkap ? "default" : "destructive"}>
                  Koran {ringkasan.rekening_masuk}/{ringkasan.rekening_wajib}
                </Badge>
                {ringkasan.rekening_belum.length > 0 && (
                  <span className="text-destructive">Belum setor: {ringkasan.rekening_belum.join(", ")}</span>
                )}
              </div>
              {ringkasan.statement_perlu_review.map((s, i) => (
                <p key={i} className="text-destructive text-sm">
                  ⚠️ {s.label_file}: {s.alasan}
                </p>
              ))}

              <CashinUpload onSelesai={() => router.refresh()} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <h3 className="mb-2 text-sm font-medium">Penerimaan terbesar</h3>
                {ringkasan.penerimaan_terbesar.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Belum ada penerimaan tercatat.</p>
                ) : (
                  <ol className="flex flex-col gap-1 text-sm">
                    {ringkasan.penerimaan_terbesar.map((t, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="truncate">
                          <span className="text-muted-foreground">{t.label_file}</span> {t.deskripsi}
                        </span>
                        <span className="whitespace-nowrap">{rupiah(t.kredit)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <h3 className="mb-2 text-sm font-medium">Dana puteran hari ini</h3>
                {ringkasan.puteran_detail.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Tidak ada pemindahan antar rekening WRG.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {ringkasan.puteran_detail.map((p, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span>
                          {p.dari} → {p.ke}
                        </span>
                        <span className="whitespace-nowrap">{rupiah(p.nominal)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-3 text-sm font-medium">Rekening koran {tanggal}</h3>
              {statement.length === 0 ? (
                <EmptyState
                  title="Belum ada rekening koran"
                  description="Setor lewat tombol upload di atas, atau kirim ke WhatsApp dengan #KORAN + lampiran."
                />
              ) : (
                <DataTable
                  columns={kolomStatement}
                  data={statement}
                  getKey={(r) => r.id}
                  searchPlaceholder="Cari rekening…"
                  pageSize={25}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="transaksi" className="mt-4">
        <Card>
          <CardContent className="pt-6">
            <CashinLinesTable tanggal={tanggal} accounts={accounts} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="rekening" className="mt-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground mb-3 text-xs">
              Rekening jenis <b>Kas</b> yang dihitung sebagai uang masuk. Rekening PRK/pinjaman dan escrow dilaporkan
              terpisah karena mutasinya bukan penerimaan usaha.
            </p>
            <DataTable
              columns={kolomAkun}
              data={accounts}
              getKey={(r) => r.id}
              searchPlaceholder="Cari rekening…"
              pageSize={25}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="kelengkapan" className="mt-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground mb-3 text-xs">
              {kelengkapan.dari} s/d {kelengkapan.sampai}. Sel kosong = koran belum disetor hari itu.
            </p>
            {tanggalKelengkapan.length === 0 ? (
              <EmptyState title="Belum ada data" description="Belum ada rekening koran pada rentang ini." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2 text-left">Tanggal</th>
                      {kelengkapan.rekening.map((r) => (
                        <th key={r} className="p-2 text-left whitespace-nowrap">
                          {r}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tanggalKelengkapan.map((t) => (
                      <tr key={t} className="border-b">
                        <td className="p-2 whitespace-nowrap">{t}</td>
                        {kelengkapan.rekening.map((r) => {
                          const st = kelengkapan.isi[t]?.[r];
                          return (
                            <td key={r} className="p-2">
                              {st === "terverifikasi" ? "✅" : st ? "⚠️" : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
