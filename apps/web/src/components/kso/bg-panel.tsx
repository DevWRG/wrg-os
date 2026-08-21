"use client";

// Kategori Blood Gas — Easy Diagnosis PT1000 (cartridge).
//
// Satu-satunya kategori dengan DUA skema yang hasilnya beda, dan bedanya bukan
// kosmetik:
//   KSO  — faskes beli cartridge sendiri. HPP = nett ÷ kapasitas kit; test yang
//          tidak terpakai sebelum cartridge kedaluwarsa (residu) ditanggung faskes.
//   CPRR — WRG yang menanggung. HPP dibagi test yang REALISTIS terpakai selama
//          masa pakai cartridge, jadi residunya masuk ke harga jual.
// Selisih dua angka itu yang jadi bahan negosiasi di depan faskes.

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
import { hitungBg, hitungCapex, nettOf, type ModeBg } from "@/lib/kso/model";
import { printDokumen } from "@/lib/kso/print-pdf";
import type { HargaInput, KsoAnalyzer } from "@/lib/kso/types";

import { PresetTest } from "./hemato-panel";
import type { Umum } from "./kso-view";

export function BgPanel({
  analyzers, umum, setUmum, halaman, keHasil,
}: {
  analyzers: KsoAnalyzer[];
  umum: Umum;
  setUmum: (patch: Partial<Umum>) => void;
  halaman: "input" | "hasil";
  keHasil: () => void;
}) {
  const analyzer = analyzers[0];
  const cartridges = (analyzer?.reagents ?? []).filter((r) => r.jenis === "cartridge");
  const qcItem = (analyzer?.reagents ?? []).find((r) => r.jenis === "qc");

  const [mode, setMode] = useState<ModeBg>("cprr");
  const [s, setS] = useState(() => ({
    price: analyzer?.defaultCapex ?? 0,
    disc: 0,
    kso: 0,
    markup: 0,
    tests: 0,
    // Default kemasan tengah, sama seperti aplikasi asal.
    cartKode: cartridges[1]?.kode ?? cartridges[0]?.kode ?? "",
  }));
  const [hargaCart, setHargaCart] = useState<Record<string, HargaInput>>(() =>
    Object.fromEntries(cartridges.map((c) => [c.kode, { price: c.hargaDp ?? 0, disc: 0 }])),
  );
  const [qcFree, setQcFree] = useState(true);
  const [nQc, setNQc] = useState(1);
  const [hargaQc, setHargaQc] = useState<HargaInput>(() => ({ price: qcItem?.hargaDp ?? 0, disc: 0 }));

  // UPS & LIS milik kategori ini sendiri — di aplikasi asal tiap kategori
  // punya sepasang sendiri (cuma Hematologi & Kimia Klinik yang berbagi),
  // karena satu kunjungan bisa menawarkan beberapa alat dengan pendukung
  // yang berbeda.
  const [ups, setUps] = useState(0);
  const [lis, setLis] = useState(0);
  const upd = (patch: Partial<typeof s>) => setS((p) => ({ ...p, ...patch }));
  const cart = cartridges.find((c) => c.kode === s.cartKode) ?? cartridges[0];
  const stability = analyzer?.meta.stability ?? 0;

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
      hitungBg(
        mode, stability, { yieldTest: cart?.yieldTest ?? 0 },
        hargaCart[s.cartKode] ?? { price: 0, disc: 0 },
        hargaQc, qcFree, nQc, capex, s.tests, s.markup,
      ),
    [mode, stability, cart, hargaCart, s.cartKode, s.tests, s.markup, hargaQc, qcFree, nQc, capex],
  );

  if (!analyzer || !cart) {
    return <EmptyState title="Master blood gas kosong" description="Jalankan importer master KSO." />;
  }

  const ada = s.tests > 0;
  const isCprr = mode === "cprr";
  const dokumen = {
    judul: `KSO ${isCprr ? "CPRR" : "RUNNING COST"} — BLOOD GAS`,
    sheet: "BloodGas",
    ringkas: {
      analyzerName: `${analyzer.label} · ${isCprr ? "CPRR" : "KSO"}`,
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
      { label: "Cartridge", value: `${cart.nama} — ${cart.pack ?? ""}` },
      { label: "Masa pakai cartridge", value: `${stability} hari` },
      { label: "Test realistis / masa pakai", value: `${fmtNum(hasil.realPerMasaPakai)} test` },
      { label: "Kapasitas kit", value: `${fmtNum(hasil.kapasitasKit)} test` },
      { label: "Residu (test terbuang)", value: `${fmtNum(hasil.residu)} test` },
      {
        label: "Skema",
        value: isCprr ? "CPRR — residu ditanggung WRG" : "KSO — faskes beli cartridge, residu di faskes",
      },
      { label: "QC", value: qcFree ? "FREE — supplier" : "PAID — mandiri" },
    ],
    biaya: [
      { label: "CAPEX / test", value: capex.perTest },
      { label: "HPP cartridge / test (kit penuh)", value: hasil.hppPenuh },
      ...(hasil.hppResidu > 0 ? [{ label: "Tambahan akibat residu / test", value: hasil.hppResidu }] : []),
      ...(isCprr && hasil.overheadQc > 0 ? [{ label: "QC / test", value: hasil.overheadQc }] : []),
      { label: "Base cost / test", value: hasil.baseCost },
      { label: `Markup ${s.markup}%`, value: hasil.sellPerTest - hasil.baseCost },
      { label: `${isCprr ? "CPRR" : "Running cost"} (harga jual / test)`, value: hasil.sellPerTest, sorot: true },
    ],
    tabel: {
      judul: "Rincian cartridge & QC",
      header: ["Item", "Kemasan", "Nett", "Kapasitas", "Beban / test"],
      rows: [
        [cart.nama, cart.pack ?? "", fmtRp(hasil.nettCartridge), `${fmtNum(hasil.kapasitasKit)} test`, fmtRp(hasil.hppPerTest)],
        ...(qcItem
          ? [[qcItem.nama, qcItem.pack ?? "", fmtRp(nettOf(hargaQc)), `${fmtNum(qcItem.yieldTest ?? 0)} test`, fmtRp(isCprr ? hasil.overheadQc : 0)]]
          : []),
      ],
    },
  };

  if (halaman === "hasil") {
    return (
      <div className="space-y-4">
        <PilihanBaris
          label="Skema"
          value={mode}
          options={[
            { key: "cprr" as const, label: "CPRR (residu di WRG)" },
            { key: "kso" as const, label: "KSO (faskes beli cartridge)" },
          ]}
          onChange={setMode}
        />
        <HeroBiaya
          judul={isCprr ? "Cost / Test — KSO CPRR" : "Running cost / test — KSO"}
          nilai={ada ? fmtRp(hasil.sellPerTest) : "—"}
          keterangan={
            <>
              {analyzer.brand ?? analyzer.label}
              {capex.totalTest > 0 ? ` · ${fmtNum(capex.totalTest)} test · ${s.kso} bulan` : ""}
              {" — "}
              {isCprr
                ? `real test/${stability} hari: ${fmtNum(hasil.realPerMasaPakai)} · residu ${fmtNum(hasil.residu)} · kapasitas kit ${fmtNum(hasil.kapasitasKit)}`
                : "HPP = nett ÷ kapasitas kit · residu ditanggung faskes"}
            </>
          }
          pills={[
            { label: "CAPEX/test", value: fmtRp(capex.perTest), tone: "biaya" },
            { label: "HPP cartridge/test", value: ada ? fmtRp(hasil.hppPerTest) : "—" },
            ...(isCprr && hasil.overheadQc > 0
              ? [{ label: "QC/test", value: fmtRp(hasil.overheadQc), tone: "peringatan" as const }]
              : []),
            { label: "Base cost", value: ada ? fmtRp(hasil.baseCost) : "—" },
            {
              label: `Markup ${s.markup}%`,
              value: ada ? fmtRp(hasil.sellPerTest - hasil.baseCost) : "—",
              tone: "sorot" as const,
            },
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle>Rincian cost / test — {analyzer.label}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Test realistis = (test/bulan ÷ 30 hari) × {stability} hari masa pakai cartridge. Kalau angka
              itu di bawah kapasitas kit, selisihnya terbuang — di skema CPRR selisih itu masuk harga.
            </p>
            {ada ? (
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
                    <TableHead>Komponen</TableHead>
                    <TableHead className="hidden sm:table-cell">Keterangan</TableHead>
                    <TableHead className="text-right">Per test</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">HPP cartridge (kit penuh)</TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                      {fmtRp(hasil.nettCartridge)} ÷ {fmtNum(hasil.kapasitasKit)} test
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtRp(hasil.hppPenuh)}</TableCell>
                  </TableRow>
                  {hasil.hppResidu > 0 ? (
                    <TableRow>
                      <TableCell>Tambahan akibat residu</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                        hanya {fmtNum(hasil.testEfektif)} test terpakai sebelum kedaluwarsa
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-500">
                        {fmtRp(hasil.hppResidu)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {isCprr && hasil.overheadQc > 0 ? (
                    <TableRow>
                      <TableCell>QC</TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                        {nQc}× per cartridge, dibagi {fmtNum(hasil.testEfektif)} test efektif
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-500">
                        {fmtRp(hasil.overheadQc)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  <TableRow>
                    <TableCell className="text-destructive">+ CAPEX / test</TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                      {fmtRp(capex.total)} ÷ {fmtNum(capex.totalTest)} test KSO
                    </TableCell>
                    <TableCell className="text-destructive text-right font-semibold tabular-nums">
                      {fmtRp(capex.perTest)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={2} className="font-medium">Base cost / test</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtRp(hasil.baseCost)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-primary/5">
                    <TableCell colSpan={2} className="font-semibold">
                      {isCprr ? "Cost / test KSO CPRR" : "Running cost / test KSO"}{" "}
                      <span className="text-muted-foreground text-xs font-normal">margin {s.markup}%</span>
                    </TableCell>
                    <TableCell className="text-primary text-right text-base font-bold tabular-nums">
                      {ada ? fmtRp(hasil.sellPerTest) : "—"}
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
        label="Skema"
        value={mode}
        options={[
          { key: "cprr" as const, label: "CPRR (residu di WRG)" },
          { key: "kso" as const, label: "KSO (faskes beli cartridge)" },
        ]}
        onChange={setMode}
      />
      <PilihanBaris
        label="Cartridge"
        value={s.cartKode}
        options={cartridges.map((c) => ({ key: c.kode, label: c.pack ?? c.kode }))}
        onChange={(v) => upd({ cartKode: v })}
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
              <Stat label={`Test realistis / ${stability} hari`} value={ada ? fmtNum(hasil.realPerMasaPakai) : "—"} />
              <Stat label="Kapasitas kit" value={fmtNum(hasil.kapasitasKit)} />
              <Stat label="Residu (terbuang)" value={ada ? fmtNum(hasil.residu) : "—"} tone={hasil.residu > 0 ? "peringatan" : "netral"} />
              <Stat label="CAPEX / test" value={fmtRp(capex.perTest)} tone="biaya" />
              <Stat label="HPP cartridge / test" value={ada ? fmtRp(hasil.hppPerTest) : "—"} />
              {isCprr && hasil.overheadQc > 0 ? (
                <Stat label="QC / test" value={fmtRp(hasil.overheadQc)} tone="peringatan" />
              ) : null}
              <Stat label="Harga jual / test" value={ada ? fmtRp(hasil.sellPerTest) : "—"} tone="sorot" kuat />
            </div>
            <Button className="w-full" onClick={keHasil} disabled={!ada}>
              Lihat hasil perhitungan
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Harga cartridge &amp; QC</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {cartridges.map((c) => {
              const h = hargaCart[c.kode] ?? { price: 0, disc: 0 };
              return (
                <HargaDiskon
                  key={c.kode}
                  label={`${c.nama} — ${c.pack ?? ""}${c.kode === s.cartKode ? " · dipakai" : ""}`}
                  price={h.price} disc={h.disc}
                  onPrice={(v) => setHargaCart((p) => ({ ...p, [c.kode]: { ...p[c.kode], price: v } }))}
                  onDisc={(v) => setHargaCart((p) => ({ ...p, [c.kode]: { ...p[c.kode], disc: v } }))}
                  nett={nettOf(h)}
                />
              );
            })}

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
              {qcItem ? (
                <HargaDiskon
                  label={`${qcItem.nama} — ${qcItem.pack ?? ""}`}
                  price={hargaQc.price} disc={hargaQc.disc}
                  onPrice={(v) => setHargaQc((p) => ({ ...p, price: v }))}
                  onDisc={(v) => setHargaQc((p) => ({ ...p, disc: v }))}
                  nett={nettOf(hargaQc)}
                />
              ) : null}
              <AngkaField label="Jumlah QC per cartridge" value={nQc} onChange={setNQc} suffix="kali" />
              {!isCprr ? (
                <p className="text-muted-foreground text-[11px]">
                  Di skema KSO, QC tidak dibebankan ke harga per test — faskes menanggungnya bersama
                  cartridge.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
