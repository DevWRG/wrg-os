"use client";

import { useEffect, useState } from "react";

import { StockBatchTable, type StockBatchRow } from "@/components/tables/stock-batch-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export interface StockBatchSummary {
  hari_ini: string;
  batch_total: number;
  batch_tanpa_ed: number;
  qty_total: number;
  tier: { tier: number; batch: number; qty: number }[];
  sudah_lewat: { batch: number; qty: number };
  per_gudang: { kode: string; nama: string; batch: number; qty: number; terdekat: string | null }[];
  terakhir_update: string | null;
}

const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const tglJam = (iso: string | null) =>
  iso == null
    ? "belum pernah"
    : new Date(iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });

const LIMIT = 20000;

type Filter = "semua" | "lewat" | "t30" | "t60" | "t90" | "tanpa_ed";

const QS: Record<Filter, string> = {
  semua: "",
  lewat: "&lewat=1",
  t30: "&tier=30",
  t60: "&tier=60",
  t90: "&tier=90",
  tanpa_ed: "&tanpa_ed=1",
};

interface Data {
  rows: StockBatchRow[];
  total_rows: number;
  summary: StockBatchSummary | null;
}

// F38 — panel "ED & Kedaluwarsa". Data diambil saat tab dibuka dan difilter di
// SERVER lewat query param, supaya tak perlu mengirim seluruh batch hanya untuk
// memfilter di klien.
//
// BEDA dari tab "Per Gudang": state tab itu hidup di InventoryTabs (induk, tak
// pernah unmount) sehingga datanya selamat saat pindah tab. Panel ini di-render
// lewat ternary, jadi ikut UNMOUNT tiap pindah tab → filter kembali ke "semua"
// dan datanya di-fetch ulang saat kembali.
//
// Itu trade-off yang disengaja, bukan kelalaian: satu-satunya cara menahan state
// adalah tetap me-render panel ini (tersembunyi) sejak halaman dimuat — dan itu
// mengembalikan persoalan payload yang justru dihindari, karena datanya ikut
// diambil walau tabnya tak pernah dibuka.
export function EdWatchPanel() {
  const [filter, setFilter] = useState<Filter>("semua");
  // Hasil & error dibawa BERSAMA filter-nya, dan seluruh setState terjadi SETELAH
  // await — tidak ada satu pun setState sinkron di body effect maupun saat render.
  // Versi awal memanggil fetch langsung di body komponen (`if (!dimuat) muat()`),
  // itu setState-saat-render dan bikin render berulang tanpa henti.
  //
  // Keadaan "sedang memuat" DITURUNKAN (hasil/error belum untuk filter ini),
  // bukan disimpan sebagai state tersendiri — jadi tak perlu me-reset apa pun
  // saat filter berganti.
  // SATU state untuk hasil MAUPUN error, bukan dua. Versi sebelumnya memisahkan
  // keduanya dan tidak pernah membersihkan `error`, sementara render memeriksa
  // error LEBIH DULU — jadi begitu sebuah filter pernah gagal, panel macet di
  // layar "Gagal memuat" SELAMANYA: retry yang berhasil mengisi hasil tapi error
  // lama tetap menang, dan tombol "Coba lagi" jadi tak berfungsi. Dengan satu
  // state, penulisan terakhir selalu menang — macet seperti itu tak bisa terjadi.
  const [hasil, setHasil] = useState<{ f: Filter; data: Data } | { f: Filter; err: string } | null>(null);
  const [nonce, setNonce] = useState(0); // dinaikkan tombol "Coba lagi"

  useEffect(() => {
    let hidup = true;
    void (async () => {
      try {
        const [rowsRes, sumRes] = await Promise.all([
          fetch(`/api/stock/batch?limit=${LIMIT}${QS[filter]}`),
          fetch(`/api/stock/batch/summary`),
        ]);
        if (!rowsRes.ok) throw new Error((await rowsRes.json()).error ?? "gagal memuat data batch");
        const j = (await rowsRes.json()) as { rows: StockBatchRow[]; total_rows: number };
        const summary = sumRes.ok ? ((await sumRes.json()) as StockBatchSummary) : null;
        if (hidup) setHasil({ f: filter, data: { rows: j.rows ?? [], total_rows: j.total_rows ?? 0, summary } });
      } catch (e) {
        if (hidup) setHasil({ f: filter, err: String(e instanceof Error ? e.message : e) });
      }
    })();
    // Respons yang datang setelah filter berganti diabaikan — tanpa ini hasil
    // permintaan lama bisa menimpa hasil filter baru (race).
    return () => {
      hidup = false;
    };
  }, [filter, nonce]);

  // Hanya hasil untuk filter yang SEDANG dipilih yang dipakai; sisanya dianggap
  // "sedang memuat". Tak ada state yang perlu di-reset saat filter berganti.
  const kini = hasil?.f === filter ? hasil : null;
  const data = kini != null && "data" in kini ? kini.data : null;
  const errMsg = kini != null && "err" in kini ? kini.err : null;
  const terpotong = data != null && data.rows.length < data.total_rows;
  const t = (n: number) => data?.summary?.tier.find((x) => x.tier === n);

  if (errMsg) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState title="Gagal memuat data ED" description={errMsg} />
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setNonce((n) => n + 1)}>
            Coba lagi
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (data == null) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">Memuat data batch & ED…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {data.summary && (
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-3 lg:grid-cols-5">
            {/* Ember SALING LEPAS supaya bisa dijumlahkan: lewat + 0-30 + 31-60
                + 61-90 + tanpa ED + (>90) = total batch. Beda dari kolom "Sisa"
                di tabel yang tier-nya kumulatif — itu yang menentukan kapan
                alert berbunyi. */}
            <div>
              <p className="text-muted-foreground text-xs">Sudah lewat ED</p>
              <p className={`text-2xl font-semibold ${data.summary.sudah_lewat.batch > 0 ? "text-danger" : ""}`}>
                {fmt(data.summary.sudah_lewat.batch)}
              </p>
              <p className="text-muted-foreground text-xs">batch · {fmt(data.summary.sudah_lewat.qty)} unit</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">≤ 30 hari</p>
              <p className="text-2xl font-semibold text-danger">{fmt(t(30)?.batch ?? 0)}</p>
              <p className="text-muted-foreground text-xs">batch · {fmt(t(30)?.qty ?? 0)} unit</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">31–60 hari</p>
              <p className="text-2xl font-semibold text-warning">{fmt(t(60)?.batch ?? 0)}</p>
              <p className="text-muted-foreground text-xs">batch · {fmt(t(60)?.qty ?? 0)} unit</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">61–90 hari</p>
              <p className="text-2xl font-semibold">{fmt(t(90)?.batch ?? 0)}</p>
              <p className="text-muted-foreground text-xs">batch · {fmt(t(90)?.qty ?? 0)} unit</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Tanpa ED</p>
              <p className="text-2xl font-semibold">{fmt(data.summary.batch_tanpa_ed)}</p>
              <p className="text-muted-foreground text-xs">tidak ikut alert</p>
            </div>
            <div className="sm:col-span-3 lg:col-span-5">
              <p className="text-muted-foreground text-xs">
                Total {fmt(data.summary.batch_total)} batch · dihitung dari tanggal{" "}
                <span className="font-medium">{data.summary.hari_ini}</span> (WIB) · data terakhir masuk:{" "}
                <span className="font-medium">{tglJam(data.summary.terakhir_update)}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tampil selama master gudang ada (ikut konvensi F37): gudang yang belum
          punya batch tetap terlihat dengan "belum ada data" — kalau seluruh kartu
          disembunyikan saat semuanya nol, pembaca tak bisa membedakan "gudangnya
          belum melapor" dari "menu ini tak punya rincian per gudang". */}
      {data.summary && data.summary.per_gudang.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm font-medium">ED terdekat per gudang cabang</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {data.summary.per_gudang.map((w) => (
                <div key={w.kode} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{w.kode}</p>
                  <p className="text-muted-foreground text-xs">{w.nama}</p>
                  <p className="mt-2 text-sm font-semibold">{w.terdekat ?? "—"}</p>
                  <p className="text-muted-foreground text-xs">
                    {w.batch === 0 ? "belum ada data" : `${fmt(w.batch)} batch · ${fmt(w.qty)} unit`}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["semua", "Semua batch"],
                ["lewat", "Sudah lewat ED"],
                ["t30", "≤ 30 hari"],
                ["t60", "31–60 hari"],
                ["t90", "61–90 hari"],
                ["tanpa_ed", "Tanpa ED"],
              ] as const
            ).map(([k, lbl]) => (
              <Button
                key={k}
                size="sm"
                variant={filter === k ? "default" : "outline"}
                onClick={() => setFilter(k)}
              >
                {lbl}
              </Button>
            ))}
          </div>

          {terpotong && (
            <p className="text-warning text-sm">
              Menampilkan {fmt(data.rows.length)} dari {fmt(data.total_rows)} batch — daftar terpotong.
              Batch yang tidak muncul bukan berarti tidak ada; persempit dengan filter di atas.
            </p>
          )}

          {data.rows.length === 0 ? (
            <EmptyState
              title={filter === "semua" ? "Belum ada data batch & ED" : "Tidak ada batch pada filter ini"}
              description={
                filter === "semua"
                  ? "Isi lewat importer: scripts/db/import_stock_batch.py --file <csv> --db <db> --apply"
                  : "Coba filter lain."
              }
            />
          ) : (
            <>
              <StockBatchTable rows={data.rows} />
              <p className="text-muted-foreground text-xs">
                Kolom <span className="font-medium">Sisa</span> memakai ambang <em>kumulatif</em>
                (≤30 hari termasuk yang sudah lewat) karena itu yang menentukan kapan alert berbunyi.
                Kartu di atas memakai ember <em>saling lepas</em> supaya angkanya bisa dijumlahkan.
              </p>
              <p className="text-muted-foreground text-xs">
                <span className="font-medium">Saran alokasi</span> dan penanda &quot;ada histori KSO&quot;
                adalah <span className="font-medium">petunjuk</span> yang diturunkan dari riwayat kategori
                faktur — bukan komitmen kontrak, dan cakupannya tidak 100% (ada faktur tanpa kategori).
                Keputusan akhir tetap di tim gudang &amp; supply chain.
              </p>
              <p className="text-muted-foreground text-xs">
                Hanya batch di <span className="font-medium">gudang cabang WRG</span>. Batch di gudang
                virtual milik customer sengaja tidak ikut.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
