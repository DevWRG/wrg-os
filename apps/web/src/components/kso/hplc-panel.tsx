"use client";

// Kategori HPLC — HbA1c Arkray AH600pro.
//
// Dua hal yang khas: (1) buffer punya faktor waste (sisa di dasar botol tak bisa
// ditarik jarum) yang sudah dipegang formula.ts, dan (2) kolom & filter aus per
// test, jadi depresiasinya berdiri sendiri di luar biaya cairan.

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
import { hitungCapex, hitungHplc, nettOf, type KontrolHplc } from "@/lib/kso/model";
import { printDokumen } from "@/lib/kso/print-pdf";
import type { HargaInput, KsoAnalyzer } from "@/lib/kso/types";

import { PresetTest } from "./hemato-panel";
import type { Umum } from "./kso-view";

export function HplcPanel({
  analyzers, umum, setUmum, halaman, keHasil,
}: {
  analyzers: KsoAnalyzer[];
  umum: Umum;
  setUmum: (patch: Partial<Umum>) => void;
  halaman: "input" | "hasil";
  keHasil: () => void;
}) {
  const analyzer = analyzers[0];

  const [s, setS] = useState(() => ({
    price: analyzer?.defaultCapex ?? 0,
    disc: 0,
    kso: analyzer?.defaultKsoBulan ?? 0,
    markup: analyzer?.defaultMarkup ?? 0,
    tests: analyzer?.defaultTests ?? 0,
  }));
  const [harga, setHarga] = useState<Record<string, HargaInput>>(() =>
    Object.fromEntries((analyzer?.reagents ?? []).map((r) => [r.kode, { price: r.hargaDp ?? 0, disc: 0 }])),
  );
  const [kontrol, setKontrol] = useState<KontrolHplc>(() => ({
    free: true,
    cal: { price: analyzer?.meta.calPl ?? 0, disc: 0 },
    ctrl: { price: analyzer?.meta.ctrlPl ?? 0, disc: 0 },
  }));

  // UPS & LIS milik kategori ini sendiri — di aplikasi asal tiap kategori
  // punya sepasang sendiri (cuma Hematologi & Kimia Klinik yang berbagi),
  // karena satu kunjungan bisa menawarkan beberapa alat dengan pendukung
  // yang berbeda.
  const [ups, setUps] = useState(0);
  const [lis, setLis] = useState(0);
  const upd = (patch: Partial<typeof s>) => setS((p) => ({ ...p, ...patch }));
  const updHarga = (k: string, patch: Partial<HargaInput>) =>
    setHarga((p) => ({ ...p, [k]: { ...p[k], ...patch } }));

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
    () => (analyzer ? hitungHplc(analyzer, harga, capex, s.tests, umum.workDays, s.markup, kontrol) : null),
    [analyzer, harga, capex, s.tests, s.markup, umum.workDays, kontrol],
  );

  if (!analyzer || !hasil) {
    return <EmptyState title="Master HPLC kosong" description="Jalankan importer master KSO." />;
  }

  const dokumen = {
    judul: "KSO CPRR — HPLC HbA1c",
    sheet: "HPLC",
    ringkas: {
      analyzerName: analyzer.brand ?? analyzer.label,
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
    catatan: [{ label: "Kontrol & kalibrator", value: kontrol.free ? "FREE — supplier" : "PAID — mandiri" }],
    biaya: [
      { label: "CAPEX / test", value: capex.perTest },
      { label: "Reagen + part / test", value: hasil.reagenPerTest },
      ...(hasil.overheadKontrol > 0 ? [{ label: "QC + kalibrasi / test", value: hasil.overheadKontrol }] : []),
      { label: "Base cost / test", value: hasil.baseCost },
      { label: `Markup ${s.markup}%`, value: hasil.sellPerTest - hasil.baseCost },
      { label: "CPRR (harga jual / test)", value: hasil.sellPerTest, sorot: true },
    ],
    tabel: {
      judul: "Rincian reagen & part",
      header: ["Nama barang", "Kemasan", "Kontribusi / test", "Harga KSO di Excel"],
      rows: hasil.rows.map((r) => [r.nama, r.pack ?? "", fmtRp(r.kontribusiTest), fmtRp(r.hargaExcel)]),
    },
  };

  if (halaman === "hasil") {
    return (
      <div className="space-y-4">
        <HeroBiaya
          judul="Cost / Test — KSO CPRR"
          nilai={hasil.reagen ? fmtRp(hasil.sellPerTest) : "—"}
          keterangan={
            <>
              {analyzer.brand ?? analyzer.label}
              {capex.totalTest > 0 ? ` · ${fmtNum(capex.totalTest)} test · ${s.kso} bulan` : ""}
              {capex.D > 0 ? ` · ${fmtNum(capex.D)} test/hari` : ""}
            </>
          }
          pills={[
            { label: "CAPEX/test", value: fmtRp(capex.perTest), tone: "biaya" },
            { label: "Cairan/test", value: hasil.reagen ? fmtRp(hasil.reagen.cyc + hasil.reagen.fix) : "—" },
            {
              label: "Kolom+filter/test",
              value: hasil.reagen ? fmtRp(hasil.reagen.pr.col.c + hasil.reagen.pr.flt.c) : "—",
            },
            ...(hasil.overheadKontrol > 0
              ? [{ label: "QC+Cal/test", value: fmtRp(hasil.overheadKontrol), tone: "peringatan" as const }]
              : []),
            {
              label: `Markup ${s.markup}%`,
              value: hasil.reagen ? fmtRp(hasil.sellPerTest - hasil.baseCost) : "—",
              tone: "sorot" as const,
            },
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle>Rincian reagen &amp; part — {analyzer.label}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Buffer dihitung dengan faktor waste (800 mL efektif 760, 2.000 mL efektif 1.800). Kolom &amp;
              filter aus per test, tidak punya komponen harian.
            </p>
            {hasil.reagen ? (
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
                    <TableHead>Nama barang</TableHead>
                    <TableHead className="hidden sm:table-cell">Kemasan</TableHead>
                    <TableHead className="text-right">Kontribusi / test</TableHead>
                    <TableHead className="text-right">Harga KSO di Excel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hasil.rows.map((r) => (
                    <TableRow key={r.kode}>
                      <TableCell className="font-medium">{r.nama}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">{r.pack}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.kontribusiTest)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.hargaExcel > 0 ? fmtRp(r.hargaExcel) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {hasil.overheadKontrol > 0 ? (
                    <TableRow>
                      <TableCell colSpan={2}>QC control + kalibrasi / test</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-500">
                        {fmtNum(hasil.overheadKontrol)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ) : null}
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={2} className="font-medium">Total reagen + part / test</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtNum(hasil.reagenPerTest)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={2} className="text-destructive">+ CAPEX / test</TableCell>
                    <TableCell className="text-destructive text-right font-semibold tabular-nums">{fmtRp(capex.perTest)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-primary/5">
                    <TableCell colSpan={2} className="font-semibold">
                      Cost / test KSO CPRR{" "}
                      <span className="text-muted-foreground text-xs font-normal">margin {s.markup}%</span>
                    </TableCell>
                    <TableCell className="text-primary text-right text-base font-bold tabular-nums">
                      {hasil.reagen ? fmtRp(hasil.sellPerTest) : "—"}
                    </TableCell>
                    <TableCell />
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
              <Stat label="Total test KSO" value={capex.totalTest > 0 ? fmtNum(capex.totalTest) : "—"} />
              <Stat label="CAPEX / test" value={fmtRp(capex.perTest)} tone="biaya" />
              <Stat label="Reagen + part / test" value={fmtRp(hasil.reagenPerTest)} />
              {hasil.overheadKontrol > 0 ? (
                <Stat label="QC + kalibrasi / test" value={fmtRp(hasil.overheadKontrol)} tone="peringatan" />
              ) : null}
              <Stat label="Harga jual / test" value={fmtRp(hasil.sellPerTest)} tone="sorot" kuat />
            </div>
            <Button className="w-full" onClick={keHasil} disabled={!hasil.reagen}>
              Lihat hasil perhitungan
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Harga reagen &amp; part</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {analyzer.reagents.map((r) => {
              const h = harga[r.kode] ?? { price: 0, disc: 0 };
              return (
                <HargaDiskon
                  key={r.kode}
                  label={`${r.nama}${r.pack ? ` — ${r.pack}` : ""}`}
                  price={h.price} disc={h.disc}
                  onPrice={(v) => updHarga(r.kode, { price: v })}
                  onDisc={(v) => updHarga(r.kode, { disc: v })}
                  nett={nettOf(h)}
                />
              );
            })}

            <div className="space-y-3 border-t pt-3">
              <div className="text-xs font-semibold tracking-wide uppercase">Kontrol &amp; kalibrator</div>
              <PilihanBaris
                value={kontrol.free ? "free" : "beli"}
                options={[
                  { key: "free", label: "Free (overhead)" },
                  { key: "beli", label: "Beli (price list)" },
                ]}
                onChange={(v) => setKontrol((p) => ({ ...p, free: v === "free" }))}
              />
              <HargaDiskon
                label="Kalibrator"
                price={kontrol.cal.price} disc={kontrol.cal.disc}
                onPrice={(v) => setKontrol((p) => ({ ...p, cal: { ...p.cal, price: v } }))}
                onDisc={(v) => setKontrol((p) => ({ ...p, cal: { ...p.cal, disc: v } }))}
              />
              <HargaDiskon
                label="Kontrol"
                price={kontrol.ctrl.price} disc={kontrol.ctrl.disc}
                onPrice={(v) => setKontrol((p) => ({ ...p, ctrl: { ...p.ctrl, price: v } }))}
                onDisc={(v) => setKontrol((p) => ({ ...p, ctrl: { ...p.ctrl, disc: v } }))}
              />
              {kontrol.free ? (
                <p className="text-muted-foreground text-[11px]">
                  Frekuensi mengikuti anjuran alat: kalibrasi 0,5× per 5 hari kerja dan kontrol 0,0392× per
                  hari kerja (≈ 1 kontrol per 25 hari), lalu dibagi test sebulan.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
