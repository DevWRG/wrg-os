"use client";

// Kategori Hematologi — input (CAPEX, skema KSO, harga reagen, kontrol) dan
// hasil (harga jual per test + rincian kontribusi tiap reagen).

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AngkaField, AngkaMini, HeroBiaya, PilihanBaris, Stat, fmtNum, fmtRp } from "@/components/kso/shared";
import type { ExzMode } from "@/lib/kso/formula";
import { hitungCapex, hitungHemato, nettOf, type KontrolInput } from "@/lib/kso/model";
import type { HargaInput, KsoAnalyzer } from "@/lib/kso/types";

import type { Umum } from "./kso-view";

/** Setelan per analyzer — tiap alat punya angkanya sendiri, tidak saling timpa. */
interface SetHemato {
  price: number;
  disc: number;
  kso: number;
  markup: number;
  tests: number;
}

const setAwal = (a: KsoAnalyzer): SetHemato => ({
  // Titik berangkat = harga price-list kalau ada; itu yang dipakai sales saat
  // menyusun diskon, bukan harga distributor.
  price: a.defaultCapexPl ?? a.defaultCapex,
  disc: 0,
  kso: 0,
  markup: 0,
  tests: 0,
});

const hargaAwal = (a: KsoAnalyzer): Record<string, HargaInput> =>
  Object.fromEntries(a.reagents.map((r) => [r.kode, { price: r.hargaPl ?? r.hargaDp ?? 0, disc: 0 }]));

const kontrolAwal = (a: KsoAnalyzer): KontrolInput => ({
  free: true,
  nQc: 0,
  nCal: 0,
  ctrl: { price: a.meta.ctrlPl ?? a.meta.xnCtrlPl ?? 0, disc: 0 },
  cal: { price: a.meta.calPl ?? 0, disc: 0 },
});

const HARGA_KOSONG: Record<string, HargaInput> = {};

const MODE_EXZ: { key: ExzMode; label: string }[] = [
  { key: "cbc_diff_ret", label: "CBC+Diff+RET" },
  { key: "cbc_diff_xn", label: "CBC+Diff + Cek XN" },
  { key: "cbc_diff_ret_xr", label: "CBC+Diff+RET + Cek XR" },
];

export function HematoPanel({
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

  const [set, setSet] = useState<Record<string, SetHemato>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, setAwal(a)])),
  );
  const [harga, setHarga] = useState<Record<string, Record<string, HargaInput>>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, hargaAwal(a)])),
  );
  const [kontrol, setKontrol] = useState<Record<string, KontrolInput>>(() =>
    Object.fromEntries(analyzers.map((a) => [a.kode, kontrolAwal(a)])),
  );
  const [exzMode, setExzMode] = useState<ExzMode>("cbc_diff_ret");

  const s = set[analyzer?.kode ?? ""] ?? setAwal(analyzer);
  // Fallback-nya konstanta modul, bukan objek literal: literal bikin identitas
  // baru tiap render dan seluruh useMemo di bawah ikut dihitung ulang.
  const hargaNow = harga[analyzer?.kode ?? ""] ?? HARGA_KOSONG;
  const kontrolNow = useMemo(
    () => kontrol[analyzer?.kode ?? ""] ?? kontrolAwal(analyzer),
    [kontrol, analyzer],
  );

  const upd = (patch: Partial<SetHemato>) =>
    setSet((p) => ({ ...p, [analyzer.kode]: { ...p[analyzer.kode], ...patch } }));
  const updHarga = (kodeReagen: string, patch: Partial<HargaInput>) =>
    setHarga((p) => ({
      ...p,
      [analyzer.kode]: {
        ...p[analyzer.kode],
        [kodeReagen]: { ...p[analyzer.kode][kodeReagen], ...patch },
      },
    }));
  const updKontrol = (patch: Partial<KontrolInput>) =>
    setKontrol((p) => ({ ...p, [analyzer.kode]: { ...p[analyzer.kode], ...patch } }));

  const backupAnalyzer = analyzers.find((a) => a.kode === umum.backupKode) ?? null;

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
        ? hitungHemato(analyzer, hargaNow, capex, s.tests, umum.workDays, s.markup, kontrolNow, exzMode)
        : null,
    [analyzer, hargaNow, capex, s.tests, s.markup, umum.workDays, kontrolNow, exzMode],
  );

  if (!analyzer || !hasil) {
    return <EmptyState title="Master hematologi kosong" description="Jalankan importer master KSO." />;
  }

  const isExz8000 = analyzer.kode === "EXZ8000";
  const modeLabel = isExz8000 ? MODE_EXZ.find((m) => m.key === exzMode)?.label : null;
  const judulAlat = `${analyzer.label}${analyzer.meta.diff ? ` · ${analyzer.meta.diff}` : ""}${modeLabel ? ` · ${modeLabel}` : ""}`;

  if (halaman === "hasil") {
    return (
      <div className="space-y-4">
        {isExz8000 ? (
          <PilihanBaris label="Mode test" value={exzMode} options={MODE_EXZ} onChange={setExzMode} />
        ) : null}

        <HeroBiaya
          judul="Cost / Test — KSO CPRR"
          nilai={hasil.reagen ? fmtRp(hasil.sellPerTest) : "—"}
          keterangan={
            <>
              {judulAlat}
              {capex.totalTest > 0 ? ` · ${fmtNum(capex.totalTest)} test · ${s.kso} bulan` : ""}
              {capex.D > 0 ? ` · ${fmtNum(capex.D)} test/hari` : ""}
            </>
          }
          pills={[
            { label: "CAPEX/test", value: fmtRp(capex.perTest), tone: "biaya" },
            { label: "Reagen/test", value: hasil.reagen ? fmtRp(hasil.reagenPerTest) : "—" },
            ...(hasil.overheadKontrol > 0
              ? [{ label: "QC+Cal/test", value: fmtRp(hasil.overheadKontrol), tone: "peringatan" as const }]
              : []),
            { label: "Base cost", value: fmtRp(hasil.baseCost) },
            {
              label: `Markup ${s.markup}%`,
              value: hasil.reagen ? fmtRp(hasil.sellPerTest - hasil.baseCost) : "—",
              tone: "sorot" as const,
            },
          ]}
        />

        <Card>
          <CardHeader>
            <CardTitle>Rincian reagen — {judulAlat}</CardTitle>
            <p className="text-muted-foreground text-xs">
              Kolom <strong>Harga KSO di Excel</strong> = harga per kemasan yang harus diketik ke file
              running cost Excel pabrikan supaya hasilnya sama dengan angka KSO CPRR di atas. Itu bukan
              harga penawaran ke faskes.
            </p>
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
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">
                        {r.pack}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hasil.reagen ? fmtNum(r.kontribusiTest) : "—"}
                      </TableCell>
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
                    <TableCell colSpan={2} className="font-medium">Total biaya reagen / test</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {hasil.reagen ? fmtNum(hasil.reagenPerTest) : "—"}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={2} className="text-destructive">
                      + CAPEX / test{" "}
                      <span className="text-muted-foreground text-xs font-normal">
                        (alat + UPS + LIS ÷ {fmtNum(capex.totalTest)} test KSO)
                      </span>
                    </TableCell>
                    <TableCell className="text-destructive text-right font-semibold tabular-nums">
                      {fmtRp(capex.perTest)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={2} className="font-medium">Base cost / test (sebelum markup)</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtRp(hasil.baseCost)}
                    </TableCell>
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

  // ── Halaman input ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PilihanBaris
        label="Pilih analyzer"
        value={analyzer.kode}
        options={analyzers.map((a) => ({ key: a.kode, label: a.label, sub: a.meta.diff }))}
        onChange={setKode}
      />

      <PresetTest presets={analyzer.presets} value={s.tests} onChange={(v) => upd({ tests: v })} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* CAPEX */}
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
                    // Ikutkan harga default alat yang dipilih supaya tidak mulai dari 0.
                    ...(v === true && !umum.backupKode
                      ? {
                          backupKode: analyzer.kode,
                          backupPrice: analyzer.defaultCapexPl ?? analyzer.defaultCapex,
                        }
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
                      backupDisc: b ? b.defaultDisc : umum.backupDisc,
                    });
                  }}
                />
                <AngkaField label="Harga backup" value={umum.backupPrice} onChange={(v) => setUmum({ backupPrice: v })} prefix="Rp" />
                <AngkaField label="Diskon backup" value={umum.backupDisc} onChange={(v) => setUmum({ backupDisc: v })} suffix="%" />
                <Stat label={`Nett backup${backupAnalyzer ? ` (${backupAnalyzer.label})` : ""}`} value={fmtRp(capex.nettBackup)} />
              </div>
            ) : null}

            <Stat label="Total CAPEX" value={fmtRp(capex.total)} kuat />
          </CardContent>
        </Card>

        {/* Skema KSO */}
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
              {hasil.overheadKontrol > 0 ? (
                <Stat label="Kontrol + cal / test" value={fmtRp(hasil.overheadKontrol)} tone="peringatan" />
              ) : null}
              <Stat label="Harga jual / test" value={fmtRp(hasil.sellPerTest)} tone="sorot" kuat />
            </div>

            <Button className="w-full" onClick={keHasil} disabled={!hasil.reagen}>
              Lihat hasil perhitungan
            </Button>
            {!hasil.reagen ? (
              <p className="text-muted-foreground text-xs">
                Isi test/bulan dan hari kerja dulu — tanpa keduanya biaya harian tidak bisa dibagi.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Harga reagen + kontrol */}
        <Card>
          <CardHeader><CardTitle>Harga reagen (price list)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {analyzer.reagents
              .filter((r) => r.jenis === "reagent" || r.jenis === "consumable")
              .map((r) => {
                const h = hargaNow[r.kode] ?? { price: 0, disc: 0 };
                return (
                  <div key={r.kode} className="space-y-1.5">
                    <div className="text-xs font-semibold">{r.nama}</div>
                    <div className="text-muted-foreground text-[11px]">{r.pack}</div>
                    <div className="grid grid-cols-[1fr_5rem] gap-2">
                      <AngkaField label="Harga / kemasan" value={h.price} onChange={(v) => updHarga(r.kode, { price: v })} prefix="Rp" />
                      <AngkaField label="Diskon" value={h.disc} onChange={(v) => updHarga(r.kode, { disc: v })} suffix="%" />
                    </div>
                    <div className="text-muted-foreground text-right text-[11px]">
                      Nett: <span className="text-foreground font-semibold">{fmtRp(nettOf(h))}</span>
                    </div>
                  </div>
                );
              })}

            <div className="space-y-3 border-t pt-3">
              <div className="text-xs font-semibold tracking-wide uppercase">Kontrol &amp; kalibrator</div>
              <PilihanBaris
                value={kontrolNow.free ? "free" : "beli"}
                options={[
                  { key: "free", label: "Free (overhead)" },
                  { key: "beli", label: "Beli (price list)" },
                ]}
                onChange={(v) => updKontrol({ free: v === "free" })}
              />
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <AngkaField
                  label={isExz8000 ? "Harga control (XN/XR)" : "Harga kontrol"}
                  value={kontrolNow.ctrl.price}
                  onChange={(v) => updKontrol({ ctrl: { ...kontrolNow.ctrl, price: v } })}
                  prefix="Rp"
                />
                <AngkaField
                  label="Diskon"
                  value={kontrolNow.ctrl.disc}
                  onChange={(v) => updKontrol({ ctrl: { ...kontrolNow.ctrl, disc: v } })}
                  suffix="%"
                />
              </div>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <AngkaField
                  label="Harga kalibrator"
                  value={kontrolNow.cal.price}
                  onChange={(v) => updKontrol({ cal: { ...kontrolNow.cal, price: v } })}
                  prefix="Rp"
                />
                <AngkaField
                  label="Diskon"
                  value={kontrolNow.cal.disc}
                  onChange={(v) => updKontrol({ cal: { ...kontrolNow.cal, disc: v } })}
                  suffix="%"
                />
              </div>

              {kontrolNow.free ? (
                <div className="bg-muted/40 space-y-2 rounded-lg p-3">
                  <div className="text-muted-foreground text-[10px] font-bold tracking-wide uppercase">
                    Pengaturan QC &amp; kalibrasi
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-2 text-xs">
                      QC / hari
                      <AngkaMini value={kontrolNow.nQc} onChange={(v) => updKontrol({ nQc: v })} lebar="w-16" />
                      run
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      {isExz8000 ? "Kalibrasi / 25 hari" : "Kalibrasi / bulan"}
                      <AngkaMini value={kontrolNow.nCal} onChange={(v) => updKontrol({ nCal: v })} lebar="w-16" />
                      kali
                    </span>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Material kontrol ditanggung vendor, tapi tiap run tetap menghabiskan reagen — itu yang
                    masuk ke biaya per test.
                  </p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function PresetTest({
  presets, value, onChange, label = "Preset test/bulan",
}: {
  presets: number[];
  value: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  if (presets.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{label}</span>
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {presets.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={
              value === v
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium tabular-nums"
                : "hover:bg-muted rounded-md px-3 py-1.5 text-sm font-medium tabular-nums"
            }
          >
            {fmtNum(v)}
          </button>
        ))}
      </div>
    </div>
  );
}
