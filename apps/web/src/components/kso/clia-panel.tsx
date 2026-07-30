"use client";

// Kategori CLIA — Snibe Maglumi X3 (310 parameter) & Wondfo (56 parameter).
//
// Consumable-nya dihitung per TEST langsung (starter kit, wash, cuvette, light
// check: semuanya "N test per kemasan"), bukan lewat rumus batch seperti Kimia
// Klinik. Yang bikin beda: di Wondfo, parameter INFEKSIUS memakai intensive wash
// buffer, jadi beban consumable-nya lebih tinggi dari parameter lain di alat yang
// sama — itu sebabnya ada dua angka consumable.
//
// Daftar parameternya panjang (310 baris untuk Snibe), jadi editornya diberi
// filter panel + pencarian. Aplikasi asal merender semuanya sekaligus; di layar
// selebar laptop itu berarti menggulir ratusan baris untuk mengubah satu harga.

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AngkaField, AngkaMini, HeroBiaya, KartuCapex, PilihanBaris, Stat, fmtNum, fmtRp,
} from "@/components/kso/shared";
import { exportDokumen } from "@/lib/kso/export-excel";
import { hitungCapex, hitungClia, type ConsInput } from "@/lib/kso/model";
import { printDokumen } from "@/lib/kso/print-pdf";
import type { HargaInput, KsoAnalyzer, KsoParameter } from "@/lib/kso/types";

import { PresetTest } from "./hemato-panel";
import type { Umum } from "./kso-view";

interface SetClia {
  price: number;
  disc: number;
  kso: number;
  markup: number;
  tests: number;
}

const setAwal = (a: KsoAnalyzer): SetClia => ({
  price: a.defaultCapex,
  disc: 0,
  kso: a.defaultKsoBulan,
  markup: a.defaultMarkup,
  tests: 0,
});

const consAwal = (a: KsoAnalyzer): Record<string, ConsInput> =>
  Object.fromEntries(
    a.reagents.map((r) => [r.kode, { price: r.hargaDp ?? 0, disc: 0, yieldTest: r.yieldTest ?? 0 }]),
  );

const hargaParamAwal = (rows: KsoParameter[]): Record<number, HargaInput> =>
  Object.fromEntries(rows.map((p) => [p.no, { price: p.hargaDp ?? 0, disc: 0 }]));

export function CliaPanel({
  analyzers, parameters, panels, umum, setUmum, halaman, keHasil,
}: {
  analyzers: KsoAnalyzer[];
  /** Seluruh parameter CLIA (grup SNIBE + WONDFO). */
  parameters: KsoParameter[];
  /** Urutan panel per grup. */
  panels: { grup: string; nama: string }[];
  umum: Umum;
  setUmum: (patch: Partial<Umum>) => void;
  halaman: "input" | "hasil";
  keHasil: () => void;
}) {
  const [kode, setKode] = useState(analyzers[0]?.kode ?? "");
  const analyzer = analyzers.find((a) => a.kode === kode) ?? analyzers[0];
  const grup = analyzer?.kode ?? "";

  const [set, setSet] = useState<Record<string, SetClia>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, setAwal(a)])),
  );
  const [cons, setCons] = useState<Record<string, Record<string, ConsInput>>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, consAwal(a)])),
  );
  const [consFree, setConsFree] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, false])),
  );
  const [hargaParam, setHargaParam] = useState<Record<number, HargaInput>>(() =>
    hargaParamAwal(parameters),
  );
  /** Parameter yang dikecualikan dari penawaran (setara "hapus" di aplikasi asal). */
  const [dikecualikan, setDikecualikan] = useState<Set<string>>(() => new Set());
  const [filterPanel, setFilterPanel] = useState("");
  const [cari, setCari] = useState("");

  const s = set[grup] ?? setAwal(analyzer);
  const upd = (patch: Partial<SetClia>) => setSet((p) => ({ ...p, [grup]: { ...p[grup], ...patch } }));

  const panelGrup = useMemo(
    () => panels.filter((p) => p.grup === grup).map((p) => p.nama),
    [panels, grup],
  );

  // Urut sesuai urutan panel, seperti sumber — bukan urutan nomor parameter.
  const paramAktif = useMemo(() => {
    const milik = parameters.filter(
      (p) => p.grup === grup && !dikecualikan.has(`${grup}_${p.no}`),
    );
    const urut = new Map(panelGrup.map((n, i) => [n, i]));
    return [...milik].sort(
      (a, b) => (urut.get(a.panel ?? "") ?? 999) - (urut.get(b.panel ?? "") ?? 999) || a.no - b.no,
    );
  }, [parameters, grup, dikecualikan, panelGrup]);

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
        ? hitungClia(
            analyzer, paramAktif, hargaParam,
            cons[grup] ?? {}, consFree[grup] ?? false,
            capex, s.markup,
          )
        : null,
    [analyzer, paramAktif, hargaParam, cons, consFree, grup, capex, s.markup],
  );

  if (!analyzer || !hasil) {
    return <EmptyState title="Master CLIA kosong" description="Jalankan importer master KSO." />;
  }

  const adaAngka = hasil.rows.length > 0 && (capex.perTest > 0 || hasil.consBase > 0);
  const dokumen = {
    judul: "KSO CPRR — CLIA",
    sheet: "CLIA",
    ringkas: {
      analyzerName: analyzer.brand ?? analyzer.label,
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
    catatan: [
      { label: "Parameter ditawarkan", value: `${hasil.rows.length} parameter` },
      { label: "Consumable", value: (consFree[grup] ?? false) ? "FREE — supplier" : "PAID — dihitung" },
    ],
    biaya: [
      { label: "CAPEX / test", value: capex.perTest },
      { label: "Consumable / test", value: hasil.consBase },
      ...(hasil.consInfeksius > hasil.consBase
        ? [{ label: "Consumable / test (parameter infeksius)", value: hasil.consInfeksius }]
        : []),
      { label: "Rata-rata reagen / test", value: hasil.avgReagenPerTest },
      { label: "Base cost rata-rata / test", value: hasil.avgBaseCost },
      { label: "CPRR rata-rata (harga jual / test)", value: hasil.avgSellPerTest, sorot: true },
    ],
    tabel: {
      judul: "Rincian parameter",
      header: ["Parameter", "Panel", "Test/kit", "Reagen / test", "Sell / test", "Sell / kit"],
      rows: hasil.rows.map((r) => [
        r.nama, r.panel, r.kit ? `${fmtNum(r.kit)}T` : "—",
        fmtRp(r.hppPerTest), fmtRp(r.sellTest), fmtRp(r.sellKit),
      ]),
    },
  };

  if (halaman === "hasil") {
    return (
      <div className="space-y-4">
        <HeroBiaya
          judul="Cost / Test — KSO CPRR"
          nilai={adaAngka ? fmtRp(hasil.avgSellPerTest) : "—"}
          keterangan={
            <>
              {analyzer.brand ?? analyzer.label}
              {s.tests > 0 ? ` · ${fmtNum(s.tests)} test/bln` : ""}
              {s.kso > 0 ? ` · ${s.kso} bulan` : ""}
              {" — "}rata-rata dari {hasil.rows.length} parameter; reagen tiap parameter berbeda.
            </>
          }
          pills={[
            { label: "CAPEX/test", value: fmtRp(capex.perTest), tone: "biaya" },
            { label: "Consumable/test", value: fmtRp(hasil.consBase) },
            ...(hasil.consInfeksius > hasil.consBase
              ? [{ label: "Consumable infeksius", value: fmtRp(hasil.consInfeksius), tone: "peringatan" as const }]
              : []),
            { label: "Rata-rata reagen/test", value: fmtRp(hasil.avgReagenPerTest) },
            {
              label: `Markup ${s.markup}%`,
              value: adaAngka ? fmtRp(hasil.avgSellPerTest - hasil.avgBaseCost) : "—",
              tone: "sorot" as const,
            },
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle>Rincian parameter — {analyzer.label}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Sell/test = (CAPEX + consumable + reagen parameter) ÷ (1 − markup) · Sell/kit = sell/test ×
              test per kit. Nama parameter bisa muncul dua kali: kemasan 50T dan 100T harganya beda.
            </p>
            {adaAngka ? (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => void exportDokumen(dokumen)}>Cetak Excel</Button>
                <Button variant="outline" size="sm" onClick={() => printDokumen(dokumen)}>Cetak PDF</Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="max-h-[36rem] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">No</TableHead>
                    <TableHead>Parameter</TableHead>
                    <TableHead className="hidden md:table-cell">Panel</TableHead>
                    <TableHead className="text-right">Test/kit</TableHead>
                    <TableHead className="text-right">Reagen / test</TableHead>
                    <TableHead className="text-right">Sell / test</TableHead>
                    <TableHead className="text-right">Sell / kit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hasil.rows.map((r, i) => (
                    <TableRow key={`${r.no}`}>
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">
                        {r.nama}
                        {r.infeksius ? (
                          <Badge variant="secondary" className="ml-2">infeksius</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs md:table-cell">{r.panel}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.kit ? `${fmtNum(r.kit)}T` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtRp(r.hppPerTest)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{fmtRp(r.sellTest)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtRp(r.sellKit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tampil = paramAktif.filter(
    (p) =>
      (!filterPanel || p.panel === filterPanel) &&
      (!cari.trim() || p.nama.toLowerCase().includes(cari.trim().toLowerCase())),
  );
  const consNow = cons[grup] ?? {};

  return (
    <div className="space-y-4">
      <PilihanBaris
        label="Pilih platform"
        value={analyzer.kode}
        options={analyzers.map((a) => ({ key: a.kode, label: a.label, sub: a.brand ?? undefined }))}
        onChange={setKode}
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
              <Stat label="Consumable / test" value={fmtRp(hasil.consBase)} />
              {hasil.consInfeksius > hasil.consBase ? (
                <Stat label="Consumable / test (infeksius)" value={fmtRp(hasil.consInfeksius)} tone="peringatan" />
              ) : null}
              <Stat label="Parameter ditawarkan" value={fmtNum(hasil.rows.length)} />
              <Stat label="Rata-rata harga jual / test" value={adaAngka ? fmtRp(hasil.avgSellPerTest) : "—"} tone="sorot" kuat />
            </div>
            <Button className="w-full" onClick={keHasil} disabled={!adaAngka}>
              Lihat hasil perhitungan
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Consumable</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <PilihanBaris
              value={(consFree[grup] ?? false) ? "free" : "hitung"}
              options={[
                { key: "hitung", label: "Dihitung" },
                { key: "free", label: "Free (ditanggung supplier)" },
              ]}
              onChange={(v) => setConsFree((p) => ({ ...p, [grup]: v === "free" }))}
            />
            {analyzer.reagents.map((r) => {
              const c = consNow[r.kode] ?? { price: 0, disc: 0, yieldTest: 0 };
              const inf = r.flags?.inf === true;
              return (
                <div key={r.kode} className="space-y-1.5">
                  <div className="text-xs font-semibold">
                    {r.nama}
                    {inf ? <Badge variant="secondary" className="ml-2">intensive wash</Badge> : null}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <AngkaField
                      label="Harga"
                      value={c.price}
                      onChange={(v) => setCons((p) => ({ ...p, [grup]: { ...p[grup], [r.kode]: { ...c, price: v } } }))}
                      prefix="Rp"
                    />
                    <AngkaField
                      label="Diskon"
                      value={c.disc}
                      onChange={(v) => setCons((p) => ({ ...p, [grup]: { ...p[grup], [r.kode]: { ...c, disc: v } } }))}
                      suffix="%"
                    />
                    <AngkaField
                      label="Hasil"
                      value={c.yieldTest}
                      onChange={(v) => setCons((p) => ({ ...p, [grup]: { ...p[grup], [r.kode]: { ...c, yieldTest: v } } }))}
                      suffix="test"
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-muted-foreground text-[11px]">
              Kolom <strong>Hasil</strong> = berapa test yang keluar dari satu kemasan. Itu yang membagi
              harga jadi beban per test.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Harga parameter ({fmtNum(paramAktif.length)} aktif dari {fmtNum(parameters.filter((p) => p.grup === grup).length)})</CardTitle>
          <p className="text-muted-foreground text-xs">
            Hilangkan centang untuk mengeluarkan parameter dari penawaran — parameter yang dikecualikan
            tidak ikut menghitung rata-rata harga jual.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Input
              placeholder="Cari parameter…"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              className="bg-card max-w-xs"
            />
            <select
              value={filterPanel}
              onChange={(e) => setFilterPanel(e.target.value)}
              className="border-input bg-card h-8 rounded-lg border px-2 text-sm"
            >
              <option value="">Semua panel</option>
              {panelGrup.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[32rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Pakai</TableHead>
                  <TableHead>Parameter</TableHead>
                  <TableHead className="hidden md:table-cell">Panel</TableHead>
                  <TableHead className="text-right">Test/kit</TableHead>
                  <TableHead className="w-32 text-right">Harga beli</TableHead>
                  <TableHead className="w-20 text-right">Disc %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tampil.map((p) => {
                  const h = hargaParam[p.no] ?? { price: 0, disc: 0 };
                  const key = `${grup}_${p.no}`;
                  return (
                    <TableRow key={p.no}>
                      <TableCell>
                        <Checkbox
                          checked={!dikecualikan.has(key)}
                          onCheckedChange={(v) =>
                            setDikecualikan((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {p.nama}
                        {p.flags?.inf === true ? (
                          <Badge variant="secondary" className="ml-2">infeksius</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs md:table-cell">{p.panel}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.testsPerKit ? `${fmtNum(p.testsPerKit)}T` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <AngkaMini
                          value={h.price}
                          onChange={(v) => setHargaParam((prev) => ({ ...prev, [p.no]: { ...h, price: v } }))}
                          lebar="w-28"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <AngkaMini
                          value={h.disc}
                          onChange={(v) => setHargaParam((prev) => ({ ...prev, [p.no]: { ...h, disc: v } }))}
                          lebar="w-16"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
