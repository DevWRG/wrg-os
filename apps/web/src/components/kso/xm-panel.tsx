"use client";

// Kategori Crossmatch (LIBO Coombs card / RedCell AHG).
//
// Paling sederhana dari tujuh kategori: kartu & LISS habis per pemeriksaan, jadi
// tidak ada komponen biaya harian dan tidak ada overhead QC. Yang menentukan
// biaya justru METODE — berapa kolom kartu dipakai (Mayor saja, + Minor, + AC).

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
import { hitungCapex, hitungXm, nettOf } from "@/lib/kso/model";
import { printDokumen } from "@/lib/kso/print-pdf";
import type { HargaInput, KsoAnalyzer } from "@/lib/kso/types";

import { PresetTest } from "./hemato-panel";
import type { Umum } from "./kso-view";

interface SetXm {
  price: number;
  disc: number;
  kso: number;
  markup: number;
  tests: number;
  metode: string;
}

const HARGA_KOSONG: Record<string, HargaInput> = {};

const setAwal = (a: KsoAnalyzer): SetXm => ({
  price: a.defaultCapexPl ?? a.defaultCapex,
  disc: 0,
  kso: 0,
  markup: 0,
  tests: 0,
  metode: a.meta.methods?.[0]?.id ?? "",
});

const hargaAwal = (a: KsoAnalyzer): Record<string, HargaInput> =>
  Object.fromEntries(a.reagents.map((r) => [r.kode, { price: r.hargaPl ?? r.hargaDp ?? 0, disc: 0 }]));

export function XmPanel({
  analyzers, umum, setUmum, halaman, keHasil,
}: {
  analyzers: KsoAnalyzer[];
  umum: Umum;
  setUmum: (patch: Partial<Umum>) => void;
  halaman: "input" | "hasil";
  keHasil: () => void;
}) {
  const [kode, setKode] = useState(analyzers[0]?.kode ?? "");
  const analyzer = analyzers.find((a) => a.kode === kode) ?? analyzers[0];

  const [set, setSet] = useState<Record<string, SetXm>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, setAwal(a)])),
  );
  const [harga, setHarga] = useState<Record<string, Record<string, HargaInput>>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, hargaAwal(a)])),
  );

  const s = set[analyzer?.kode ?? ""] ?? setAwal(analyzer);
  const hargaNow = harga[analyzer?.kode ?? ""] ?? HARGA_KOSONG;
  const upd = (patch: Partial<SetXm>) =>
    setSet((p) => ({ ...p, [analyzer.kode]: { ...p[analyzer.kode], ...patch } }));
  const updHarga = (k: string, patch: Partial<HargaInput>) =>
    setHarga((p) => ({
      ...p,
      [analyzer.kode]: { ...p[analyzer.kode], [k]: { ...p[analyzer.kode][k], ...patch } },
    }));

  const metode = analyzer?.meta.methods?.find((m) => m.id === s.metode) ?? analyzer?.meta.methods?.[0];

  const capex = useMemo(
    () =>
      hitungCapex({
        harga: { price: s.price, disc: s.disc },
        ups: umum.ups, lis: umum.lis, backup: null,
        ksoBulan: s.kso, testsPerMonth: s.tests, workDays: umum.workDays,
      }),
    [s, umum],
  );
  const hasil = useMemo(
    () =>
      analyzer
        ? hitungXm(analyzer, hargaNow, capex, s.tests, umum.workDays, s.markup, metode)
        : null,
    [analyzer, hargaNow, capex, s.tests, s.markup, umum.workDays, metode],
  );

  if (!analyzer || !hasil) {
    return <EmptyState title="Master crossmatch kosong" description="Jalankan importer master KSO." />;
  }

  const judulAlat = `${analyzer.label}${metode ? ` · ${metode.label}` : ""}`;
  const dokumen = {
    judul: "KSO CPRR — CROSSMATCH",
    sheet: "Crossmatch",
    ringkas: {
      analyzerName: judulAlat,
      backupLabel: "",
      totCap: capex.total,
      capex: { alat: capex.nettAlat, backup: 0, ups: umum.ups, lis: umum.lis },
      kso: s.kso, testsPerMonth: s.tests, totTest: capex.totalTest,
      workDays: umum.workDays, markup: s.markup,
    },
    info: {
      salesName: umum.salesName, faskesName: umum.faskesName,
      kotaKab: umum.kotaKab, kompetitor: umum.kompetitor,
    },
    biaya: [
      { label: "CAPEX / test", value: capex.perTest },
      { label: "Reagen / test", value: hasil.reagenPerTest },
      { label: "Base cost / test", value: hasil.baseCost },
      { label: `Markup ${s.markup}%`, value: hasil.sellPerTest - hasil.baseCost },
      { label: "CPRR (harga jual / test)", value: hasil.sellPerTest, sorot: true },
    ],
    tabel: {
      judul: "Rincian reagen",
      header: ["Nama barang", "Kemasan", "Nett / kemasan", "Kontribusi / test", "Harga jual / kemasan"],
      rows: hasil.rows.map((r) => [
        r.nama, r.pack ?? "", fmtRp(r.nettKit), fmtRp(r.kontribusiTest), fmtRp(r.sellKit),
      ]),
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
              {analyzer.brand ?? analyzer.label}
              {metode ? ` · ${metode.label}` : ""}
              {capex.totalTest > 0 ? ` · ${fmtNum(capex.totalTest)} test · ${s.kso} bulan` : ""}
            </>
          }
          pills={[
            { label: "CAPEX/test", value: fmtRp(capex.perTest), tone: "biaya" },
            { label: "Reagen/test", value: hasil.ada ? fmtRp(hasil.reagenPerTest) : "—" },
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
            <CardTitle>Rincian reagen — {judulAlat}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Kontribusi/test mengikuti metode: {metode?.cols ?? 0} kolom kartu + {metode?.liss_ml ?? 0} mL
              LISS per pemeriksaan.
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
                    <TableHead>Nama barang</TableHead>
                    <TableHead className="hidden sm:table-cell">Kemasan</TableHead>
                    <TableHead className="text-right">Nett / kemasan</TableHead>
                    <TableHead className="text-right">Kontribusi / test</TableHead>
                    <TableHead className="text-right">Harga jual / kemasan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hasil.rows.map((r) => (
                    <TableRow key={r.kode}>
                      <TableCell className="font-medium">{r.nama}</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">{r.pack}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtRp(r.nettKit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.kontribusiTest)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtRp(r.sellKit)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={3} className="font-medium">Total reagen / test</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtNum(hasil.reagenPerTest)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={3} className="text-destructive">+ CAPEX / test</TableCell>
                    <TableCell className="text-destructive text-right font-semibold tabular-nums">{fmtRp(capex.perTest)}</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-primary/5">
                    <TableCell colSpan={3} className="font-semibold">
                      Cost / test KSO CPRR{" "}
                      <span className="text-muted-foreground text-xs font-normal">margin {s.markup}%</span>
                    </TableCell>
                    <TableCell className="text-primary text-right text-base font-bold tabular-nums">
                      {hasil.ada ? fmtRp(hasil.sellPerTest) : "—"}
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
      <PilihanBaris
        label="Pilih merek"
        value={analyzer.kode}
        options={analyzers.map((a) => ({ key: a.kode, label: a.label, sub: a.brand ?? undefined }))}
        onChange={setKode}
      />
      <PilihanBaris
        label="Metode"
        value={s.metode}
        options={(analyzer.meta.methods ?? []).map((m) => ({ key: m.id, label: m.label }))}
        onChange={(v) => upd({ metode: v })}
      />
      <PresetTest presets={analyzer.presets} value={s.tests} onChange={(v) => upd({ tests: v })} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>CAPEX</CardTitle></CardHeader>
          <CardContent>
            <KartuCapex
              price={s.price} disc={s.disc}
              onPrice={(v) => upd({ price: v })} onDisc={(v) => upd({ disc: v })}
              ups={umum.ups} lis={umum.lis}
              onUps={(v) => setUmum({ ups: v })} onLis={(v) => setUmum({ lis: v })}
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
              <Stat label="Reagen / test" value={fmtRp(hasil.reagenPerTest)} />
              <Stat label="Harga jual / test" value={fmtRp(hasil.sellPerTest)} tone="sorot" kuat />
            </div>
            <Button className="w-full" onClick={keHasil} disabled={!hasil.ada}>
              Lihat hasil perhitungan
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Harga reagen (price list)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {analyzer.reagents.map((r) => {
              const h = hargaNow[r.kode] ?? { price: 0, disc: 0 };
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
