"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "@/components/ui/use-confirm";

import { ambil, type AlatKsoRingkas, type AsetTetapRow, type DaftarAset, type PasanganRekon, type PratinjauRekon } from "./types";

type Tab = "pasti" | "kandidat" | "tanpa";
const PAGE = 50;

// F34 fase 2 — penautan nomor KSO-n (Accurate) ↔ alat KSO (kunci: SN di catatan aset).
// Server hanya MENGUSULKAN: "pasti" boleh diterapkan massal, "kandidat" harus dikonfirmasi
// orang, sisanya ditautkan manual. Isinya memuat nama faskes → hanya untuk yang berizin lihat.
export function RekonKso({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [d, setD] = useState<PratinjauRekon | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pasti");
  const [page, setPage] = useState(0);
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [manual, setManual] = useState<AlatKsoRingkas | null>(null);
  const { confirm, dialog } = useConfirm();

  const muat = useCallback(async () => {
    try {
      setD(await ambil<PratinjauRekon>("/api/aset-tetap/rekon-kso"));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void muat(), 0);
    return () => clearTimeout(t);
  }, [muat]);

  const jalankan = async (url: string, body: unknown, ok: (r: Record<string, number>) => string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await ambil<Record<string, number>>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      setMsg(ok(r));
      setPilih(new Set());
      await muat();
      onChanged();
    } catch (e) {
      setMsg(`Gagal: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const terapkanPasti = () => confirm(
    {
      title: `Tautkan ${d?.ringkasan.pasti ?? 0} alat (peringkat pasti)?`,
      description: "SN sama persis, unik di kedua sisi, dan jenis alat sejalan. Bisa dibatalkan massal lewat “Batalkan tautan otomatis”.",
      confirmLabel: "Tautkan",
    },
    () => void jalankan("/api/aset-tetap/rekon-kso/terapkan", {}, (r) => `${r.diterapkan} tautan diterapkan${r.dilewati ? `, ${r.dilewati} dilewati` : ""}.`),
  );
  const batalkan = () => confirm(
    {
      title: "Batalkan semua tautan otomatis?",
      description: "Hanya tautan hasil otomatis. Tautan manual dan yang sudah dikonfirmasi tidak disentuh.",
      confirmLabel: "Batalkan",
      destructive: true,
    },
    () => void jalankan("/api/aset-tetap/rekon-kso/batalkan-otomatis", {}, (r) => `${r.dibatalkan} tautan otomatis dibatalkan.`),
  );
  const tautkanTerpilih = () => {
    const pilihan = [...pilih].map((k) => {
      const [a, s] = k.split("|");
      return { accurate_id: Number(a), kso_asset_id: Number(s) };
    });
    void jalankan(
      "/api/aset-tetap/rekon-kso/terapkan",
      { pilihan },
      (r) => `${r.diterapkan} tautan dikonfirmasi${r.dilewati ? `, ${r.dilewati} dilewati (aset/alat sudah dipakai pasangan lain)` : ""}.`,
    );
  };

  if (err) return <div className="text-destructive text-sm">Gagal memuat usulan penautan: {err}</div>;
  if (!d) return <div className="text-muted-foreground text-sm">Memuat usulan penautan alat KSO…</div>;

  const r = d.ringkasan;
  const daftar = tab === "pasti" ? d.pasti : tab === "kandidat" ? d.kandidat : null;
  const total = tab === "tanpa" ? d.kso_tanpa_pasangan.length : (daftar?.length ?? 0);
  const awal = page * PAGE;
  const ganti = (t: Tab) => { setTab(t); setPage(0); };
  const kunci = (p: PasanganRekon) => `${p.accurate_id}|${p.kso_asset_id}`;
  const perSumber = Object.entries(r.tertaut_per_sumber).map(([k, v]) => `${v} ${k}`).join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Penautan alat KSO ↔ nomor KSO-n</CardTitle>
        <p className="text-muted-foreground text-sm">
          Kunci pencocokan: SN di kolom catatan aset Accurate. Nama faskes tidak ada di Accurate, jadi faskes baru terlihat setelah aset tertaut.
          {perSumber ? ` Sudah tertaut: ${perSumber}.` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Ringkas label="Alat KSO tertaut" nilai={`${r.sudah_tertaut} / ${r.kso_aktif}`} sub={`${r.accurate_kso_aktif} aset KSO aktif di Accurate`} />
          <Ringkas label="Pasti" nilai={r.pasti} sub="siap ditautkan massal" />
          <Ringkas label="Kandidat" nilai={r.kandidat} sub="perlu dikonfirmasi orang" />
          <Ringkas label="Alat tanpa pasangan" nilai={r.kso_tanpa_pasangan} sub={`${r.accurate_tanpa_pasangan} aset Accurate tanpa usulan (UPS, CPU, printer, dll. wajar)`} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["pasti", "kandidat", "tanpa"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => ganti(t)}>
              {t === "pasti" ? `Pasti (${r.pasti})` : t === "kandidat" ? `Kandidat (${r.kandidat})` : `Alat tanpa pasangan (${r.kso_tanpa_pasangan})`}
            </Button>
          ))}
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit && tab === "pasti" && <Button size="sm" disabled={busy || r.pasti === 0} onClick={terapkanPasti}>Tautkan semua pasti</Button>}
            {canEdit && tab === "kandidat" && <Button size="sm" disabled={busy || pilih.size === 0} onClick={tautkanTerpilih}>Tautkan {pilih.size} terpilih</Button>}
            {canEdit && (r.tertaut_per_sumber.otomatis ?? 0) > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={batalkan}>Batalkan tautan otomatis</Button>}
          </div>
        </div>
        {msg && <div className="text-sm">{msg}</div>}

        <div className="overflow-x-auto rounded-md border">
          {daftar ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {tab === "kandidat" && canEdit && <TableHead className="w-8" />}
                  <TableHead>Aset Accurate</TableHead>
                  <TableHead>Catatan (SN)</TableHead>
                  <TableHead>Alat KSO</TableHead>
                  {tab === "kandidat" && <TableHead>Perlu dicek karena</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {daftar.slice(awal, awal + PAGE).map((p) => (
                  <TableRow key={kunci(p)}>
                    {tab === "kandidat" && canEdit && (
                      <TableCell>
                        <Checkbox
                          checked={pilih.has(kunci(p))}
                          onCheckedChange={(c) => setPilih((s) => {
                            const n = new Set(s);
                            if (c) n.add(kunci(p)); else n.delete(kunci(p));
                            return n;
                          })}
                          aria-label={`Pilih ${p.number}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="font-medium whitespace-nowrap">{p.number}</div>
                      <div className="text-muted-foreground max-w-[20rem] truncate text-xs">{p.description ?? "—"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.notes ?? "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm">{p.nama_alat ?? "—"} <span className="text-muted-foreground font-mono text-xs">{p.sn_key}</span></div>
                      <div className="text-muted-foreground max-w-[22rem] truncate text-xs">{p.customer_raw}</div>
                    </TableCell>
                    {tab === "kandidat" && (
                      <TableCell className="space-x-1">{p.alasan.map((a) => <Badge key={a} variant="outline">{a}</Badge>)}</TableCell>
                    )}
                  </TableRow>
                ))}
                {daftar.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center">Tidak ada.</TableCell></TableRow>}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SN</TableHead>
                  <TableHead>Alat</TableHead>
                  <TableHead>Faskes</TableHead>
                  {canEdit && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.kso_tanpa_pasangan.slice(awal, awal + PAGE).map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-mono text-xs">{k.sn_key.startsWith("NOSN:") ? <span className="text-muted-foreground">tanpa SN</span> : k.sn_key}</TableCell>
                    <TableCell className="text-sm">{k.nama_alat ?? k.type_alat ?? "—"}</TableCell>
                    <TableCell className="max-w-[24rem] truncate text-sm">{k.customer_raw}</TableCell>
                    {canEdit && <TableCell><Button size="sm" variant="outline" onClick={() => setManual(k)}>Tautkan…</Button></TableCell>}
                  </TableRow>
                ))}
                {d.kso_tanpa_pasangan.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center">Semua alat sudah punya usulan atau tertaut.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </div>

        {total > PAGE && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{awal + 1}–{Math.min(awal + PAGE, total)} dari {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
              <Button size="sm" variant="outline" disabled={awal + PAGE >= total} onClick={() => setPage(page + 1)}>Berikutnya</Button>
            </div>
          </div>
        )}
      </CardContent>
      {manual && <TautkanManual alat={manual} onClose={() => setManual(null)} onSaved={() => { setManual(null); void muat(); onChanged(); }} />}
      {dialog}
    </Card>
  );
}

function Ringkas({ label, nilai, sub }: { label: string; nilai: number | string; sub?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{typeof nilai === "number" ? nilai.toLocaleString("id-ID") : nilai}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

// Penautan manual dari sisi alat: cari aset KSO di Accurate (nomor/deskripsi), pilih satu.
function TautkanManual({ alat, onClose, onSaved }: { alat: AlatKsoRingkas; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [hasil, setHasil] = useState<AsetTetapRow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let batal = false;
    const t = setTimeout(() => {
      ambil<DaftarAset>(`/api/aset-tetap?${new URLSearchParams({ q: q.trim(), prefix: "KSO", limit: "15" })}`)
        .then((r) => { if (!batal) { setHasil(r.rows); setMsg(null); } })
        .catch((e) => { if (!batal) setMsg((e as Error).message); });
    }, 300);
    return () => { batal = true; clearTimeout(t); };
  }, [q]);

  const tautkan = async (a: AsetTetapRow) => {
    setBusy(true); setMsg(null);
    try {
      await ambil(`/api/aset-tetap/${a.id}/override`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kso_asset_id: alat.id }),
      });
      onSaved();
    } catch (e) {
      setMsg(`Gagal: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tautkan {alat.nama_alat ?? alat.type_alat ?? "alat"}</DialogTitle>
          <DialogDescription>{alat.sn_key.startsWith("NOSN:") ? "Tanpa SN" : `SN ${alat.sn_key}`} · {alat.customer_raw}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Input autoFocus placeholder="Cari aset Accurate: nomor KSO-…, atau nama alat" value={q} onChange={(e) => setQ(e.target.value)} />
          {msg && <p className="text-destructive text-sm">{msg}</p>}
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <Table>
              <TableBody>
                {(hasil ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.number}</div>
                      <div className="text-muted-foreground max-w-[26rem] truncate text-xs">{a.description ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      {a.kso_asset_id != null
                        ? <Badge variant="outline">sudah tertaut</Badge>
                        : <Button size="sm" disabled={busy} onClick={() => void tautkan(a)}>Tautkan</Button>}
                    </TableCell>
                  </TableRow>
                ))}
                {hasil && hasil.length === 0 && <TableRow><TableCell className="text-muted-foreground text-center">Tidak ada aset yang cocok.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </DialogBody>
        <DialogFooter><Button variant="outline" onClick={onClose}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
