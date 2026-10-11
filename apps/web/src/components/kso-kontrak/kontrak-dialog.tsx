"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { DokumenKontrakSection } from "./dokumen-kontrak";
import { BUCKET_CLS, BUCKET_LABEL, STATUS_LABEL, kirim, rpC, sisaTeks, type DetailKontrak, type StatusKontrak } from "./types";

type Mode = "lihat" | "status" | "perpanjang";

// Detail + aksi satu kontrak. Aturan (RENEWED hanya lewat Perpanjang, periode
// lama terkunci, LOST→AKTIF wajib catatan) ditegakkan apps/api; di sini hanya
// tombol yang tak relevan disembunyikan dan pesan error api ditampilkan apa adanya.
export function KontrakDialog({ id, canEdit, onClose }: { id: string | null; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<DetailKontrak | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("lihat");
  const [f, setF] = useState({ nomor: "", mulai: "", berakhir: "", nkt: "", pic_nama: "", catatan: "", auto_renew: false, terverifikasi: false });
  const [alat, setAlat] = useState<Set<string>>(new Set());
  const [ke, setKe] = useState<StatusKontrak>("NEGO");
  const [catatanStatus, setCatatanStatus] = useState("");
  const [p, setP] = useState({ nomor: "", mulai: "", berakhir: "", nkt: "", catatan: "" });

  const terapkan = useCallback((data: DetailKontrak) => {
    setD(data);
    const k = data.kontrak;
    setF({
      nomor: k.nomor, mulai: k.mulai ?? "", berakhir: k.berakhir ?? "", nkt: k.nkt == null ? "" : String(k.nkt),
      pic_nama: k.pic_nama ?? "", catatan: k.catatan ?? "", auto_renew: k.auto_renew, terverifikasi: k.terverifikasi,
    });
    setAlat(new Set(data.alat.map((a) => a.id)));
    setMode("lihat");
  }, []);

  // Muat ulang sesudah aksi tulis (dipanggil dari handler, bukan efek).
  const muat = useCallback(async () => {
    if (!id) return;
    terapkan(await kirim<DetailKontrak>(`/api/kso-kontrak/${id}`));
  }, [id, terapkan]);

  // Pemuatan awal. Dialog di-remount per kontrak (key={id} di pemanggil), jadi
  // state tak perlu dikosongkan; setState hanya di callback, dengan pembatalan
  // kalau dialog keburu ditutup.
  useEffect(() => {
    if (!id) return;
    let batal = false;
    kirim<DetailKontrak>(`/api/kso-kontrak/${id}`)
      .then((data) => { if (!batal) terapkan(data); })
      .catch((e: Error) => { if (!batal) setErr(e.message); });
    return () => { batal = true; };
  }, [id, terapkan]);

  async function jalankan(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await muat();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const k = d?.kontrak;
  const terkunci = k?.status === "RENEWED";
  const bolehEdit = canEdit && !terkunci;
  const json = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const simpan = () => jalankan(() => kirim(`/api/kso-kontrak/${id}`, {
    method: "PATCH",
    ...json({
      nomor: f.nomor, mulai: f.mulai || null, berakhir: f.berakhir || null, nkt: f.nkt === "" ? null : Number(f.nkt),
      pic_nama: f.pic_nama, catatan: f.catatan, auto_renew: f.auto_renew, terverifikasi: f.terverifikasi, alat_ids: [...alat],
    }),
  }));
  const ubahStatus = () => jalankan(() => kirim(`/api/kso-kontrak/${id}/status`, { method: "POST", ...json({ status: ke, catatan: catatanStatus }) }));
  const perpanjang = () => jalankan(() => kirim(`/api/kso-kontrak/${id}/perpanjang`, {
    method: "POST", ...json({ nomor: p.nomor, mulai: p.mulai || null, berakhir: p.berakhir || null, nkt: p.nkt === "" ? null : Number(p.nkt), catatan: p.catatan }),
  }));
  const semuaAlat = d ? [...d.alat, ...d.kandidat_alat] : [];

  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{k ? k.account_nama : "Memuat…"}</DialogTitle>
          {k && (
            <DialogDescription>
              {k.nomor} · {STATUS_LABEL[k.status]}
              {k.owner_nama ? ` · AM ${k.owner_nama}` : ""}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {k && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("rounded px-2 py-0.5 font-semibold", BUCKET_CLS[k.bucket])}>{BUCKET_LABEL[k.bucket]}</span>
                <span className="text-muted-foreground">{sisaTeks(k)}</span>
                {!k.terverifikasi && <span className="rounded bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-500">Belum diverifikasi</span>}
                {k.sumber === "isian_awal" && <span className="text-muted-foreground">diisi awal dari master alat (sheet)</span>}
                {terkunci && <span className="text-muted-foreground">periode lama — diganti kontrak #{k.diganti_oleh}</span>}
              </div>

              {mode === "lihat" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2"><Label htmlFor="kk-nomor">Nomor MoU</Label>
                    <Input id="kk-nomor" value={f.nomor} disabled={!bolehEdit} onChange={(e) => setF({ ...f, nomor: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kk-mulai">Mulai</Label>
                    <Input id="kk-mulai" type="date" value={f.mulai} disabled={!bolehEdit} onChange={(e) => setF({ ...f, mulai: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kk-akhir">Berakhir</Label>
                    <Input id="kk-akhir" type="date" value={f.berakhir} disabled={!bolehEdit} onChange={(e) => setF({ ...f, berakhir: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kk-nkt">NKT — nilai kontrak tahunan (Rp)</Label>
                    <Input id="kk-nkt" type="number" min={0} value={f.nkt} disabled={!bolehEdit} onChange={(e) => setF({ ...f, nkt: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kk-pic">PIC kontrak</Label>
                    <Input id="kk-pic" value={f.pic_nama} disabled={!bolehEdit} onChange={(e) => setF({ ...f, pic_nama: e.target.value })} /></div>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={f.auto_renew} disabled={!bolehEdit} onCheckedChange={(v) => setF({ ...f, auto_renew: v })} />Perpanjang otomatis</label>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={f.terverifikasi} disabled={!bolehEdit} onCheckedChange={(v) => setF({ ...f, terverifikasi: v })} />Data sudah diverifikasi tim KSO</label>
                  <div className="space-y-1 sm:col-span-2"><Label htmlFor="kk-cat">Catatan</Label>
                    <Textarea id="kk-cat" rows={2} value={f.catatan} disabled={!bolehEdit} onChange={(e) => setF({ ...f, catatan: e.target.value })} /></div>

                  <div className="space-y-1 sm:col-span-2">
                    <Label>Alat yang dicakup ({alat.size})</Label>
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                      {semuaAlat.length === 0 && <p className="text-muted-foreground text-xs">Akun ini tak punya alat KSO operasional.</p>}
                      {semuaAlat.map((a) => (
                        <label key={a.id} className="flex items-start gap-2">
                          <Checkbox className="mt-0.5" checked={alat.has(a.id)} disabled={!bolehEdit}
                            onCheckedChange={(v) => { const s = new Set(alat); if (v) s.add(a.id); else s.delete(a.id); setAlat(s); }} />
                          <span>
                            {a.nama_alat ?? "Alat"} <span className="text-muted-foreground">· SN {a.sn ?? "—"}</span>
                            {a.nomor_sheet && <span className="text-muted-foreground block text-xs">di sheet: {a.nomor_sheet}{a.berakhir_sheet ? ` s/d ${a.berakhir_sheet}` : ""}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {mode === "status" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(["AKTIF", "NEGO", "LOST"] as StatusKontrak[]).filter((s) => s !== k.status).map((s) => (
                      <Button key={s} type="button" size="sm" variant={ke === s ? "default" : "soft"} onClick={() => setKe(s)}>{STATUS_LABEL[s]}</Button>
                    ))}
                  </div>
                  <div className="space-y-1"><Label htmlFor="kk-cs">Catatan {k.status === "LOST" && ke === "AKTIF" ? "(wajib)" : "(opsional)"}</Label>
                    <Textarea id="kk-cs" rows={2} value={catatanStatus} onChange={(e) => setCatatanStatus(e.target.value)} /></div>
                  <p className="text-muted-foreground text-xs">Untuk kontrak yang sudah diperpanjang, pakai tombol Perpanjang supaya periode baru tercatat sebagai kontrak baru.</p>
                </div>
              )}

              {mode === "perpanjang" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <p className="text-muted-foreground text-xs sm:col-span-2">
                    Periode baru dibuat sebagai kontrak baru dengan akun, PIC, dan alat yang sama. Kontrak ini menjadi “Diperpanjang” dan tidak bisa diubah lagi.
                  </p>
                  <div className="space-y-1 sm:col-span-2"><Label htmlFor="kp-nomor">Nomor MoU baru</Label>
                    <Input id="kp-nomor" value={p.nomor} onChange={(e) => setP({ ...p, nomor: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kp-mulai">Mulai</Label>
                    <Input id="kp-mulai" type="date" value={p.mulai} onChange={(e) => setP({ ...p, mulai: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kp-akhir">Berakhir (wajib)</Label>
                    <Input id="kp-akhir" type="date" value={p.berakhir} onChange={(e) => setP({ ...p, berakhir: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kp-nkt">NKT baru (kosong = sama)</Label>
                    <Input id="kp-nkt" type="number" min={0} value={p.nkt} onChange={(e) => setP({ ...p, nkt: e.target.value })} /></div>
                  <div className="space-y-1"><Label htmlFor="kp-cat">Catatan</Label>
                    <Input id="kp-cat" value={p.catatan} onChange={(e) => setP({ ...p, catatan: e.target.value })} /></div>
                </div>
              )}

              {mode === "lihat" && <DokumenKontrakSection kontrakId={k.id} awal={d.dokumen ?? []} canEdit={canEdit} />}

              {d.log.length > 0 && mode === "lihat" && (
                <div className="space-y-1">
                  <Label>Riwayat</Label>
                  <ul className="text-muted-foreground max-h-32 space-y-0.5 overflow-y-auto text-xs">
                    {d.log.map((l, i) => (
                      <li key={i}>
                        {l.created_at.slice(0, 16)} · {l.aksi}{l.ke_status ? ` → ${STATUS_LABEL[l.ke_status as StatusKontrak] ?? l.ke_status}` : ""}
                        {l.oleh ? ` · ${l.oleh}` : ""}{l.catatan ? ` · “${l.catatan}”` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-muted-foreground text-xs">NKT tersimpan: {rpC(k.nkt)}</p>
            </>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap gap-2">
          {k && canEdit && !terkunci && mode === "lihat" && (
            <>
              {(k.status === "AKTIF" || k.status === "NEGO") && (
                <Button type="button" variant="soft" disabled={busy} onClick={() => { setP({ nomor: "", mulai: k.berakhir ?? "", berakhir: "", nkt: "", catatan: "" }); setMode("perpanjang"); }}>Perpanjang</Button>
              )}
              <Button type="button" variant="soft" disabled={busy} onClick={() => { setKe(k.status === "NEGO" ? "AKTIF" : "NEGO"); setCatatanStatus(""); setMode("status"); }}>Ubah status</Button>
              <Button type="button" disabled={busy} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            </>
          )}
          {mode === "status" && (
            <>
              <Button type="button" variant="outline" onClick={() => setMode("lihat")}>Batal</Button>
              <Button type="button" disabled={busy} onClick={ubahStatus}>Tandai {STATUS_LABEL[ke]}</Button>
            </>
          )}
          {mode === "perpanjang" && (
            <>
              <Button type="button" variant="outline" onClick={() => setMode("lihat")}>Batal</Button>
              <Button type="button" disabled={busy || !p.nomor.trim() || !p.berakhir} onClick={perpanjang}>Simpan periode baru</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
