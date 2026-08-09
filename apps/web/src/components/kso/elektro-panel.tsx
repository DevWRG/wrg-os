"use client";

// Kategori Elektrolit — Easy Diagnosis DN-X6 (Na/K/Cl/Ca/pH/Li).
//
// Dihitung terbalik dari kategori lain: yang diketahui isi Cal A per paket, dan
// pemakaiannya 21 mL/hari tetap + 0,8 mL per test. Dari situ ketahuan paketnya
// habis dalam berapa hari, lalu berapa test yang keluar — baru jadi biaya/test.
// Efeknya: makin sedikit test/hari, makin banyak reagen terbuang untuk pemakaian
// harian, dan biaya per test naik.

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AngkaField, HargaDiskon, HeroBiaya, KartuCapex, PilihanBaris, Stat, fmtNum, fmtRp,
} from "@/components/kso/shared";
import { exportDokumen } from "@/lib/kso/export-excel";
import { hitungCapex, hitungElektro, nettOf } from "@/lib/kso/model";
import { printDokumen } from "@/lib/kso/print-pdf";
import type { HargaInput, KsoAnalyzer } from "@/lib/kso/types";

import { PresetTest } from "./hemato-panel";
import type { Umum } from "./kso-view";

export function ElektroPanel({
  analyzers, umum, setUmum, halaman, keHasil,
}: {
  analyzers: KsoAnalyzer[];
  umum: Umum;
  setUmum: (patch: Partial<Umum>) => void;
  halaman: "input" | "hasil";
  keHasil: () => void;
}) {
  const analyzer = analyzers[0];
  const modes = analyzer?.meta.modes ?? {};
  const modeKeys = Object.keys(modes);

  const [s, setS] = useState(() => ({
    price: analyzer?.defaultCapex ?? 0,
    disc: 0,
    kso: analyzer?.defaultKsoBulan ?? 0,
    markup: analyzer?.defaultMarkup ?? 0,
    tests: analyzer?.defaultTests ?? 0,
    mode: modeKeys[0] ?? "",
  }));
  // Harga paket reagen per mode: cartridge & bottle isinya beda, harganya beda.
  const [hargaMode, setHargaMode] = useState<Record<string, HargaInput>>(() =>
    Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, { price: m.price, disc: 0 }])),
  );
  const [qcFree, setQcFree] = useState(true);
  const [qc, setQc] = useState<Record<string, HargaInput>>(() =>
    Object.fromEntries(
      (analyzer?.reagents ?? []).filter((r) => r.jenis === "qc")
        .map((r) => [r.kode, { price: r.hargaDp ?? 0, disc: 0 }]),
    ),
  );

  // UPS & LIS milik kategori ini sendiri — di aplikasi asal tiap kategori
  // punya sepasang sendiri (cuma Hematologi & Kimia Klinik yang berbagi),
  // karena satu kunjungan bisa menawarkan beberapa alat dengan pendukung
  // yang berbeda.
  const [ups, setUps] = useState(0);
  const [lis, setLis] = useState(0);
  const upd = (patch: Partial<typeof s>) => setS((p) => ({ ...p, ...patch }));
  const qcItems = useMemo(
    () => (analyzer?.reagents ?? []).filter((r) => r.jenis === "qc"),
    [analyzer],
  );
  const modeInfo = modes[s.mode];
  // Fallback lewat useMemo, bukan objek literal: literal bikin identitas baru
  // tiap render sehingga useMemo hasil di bawah ikut dihitung ulang terus.
  const hargaReagen = useMemo(
    () => hargaMode[s.mode] ?? { price: 0, disc: 0 },
    [hargaMode, s.mode],
  );

  const capex = useMemo(
    () =>
      hitungCapex({
        harga: { price: s.price, disc: s.disc },
        ups, lis, backup: null,
        ksoBulan: s.kso, testsPerMonth: s.tests, workDays: umum.workDays,
      }),
    [s, ups, lis, umum.workDays],
  );
  const hasil = useMemo(
    () =>
      hitungElektro(
        modeInfo?.calAVol ?? 0, hargaReagen,
        qcItems.map((r) => qc[r.kode] ?? { price: 0, disc: 0 }),
        qcFree, capex, s.tests, umum.workDays, s.markup,
      ),
    // qcItems turunan dari analyzer, ikut lewat `analyzer` di deps modeInfo.
    [modeInfo, hargaReagen, qc, qcFree, capex, s.tests, s.markup, umum.workDays, qcItems],
  );

  if (!analyzer) {
    return <EmptyState title="Master elektrolit kosong" description="Jalankan importer master KSO." />;
  }

  const labelKemasan =
    s.mode === "cartridge" ? "650 mL Cal A / cartridge" : "3×450 mL Cal A + 1 Cal B / set";

  const dokumen = {
    judul: "KSO CPRR — ELEKTROLIT",
    sheet: "Elektrolit",
    ringkas: {
      analyzerName: `${analyzer.label} · ${modeInfo?.label ?? ""}`,
      backupLabel: "",
      totCap: capex.total,
      capex: { alat: capex.nettAlat, backup: 0, ups, lis },
      kso: s.kso, testsPerMonth: s.tests, totTest: capex.totalTest,
      workDays: umum.workDays, markup: s.markup,
    },
    info: {
      salesName: umum.salesName, faskesName: umum.faskesName,
      kotaKab: umum.kotaKab, kompetitor: umum.kompetitor,
    },
    catatan: [
      { label: "Mode reagen", value: `${modeInfo?.label ?? "—"} (${labelKemasan})` },
      { label: "Masa pakai satu paket", value: `${fmtNum(hasil.runDays)} hari` },
      { label: "Test per paket", value: `${fmtNum(hasil.testPerPaket)} test` },
      { label: "QC", value: qcFree ? "FREE — supplier" : "PAID — mandiri" },
    ],
    biaya: [
      { label: "CAPEX / test", value: capex.perTest },
      { label: "Reagen / test", value: hasil.reagenPerTest },
      ...(hasil.overheadQc > 0 ? [{ label: "QC / test", value: hasil.overheadQc }] : []),
      { label: "Base cost / test", value: hasil.baseCost },
      { label: `Markup ${s.markup}%`, value: hasil.sellPerTest - hasil.baseCost },
      { label: "CPRR (harga jual / test)", value: hasil.sellPerTest, sorot: true },
    ],
    tabel: {
      judul: "Rincian reagen",
      header: ["Item", "Kemasan", "Nett / paket", "Test / paket", "Harga jual / paket"],
      rows: [
        [
          `Paket reagen ${modeInfo?.label ?? ""}`,
          labelKemasan,
          fmtRp(nettOf(hargaReagen)),
          fmtNum(hasil.testPerPaket),
          fmtRp(hasil.sellPaket),
        ],
        ...qcItems.map((r) => [
          r.nama, r.pack ?? "", fmtRp(nettOf(qc[r.kode] ?? { price: 0, disc: 0 })), "—", "—",
        ]),
      ],
    },
  };

  if (halaman === "hasil") {
    return (
      <div className="space-y-4">
        <HeroBiaya
          judul="Cost / Test — KSO CPRR"
          nilai={hasil.ada ? fmtRp(hasil.sellPerTest) : "—"}
          keterangan={
            <>
              {analyzer.brand ?? analyzer.label} · {modeInfo?.label}
              {capex.D > 0 ? ` · ${fmtNum(capex.D)} test/hari` : ""}
              {hasil.ada
                ? ` — satu paket bertahan ${fmtNum(hasil.runDays)} hari (${fmtNum(hasil.testPerPaket)} test)`
                : ""}
            </>
          }
          pills={[
            { label: "CAPEX/test", value: fmtRp(capex.perTest), tone: "biaya" },
            { label: "Reagen/test", value: hasil.ada ? fmtRp(hasil.reagenPerTest) : "—" },
            ...(hasil.overheadQc > 0
              ? [{ label: "QC/test", value: fmtRp(hasil.overheadQc), tone: "peringatan" as const }]
              : []),
            { label: "Base cost", value: fmtRp(hasil.baseCost) },
            {
              label: `Markup ${s.markup}%`,
              value: hasil.ada ? fmtRp(hasil.sellPerTest - hasil.baseCost) : "—",
              tone: "sorot" as const,
            },
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle>Rincian reagen — {analyzer.label} · {modeInfo?.label}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Pemakaian Cal A = 21 mL/hari tetap + 0,8 mL per test. Makin sedikit test/hari, makin besar
              porsi reagen yang habis untuk pemakaian harian.
            </p>
            {hasil.ada ? (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => void exportDokumen(dokumen)}>Cetak Excel</Button>
                <Button variant="outline" size="sm" onClick={() => printDokumen(dokumen)}>Cetak PDF</Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden sm:table-cell">Kemasan</TableHead>
                    <TableHead className="text-right">Nett / paket</TableHead>
                    <TableHead className="text-right">Test / paket</TableHead>
                    <TableHead className="text-right">Harga jual / paket</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Paket reagen {modeInfo?.label}</TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">{labelKemasan}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtRp(nettOf(hargaReagen))}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(hasil.testPerPaket)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtRp(hasil.sellPaket)}</TableCell>
                  </TableRow>
                  {qcItems.map((r) => (
                    <TableRow key={r.kode}>
                      <TableCell>{r.nama}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">{r.pack}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtRp(nettOf(qc[r.kode] ?? { price: 0, disc: 0 }))}
                      </TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right">—</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={4} className="font-medium">Reagen / test</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtRp(hasil.reagenPerTest)}</TableCell>
                  </TableRow>
                  {hasil.overheadQc > 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>QC / test</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-500">
                        {fmtRp(hasil.overheadQc)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  <TableRow>
                    <TableCell colSpan={4} className="text-destructive">+ CAPEX / test</TableCell>
                    <TableCell className="text-destructive text-right font-semibold tabular-nums">{fmtRp(capex.perTest)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-primary/5">
                    <TableCell colSpan={4} className="font-semibold">
                      Cost / test KSO CPRR{" "}
                      <span className="text-muted-foreground text-xs font-normal">margin {s.markup}%</span>
                    </TableCell>
                    <TableCell className="text-primary text-right text-base font-bold tabular-nums">
                      {hasil.ada ? fmtRp(hasil.sellPerTest) : "—"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PilihanBaris
        label="Mode reagen"
        value={s.mode}
        options={modeKeys.map((k) => ({ key: k, label: modes[k].label }))}
        onChange={(v) => upd({ mode: v })}
      />
      <PresetTest presets={analyzer.presets} value={s.tests} onChange={(v) => upd({ tests: v })} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>CAPEX</CardTitle></CardHeader>
          <CardContent>
            <KartuCapex
              price={s.price} disc={s.disc}
              onPrice={(v) => upd({ price: v })} onDisc={(v) => upd({ disc: v })}
              ups={ups} lis={lis}
              onUps={setUps} onLis={setLis}
              nettAlat={capex.nettAlat} total={capex.total}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Parameter KSO</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <AngkaField label="Masa KSO" value={s.kso} onChange={(v) => upd({ kso: v })} suffix="bln" />
            <AngkaField label="Test / bulan" value={s.tests} onChange={(v) => upd({ tests: v })} />
            <AngkaField label="Hari kerja / bulan" value={umum.workDays} onChange={(v) => setUmum({ workDays: v })} suffix="hari" />
            <AngkaField label="Margin / markup" value={s.markup} onChange={(v) => upd({ markup: v })} suffix="%" />
            <div className="border-t pt-2">
              <Stat label="Test / hari" value={capex.D > 0 ? fmtNum(capex.D) : "—"} />
              <Stat label="Masa pakai 1 paket" value={hasil.ada ? `${fmtNum(hasil.runDays)} hari` : "—"} />
              <Stat label="Test per paket" value={hasil.ada ? fmtNum(hasil.testPerPaket) : "—"} />
              <Stat label="CAPEX / test" value={fmtRp(capex.perTest)} tone="biaya" />
              <Stat label="Reagen / test" value={fmtRp(hasil.reagenPerTest)} />
              {hasil.overheadQc > 0 ? (
                <Stat label="QC / test" value={fmtRp(hasil.overheadQc)} tone="peringatan" />
              ) : null}
              <Stat label="Harga jual / test" value={fmtRp(hasil.sellPerTest)} tone="sorot" kuat />
            </div>
            <Button className="w-full" onClick={keHasil} disabled={!hasil.ada}>
              Lihat hasil perhitungan
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Harga reagen &amp; QC</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <HargaDiskon
              label={`Paket reagen ${modeInfo?.label ?? ""} — ${labelKemasan}`}
              price={hargaReagen.price} disc={hargaReagen.disc}
              onPrice={(v) => setHargaMode((p) => ({ ...p, [s.mode]: { ...p[s.mode], price: v } }))}
              onDisc={(v) => setHargaMode((p) => ({ ...p, [s.mode]: { ...p[s.mode], disc: v } }))}
              nett={nettOf(hargaReagen)}
            />

            <div className="space-y-3 border-t pt-3">
              <div className="text-xs font-semibold tracking-wide uppercase">QC</div>
              <PilihanBaris
                value={qcFree ? "free" : "beli"}
                options={[
                  { key: "free", label: "Free (overhead)" },
                  { key: "beli", label: "Beli (price list)" },
                ]}
                onChange={(v) => setQcFree(v === "free")}
              />
              {qcItems.map((r) => {
                const h = qc[r.kode] ?? { price: 0, disc: 0 };
                return (
                  <HargaDiskon
                    key={r.kode}
                    label={`${r.nama}${r.pack ? ` — ${r.pack}` : ""}`}
                    price={h.price} disc={h.disc}
                    onPrice={(v) => setQc((p) => ({ ...p, [r.kode]: { ...p[r.kode], price: v } }))}
                    onDisc={(v) => setQc((p) => ({ ...p, [r.kode]: { ...p[r.kode], disc: v } }))}
                  />
                );
              })}
              {qcFree ? (
                <p className="text-muted-foreground text-[11px]">
                  Tiga larutan QC dibeli per botol dan dipakai sekali sebulan — overhead-nya = total
                  ketiganya dibagi test sebulan.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
