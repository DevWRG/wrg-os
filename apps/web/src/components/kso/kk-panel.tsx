"use client";

// Kategori Kimia Klinik (EXC200 / EXC400).
//
// Bentuknya beda dari hematologi: satu sampel diperiksa untuk banyak parameter,
// tiap parameter punya reagen & harga sendiri. Jadi yang dihitung bukan satu
// "harga per test", tapi beban tetap per sampel (alat + detergent + QC) yang
// dipikul semua parameter, lalu harga jual per parameter di atasnya.

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
import { AngkaField, AngkaMini, HeroBiaya, PilihanBaris, Stat, fmtNum, fmtRp } from "@/components/kso/shared";
import { exportKk } from "@/lib/kso/export-excel";
import {
  PANEL_CONSUMABLE, PANEL_CONTROL, hitungCapex, hitungKk, paramKkAwal, type ParamKk,
} from "@/lib/kso/model";
import { printKk } from "@/lib/kso/print-pdf";
import type { KsoAnalyzer, KsoParameter } from "@/lib/kso/types";

import { PresetTest } from "./hemato-panel";
import type { Umum } from "./kso-view";

interface SetKk {
  price: number;
  disc: number;
  kso: number;
  markup: number;
  tests: number;
  /** Batch pemeriksaan per hari — penentu pemakaian detergent. */
  batch: number;
}

const setAwal = (a: KsoAnalyzer): SetKk => ({
  price: a.defaultCapexPl ?? a.defaultCapex,
  disc: 0,
  kso: 0,
  markup: 0,
  tests: 0,
  batch: 0,
});

export function KkPanel({
  analyzers, parameters, panels, umum, setUmum, halaman, keHasil,
}: {
  analyzers: KsoAnalyzer[];
  parameters: KsoParameter[];
  panels: string[];
  umum: Umum;
  setUmum: (patch: Partial<Umum>) => void;
  halaman: "input" | "hasil";
  keHasil: () => void;
}) {
  const [kode, setKode] = useState(analyzers[0]?.kode ?? "");
  const analyzer = analyzers.find((a) => a.kode === kode) ?? analyzers[0];

  const [set, setSet] = useState<Record<string, SetKk>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, setAwal(a)])),
  );
  // Parameter dipakai bersama kedua analyzer: reagennya sama, yang beda alatnya.
  const [params, setParams] = useState<ParamKk[]>(() => paramKkAwal(parameters));
  const [qc, setQc] = useState({ nCtrl: 0, nCal: 0 });

  const s = set[analyzer?.kode ?? ""] ?? setAwal(analyzer);
  const upd = (patch: Partial<SetKk>) =>
    setSet((p) => ({ ...p, [analyzer.kode]: { ...p[analyzer.kode], ...patch } }));
  const updParam = (id: string, patch: Partial<ParamKk>) =>
    setParams((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const hapusParam = (id: string) => setParams((ps) => ps.filter((p) => p.id !== id));

  const capex = useMemo(
    () =>
      hitungCapex({
        harga: { price: s.price, disc: s.disc },
        ups: umum.ups,
        lis: umum.lis,
        backup: umum.backupOn ? { price: umum.backupPrice, disc: umum.backupDisc } : null,
        ksoBulan: s.kso,
        testsPerMonth: s.tests,
        workDays: umum.workDays,
      }),
    [s, umum],
  );

  const hasil = useMemo(
    () =>
      analyzer
        ? hitungKk(analyzer.kode, params, capex, s.tests, umum.workDays, s.batch, s.markup, qc.nCtrl, qc.nCal)
        : null,
    [analyzer, params, capex, s.tests, s.batch, s.markup, umum.workDays, qc],
  );

  if (!analyzer || !hasil) {
    return <EmptyState title="Master kimia klinik kosong" description="Jalankan importer master KSO." />;
  }

  const adaAngka = capex.perTest > 0 || hasil.consumablePerTest > 0;

  const backupAnalyzer = analyzers.find((a) => a.kode === umum.backupKode) ?? null;
  const berkas = {
    ringkas: {
      analyzerName: analyzer.label,
      backupLabel: umum.backupOn && backupAnalyzer ? backupAnalyzer.label : "",
      totCap: capex.total,
      capex: { alat: capex.nettAlat, backup: capex.nettBackup, ups: umum.ups, lis: umum.lis },
      kso: s.kso,
      testsPerMonth: s.tests,
      totTest: capex.totalTest,
      workDays: umum.workDays,
      markup: s.markup,
    },
    info: {
      salesName: umum.salesName,
      faskesName: umum.faskesName,
      kotaKab: umum.kotaKab,
      kompetitor: umum.kompetitor,
    },
    capPerTest: capex.perTest,
    consumablePerTest: hasil.consumablePerTest,
    overheadTotal: hasil.overheadTotal,
    adaOverhead: hasil.adaOverhead,
    qcPerTest: hasil.qcPerTest,
    calPerTest: hasil.calPerTest,
    avgSellPerTest: hasil.avgSellPerTest,
    rows: hasil.rows,
    consumable: hasil.consumable,
  };

  if (halaman === "hasil") {
    return (
      <div className="space-y-4">
        <HeroBiaya
          judul="Cost / Test — KSO CPRR"
          nilai={adaAngka ? fmtRp(hasil.avgSellPerTest) : "—"}
          keterangan={
            <>
              {analyzer.label}
              {s.tests > 0 ? ` · ${fmtNum(s.tests)} sampel/bln` : ""}
              {s.kso > 0 ? ` · ${s.kso} bulan` : ""}
              {capex.D > 0 ? ` · ${fmtNum(capex.D)} sampel/hari` : ""}
              {" — "}
              rata-rata dari {hasil.jumlahParameter} parameter; reagen tiap parameter berbeda, lihat tabel.
            </>
          }
          pills={[
            { label: "CAPEX/test", value: fmtRp(capex.perTest), tone: "biaya" },
            { label: "Consumable/test", value: fmtRp(hasil.consumablePerTest) },
            ...(hasil.adaOverhead
              ? [{ label: "QC+Cal/test", value: fmtRp(hasil.overheadTotal), tone: "peringatan" as const }]
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
            <CardTitle>Rincian cost — {analyzer.label}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Sell/test = (beban alat + consumable + QC + reagen parameter) ÷ (1 − markup), dibulatkan ke
              atas kelipatan Rp 100 · Sell/kit = sell/test × test per kit.
            </p>
            {adaAngka ? (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => void exportKk(berkas)}>
                  Cetak Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => printKk(berkas)}>
                  Cetak PDF
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">No</TableHead>
                    <TableHead>Parameter</TableHead>
                    <TableHead className="hidden md:table-cell">Panel</TableHead>
                    <TableHead className="hidden lg:table-cell">Kemasan</TableHead>
                    <TableHead className="text-right">Test/kit</TableHead>
                    <TableHead className="text-right">Sell / test</TableHead>
                    <TableHead className="text-right">Sell / kit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hasil.rows.map((r, i) => (
                    <TableRow key={`${r.nama}-${i}`}>
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{r.nama}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="secondary">{r.panel}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">{r.pack}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.testsPerKit)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{fmtRp(r.sellTest)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtRp(r.sellKit)}</TableCell>
                    </TableRow>
                  ))}

                  {hasil.consumable.map((c) => (
                    <TableRow key={c.nama} className="bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={4}>{c.nama} — beban / test</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtRp(c.perTest)}</TableCell>
                      <TableCell />
                    </TableRow>
                  ))}

                  {hasil.adaOverhead ? (
                    <>
                      <TableRow className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={4}>QC control / test</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-500">
                          {fmtRp(hasil.qcPerTest)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                      <TableRow className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={4}>Kalibrasi / test</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-500">
                          {fmtRp(hasil.calPerTest)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </>
                  ) : null}

                  <TableRow className="bg-primary/5">
                    <TableCell />
                    <TableCell colSpan={4} className="font-semibold">
                      Rata-rata cost / test KSO CPRR{" "}
                      <span className="text-muted-foreground text-xs font-normal">margin {s.markup}%</span>
                    </TableCell>
                    <TableCell className="text-primary text-right text-base font-bold tabular-nums">
                      {adaAngka ? fmtRp(hasil.avgSellPerTest) : "—"}
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

  // ── Halaman input ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PilihanBaris
        label="Pilih analyzer"
        value={analyzer.kode}
        options={analyzers.map((a) => ({ key: a.kode, label: a.label }))}
        onChange={setKode}
      />
      <PresetTest presets={analyzer.presets} value={s.tests} onChange={(v) => upd({ tests: v })} label="Preset sampel/bulan" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>CAPEX</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <AngkaField label="Harga analyzer" value={s.price} onChange={(v) => upd({ price: v })} prefix="Rp" />
            <AngkaField label="Diskon analyzer" value={s.disc} onChange={(v) => upd({ disc: v })} suffix="%" />
            <Stat label="Nett analyzer" value={fmtRp(capex.nettAlat)} />
            <AngkaField label="UPS" value={umum.ups} onChange={(v) => setUmum({ ups: v })} prefix="Rp" />
            <AngkaField label="LIS" value={umum.lis} onChange={(v) => setUmum({ lis: v })} prefix="Rp" />

            <label className="flex items-center gap-2 border-t pt-3 text-sm">
              <Checkbox
                checked={umum.backupOn}
                onCheckedChange={(v) =>
                  setUmum({
                    backupOn: v === true,
                    ...(v === true && !umum.backupKode
                      ? { backupKode: analyzer.kode, backupPrice: analyzer.defaultCapexPl ?? analyzer.defaultCapex }
                      : {}),
                  })
                }
              />
              Tambah analyzer backup
            </label>
            {umum.backupOn ? (
              <div className="space-y-3 rounded-lg border p-3">
                <PilihanBaris
                  value={umum.backupKode ?? analyzer.kode}
                  options={analyzers.map((a) => ({ key: a.kode, label: a.label }))}
                  onChange={(k) => {
                    const b = analyzers.find((a) => a.kode === k);
                    setUmum({
                      backupKode: k,
                      backupPrice: b ? (b.defaultCapexPl ?? b.defaultCapex) : umum.backupPrice,
                    });
                  }}
                />
                <AngkaField label="Harga backup" value={umum.backupPrice} onChange={(v) => setUmum({ backupPrice: v })} prefix="Rp" />
                <AngkaField label="Diskon backup" value={umum.backupDisc} onChange={(v) => setUmum({ backupDisc: v })} suffix="%" />
                <Stat label="Nett backup" value={fmtRp(capex.nettBackup)} />
              </div>
            ) : null}
            <Stat label="Total CAPEX" value={fmtRp(capex.total)} kuat />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Skema KSO</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <AngkaField label="Masa KSO" value={s.kso} onChange={(v) => upd({ kso: v })} suffix="bln" />
            <AngkaField label="Sampel / bulan" value={s.tests} onChange={(v) => upd({ tests: v })} />
            <AngkaField label="Hari kerja / bulan" value={umum.workDays} onChange={(v) => setUmum({ workDays: v })} suffix="hari" />
            <AngkaField label="Batch / hari" value={s.batch} onChange={(v) => upd({ batch: v })} suffix="sesi" />
            <AngkaField label="Margin / markup" value={s.markup} onChange={(v) => upd({ markup: v })} suffix="%" />

            <div className="border-t pt-2">
              <Stat label="Sampel / hari" value={capex.D > 0 ? fmtNum(capex.D) : "—"} />
              <Stat label="Total sampel KSO" value={capex.totalTest > 0 ? fmtNum(capex.totalTest) : "—"} />
              <Stat label="CAPEX / sampel" value={fmtRp(capex.perTest)} tone="biaya" />
              <Stat label="Consumable / sampel" value={fmtRp(hasil.consumablePerTest)} />
              {hasil.adaOverhead ? (
                <Stat label="QC + kalibrasi / sampel" value={fmtRp(hasil.overheadTotal)} tone="peringatan" />
              ) : null}
              <Stat label="Rata-rata harga jual / test" value={adaAngka ? fmtRp(hasil.avgSellPerTest) : "—"} tone="sorot" kuat />
            </div>

            <Button className="w-full" onClick={keHasil} disabled={!adaAngka}>
              Lihat hasil perhitungan
            </Button>
            <p className="text-muted-foreground text-xs">
              Batch/hari kosong dianggap 5 sesi. Pemakaian detergent mengikuti jumlah batch, bukan jumlah
              sampel — itu sebabnya angkanya ikut berubah saat batch diubah.
            </p>
          </CardContent>
        </Card>
      </div>

      <ParameterEditor
        params={params}
        panels={panels}
        qc={qc}
        setQc={setQc}
        onUbah={updParam}
        onHapus={hapusParam}
        onTambah={(p) => setParams((ps) => [...ps, p])}
      />
    </div>
  );
}

// ── Editor parameter ────────────────────────────────────────────────────────

function ParameterEditor({
  params, panels, qc, setQc, onUbah, onHapus, onTambah,
}: {
  params: ParamKk[];
  panels: string[];
  qc: { nCtrl: number; nCal: number };
  setQc: (v: { nCtrl: number; nCal: number }) => void;
  onUbah: (id: string, patch: Partial<ParamKk>) => void;
  onHapus: (id: string) => void;
  onTambah: (p: ParamKk) => void;
}) {
  const [baru, setBaru] = useState({ nama: "", panel: panels[0] ?? "Hepatic", pack: "", testsPerKit: 0, price: 0 });
  const adaKontrolFree = params.some((p) => p.panel === PANEL_CONTROL && p.free);

  const tambah = () => {
    if (!baru.nama.trim()) return;
    onTambah({
      id: `custom_${Date.now()}`,
      nama: baru.nama.trim(),
      panel: baru.panel,
      pack: baru.pack || null,
      testsPerKit: baru.testsPerKit,
      price: baru.price,
      disc: 0,
      free: baru.panel === PANEL_CONTROL,
      custom: true,
      kalibrator: false,
    });
    setBaru({ nama: "", panel: panels[0] ?? "Hepatic", pack: "", testsPerKit: 0, price: 0 });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parameter reagen</CardTitle>
        <p className="text-muted-foreground text-xs">
          Harga & diskon boleh diubah sesuai nego. Baris panel <strong>Control</strong> bisa ditandai
          <em> Free</em> (ditanggung vendor → jadi overhead) atau <em>Paid</em> (dijual terpisah, tidak
          dibebankan ke harga per test).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {panels.map((panel) => {
          const items = params.filter((p) => p.panel === panel);
          if (items.length === 0) return null;
          const isCtrl = panel === PANEL_CONTROL;
          return (
            <div key={panel} className="space-y-2">
              <Badge variant="secondary">{panel}</Badge>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead className="hidden lg:table-cell">Kemasan</TableHead>
                      <TableHead className="w-24 text-right">Test/kit</TableHead>
                      <TableHead className="w-32 text-right">Harga beli</TableHead>
                      <TableHead className="w-20 text-right">Disc %</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((p) => {
                      const bisaEdit = p.custom || isCtrl;
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">
                            {bisaEdit ? (
                              <Input
                                value={p.nama}
                                onChange={(e) => onUbah(p.id, { nama: e.target.value })}
                                className="bg-card h-7"
                              />
                            ) : (
                              p.nama
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                            {bisaEdit ? (
                              <Input
                                value={p.pack ?? ""}
                                onChange={(e) => onUbah(p.id, { pack: e.target.value })}
                                className="bg-card h-7"
                              />
                            ) : (
                              p.pack
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {bisaEdit ? (
                              <AngkaMini value={p.testsPerKit} onChange={(v) => onUbah(p.id, { testsPerKit: v })} lebar="w-20" />
                            ) : (
                              <span className="tabular-nums">{fmtNum(p.testsPerKit)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <AngkaMini value={p.price} onChange={(v) => onUbah(p.id, { price: v })} lebar="w-28" />
                          </TableCell>
                          <TableCell className="text-right">
                            <AngkaMini value={p.disc} onChange={(v) => onUbah(p.id, { disc: v })} lebar="w-16" />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              {isCtrl ? (
                                <button
                                  type="button"
                                  onClick={() => onUbah(p.id, { free: !p.free })}
                                  className={
                                    p.free
                                      ? "rounded-md border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-500"
                                      : "text-muted-foreground rounded-md border px-2 py-0.5 text-[11px] font-medium"
                                  }
                                >
                                  {p.free ? "Free" : "Paid"}
                                </button>
                              ) : null}
                              <Button variant="ghost" size="sm" onClick={() => onHapus(p.id)} aria-label={`Hapus ${p.nama}`}>
                                ×
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {isCtrl && adaKontrolFree ? (
                <div className="bg-muted/40 flex flex-wrap items-center gap-4 rounded-lg p-3">
                  <span className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
                    Pengaturan QC &amp; kalibrasi
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    Kontrol / hari
                    <AngkaMini value={qc.nCtrl} onChange={(v) => setQc({ ...qc, nCtrl: v })} lebar="w-16" />
                    kali
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    Kalibrasi / bulan
                    <AngkaMini value={qc.nCal} onChange={(v) => setQc({ ...qc, nCal: v })} lebar="w-16" />
                    kali
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_2fr_1fr_1fr_auto]">
          <Input
            placeholder="Nama parameter"
            value={baru.nama}
            onChange={(e) => setBaru((f) => ({ ...f, nama: e.target.value }))}
            className="bg-card"
          />
          <select
            value={baru.panel}
            onChange={(e) => setBaru((f) => ({ ...f, panel: e.target.value }))}
            className="border-input bg-card h-8 rounded-lg border px-2 text-sm"
          >
            {panels.filter((p) => p !== PANEL_CONSUMABLE).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <Input
            placeholder="Kemasan"
            value={baru.pack}
            onChange={(e) => setBaru((f) => ({ ...f, pack: e.target.value }))}
            className="bg-card"
          />
          <AngkaMini value={baru.testsPerKit} onChange={(v) => setBaru((f) => ({ ...f, testsPerKit: v }))} lebar="w-full" />
          <AngkaMini value={baru.price} onChange={(v) => setBaru((f) => ({ ...f, price: v }))} lebar="w-full" />
          <Button onClick={tambah} disabled={!baru.nama.trim()}>Tambah</Button>
        </div>
      </CardContent>
    </Card>
  );
}
