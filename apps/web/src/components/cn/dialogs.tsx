"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { langkahCn, type AccessUser } from "@/lib/cn-access";
import { cn } from "@/lib/utils";

import {
  AKSI_LABEL, HOD_BUSINESS, HOD_NAMA, HOD_SALES, STATUS_CLS, STATUS_LABEL, jsonInit, kirim, rupiah, tarifLabel, tglId,
  type CnDetail, type CnJenis, type CnStatus, type FakturKandidat, type KontrakRow,
} from "./types";

const SELECT_CLS = "border-input bg-background h-9 w-full rounded-md border px-3 text-sm";

// ── Kontrak baru ─────────────────────────────────────────────────────────────

export function KontrakDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hasil, setHasil] = useState<{ id: number; name: string }[]>([]);
  const [cust, setCust] = useState<{ id: number; name: string } | null>(null);
  const [jenis, setJenis] = useState<CnJenis>("persen");
  const [tarif, setTarif] = useState("");
  const [mulai, setMulai] = useState("");
  const [selesai, setSelesai] = useState("");
  const [syarat, setSyarat] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    let batal = false;
    const t = setTimeout(() => {
      kirim<{ items: { id: number; name: string }[] }>(`/api/cn/customers?q=${encodeURIComponent(q)}`)
        .then((d) => { if (!batal) setHasil(d.items); })
        .catch((e) => { if (!batal) setErr((e as Error).message); });
    }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [open, q]);

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      await kirim("/api/cn/kontrak", jsonInit("POST", {
        customer_id: cust?.id ?? null, jenis, tarif, periode_mulai: mulai, periode_selesai: selesai, syarat: syarat || null, file_url: fileUrl || null,
      }));
      router.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kontrak CN baru</DialogTitle>
          <DialogDescription>Disimpan sebagai draft; Direktur mengaktifkan sebelum bisa dipakai. Dasar hitung selalu DPP faktur.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          <div className="space-y-1">
            <Label htmlFor="kn-cust">Customer</Label>
            {cust ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{cust.name}</span><Button size="xs" variant="ghost" onClick={() => { setCust(null); setQ(""); setHasil([]); }}>Ganti</Button>
              </div>
            ) : (
              <>
                <Input id="kn-cust" placeholder="Ketik minimal 2 huruf nama customer…" value={q} onChange={(e) => setQ(e.target.value)} />
                {q.trim().length >= 2 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    {hasil.length === 0 && <p className="text-muted-foreground p-2 text-sm">Tidak ada customer yang cocok.</p>}
                    {hasil.map((c) => (
                      <button key={c.id} type="button" onClick={() => setCust(c)} className="hover:bg-muted block w-full border-b px-3 py-1.5 text-left text-sm last:border-0">{c.name}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="kn-jenis">Jenis</Label>
              <select id="kn-jenis" className={SELECT_CLS} value={jenis} onChange={(e) => setJenis(e.target.value as CnJenis)}>
                <option value="persen">Persentase dari DPP</option><option value="nominal">Nominal tetap</option>
              </select></div>
            <div className="space-y-1"><Label htmlFor="kn-tarif">{jenis === "persen" ? "Tarif (%)" : "Nominal (Rp) per pengajuan"}</Label>
              <Input id="kn-tarif" inputMode="decimal" value={tarif} onChange={(e) => setTarif(e.target.value)} placeholder={jenis === "persen" ? "mis. 2,5" : "mis. 5000000"} /></div>
            <div className="space-y-1"><Label htmlFor="kn-mulai">Periode mulai</Label><Input id="kn-mulai" type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="kn-selesai">Periode selesai</Label><Input id="kn-selesai" type="date" value={selesai} onChange={(e) => setSelesai(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="kn-syarat">Syarat (opsional)</Label>
            <Textarea id="kn-syarat" rows={2} value={syarat} onChange={(e) => setSyarat(e.target.value)} placeholder="mis. bayar ≤ 30 hari, minimal omzet Rp 100 jt" /></div>
          <div className="space-y-1"><Label htmlFor="kn-file">Tautan berkas kontrak (https, opsional)</Label>
            <Input id="kn-file" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://drive.google.com/…" /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !cust} onClick={() => void simpan()}>{busy ? "Menyimpan…" : "Simpan draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ajukan CN ────────────────────────────────────────────────────────────────

export function PengajuanDialog({ open, onClose, kontrak }: { open: boolean; onClose: () => void; kontrak: KontrakRow[] }) {
  const router = useRouter();
  const [kid, setKid] = useState("");
  const [faktur, setFaktur] = useState<FakturKandidat[]>([]);
  const [pilih, setPilih] = useState<Set<number>>(new Set());
  const [hodSales, setHodSales] = useState("");
  const [hodBiz, setHodBiz] = useState("");
  const [catatan, setCatatan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const k = kontrak.find((x) => String(x.id) === kid) ?? null;

  useEffect(() => {
    if (!kid) return;
    let batal = false;
    kirim<{ items: FakturKandidat[] }>(`/api/cn/kontrak/${kid}/faktur`)
      .then((d) => { if (!batal) { setFaktur(d.items); setPilih(new Set()); setErr(null); } })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [kid]);

  // Estimasi saja — angka resmi dihitung server dari DPP mirror Accurate.
  const estimasi = useMemo(() => {
    if (!k || pilih.size === 0) return 0;
    if (k.jenis === "nominal") return k.tarif;
    return faktur.filter((f) => pilih.has(f.invoice_id)).reduce((a, f) => a + Math.round((f.dpp * k.tarif) / 100), 0);
  }, [k, faktur, pilih]);

  const toggle = (id: number) => setPilih((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      await kirim("/api/cn/pengajuan", jsonInit("POST", {
        kontrak_id: Number(kid), invoice_ids: [...pilih], hod_sales_key: hodSales, hod_business_key: hodBiz || null, catatan: catatan || null,
      }));
      router.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajukan CN</DialogTitle>
          <DialogDescription>Pilih kontrak aktif, centang faktur dalam periodenya, lalu tentukan HoD tujuan.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          <div className="space-y-1"><Label htmlFor="pg-k">Kontrak</Label>
            <select id="pg-k" className={SELECT_CLS} value={kid} onChange={(e) => { setKid(e.target.value); setFaktur([]); setPilih(new Set()); }}>
              <option value="">— pilih kontrak aktif —</option>
              {kontrak.map((x) => <option key={x.id} value={x.id}>{x.kode} · {x.customer_name} · {tarifLabel(x.jenis, x.tarif)}</option>)}
            </select>
            {kontrak.length === 0 && <p className="text-muted-foreground text-xs">Belum ada kontrak aktif. Buat kontrak di tab Kontrak, lalu minta Direktur mengaktifkannya.</p>}
          </div>
          {k && (
            <div className="max-h-56 overflow-y-auto rounded-md border">
              {faktur.length === 0 && <p className="text-muted-foreground p-3 text-sm">Tidak ada faktur tersisa dalam periode kontrak ({tglId(k.periode_mulai)} – {tglId(k.periode_selesai)}).</p>}
              {faktur.map((f) => (
                <label key={f.invoice_id} className={cn("hover:bg-muted flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0", pilih.has(f.invoice_id) && "bg-muted")}>
                  <input type="checkbox" checked={pilih.has(f.invoice_id)} onChange={() => toggle(f.invoice_id)} />
                  <span className="flex-1"><span className="font-medium">{f.invoice_number}</span>
                    <span className="text-muted-foreground block text-xs">{tglId(f.tanggal)} · {f.salesman_name ?? "tanpa sales"}</span></span>
                  <span className="tabular-nums">{rupiah(f.dpp)}</span>
                </label>
              ))}
            </div>
          )}
          {k && pilih.size > 0 && <p className="text-sm">{pilih.size} faktur · estimasi CN <span className="font-semibold tabular-nums">{rupiah(estimasi)}</span> <span className="text-muted-foreground text-xs">(angka resmi dihitung server)</span></p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="pg-hs">HoD Sales (approver akhir)</Label>
              <select id="pg-hs" className={SELECT_CLS} value={hodSales} onChange={(e) => setHodSales(e.target.value)}>
                <option value="">— pilih —</option>{HOD_SALES.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select></div>
            <div className="space-y-1"><Label htmlFor="pg-hb">Lewat HoD Business dulu?</Label>
              <select id="pg-hb" className={SELECT_CLS} value={hodBiz} onChange={(e) => setHodBiz(e.target.value)}>
                <option value="">Tidak — langsung ke HoD Sales</option>{HOD_BUSINESS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select></div>
          </div>
          <div className="space-y-1"><Label htmlFor="pg-cat">Catatan</Label><Textarea id="pg-cat" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !k || pilih.size === 0 || !hodSales} onClick={() => void simpan()}>{busy ? "Mengajukan…" : "Ajukan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail & geser status ────────────────────────────────────────────────────

export function DetailDialog({ id, onClose, bolehUbah, pelaku, me }: { id: number; onClose: () => void; bolehUbah: boolean; pelaku: string; me: AccessUser }) {
  const router = useRouter();
  const [d, setD] = useState<CnDetail | null>(null);
  const [alasan, setAlasan] = useState("");
  const [bukti, setBukti] = useState("");
  const [tglReal, setTglReal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let batal = false;
    kirim<CnDetail>(`/api/cn/pengajuan/${id}`)
      .then((r) => { if (!batal) setD(r); })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [id]);

  async function pindah(ke: CnStatus) {
    setBusy(true);
    setErr(null);
    try {
      await kirim(`/api/cn/pengajuan/${id}/status`, jsonInit("POST", { ke, catatan: alasan || null, bukti_url: bukti || null, tanggal_realisasi: tglReal || null }));
      setD(await kirim<CnDetail>(`/api/cn/pengajuan/${id}`));
      setAlasan("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const langkah = d && bolehUbah ? langkahCn(me, d, pelaku) : [];
  const perluAlasan = (ke: CnStatus) => ke === "ditolak" || ke === "dibatalkan";
  const adaRealisasi = langkah.includes("terealisasi");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? `CN ${d.kode} — ${d.customer_name}` : "Pengajuan CN"}</DialogTitle>
          {d && <DialogDescription>
            {tarifLabel(d.jenis, d.tarif)} · HoD Sales {HOD_NAMA[d.hod_sales_key] ?? d.hod_sales_key}
            {d.hod_business_key ? ` · lewat HoD Business ${HOD_NAMA[d.hod_business_key] ?? d.hod_business_key}` : ""}
          </DialogDescription>}
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {d && (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><div className="text-muted-foreground text-xs">DPP faktur</div><div className="tabular-nums">{rupiah(d.total_dpp)}</div></div>
                <div><div className="text-muted-foreground text-xs">Nilai CN</div><div className="font-semibold tabular-nums">{rupiah(d.total_cn)}</div></div>
                <div><div className="text-muted-foreground text-xs">Diajukan oleh</div><div>{d.requested_by ?? "—"}</div></div>
                <div><div className="text-muted-foreground text-xs">Status</div><span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[d.status])}>{STATUS_LABEL[d.status]}</span></div>
              </div>
              {d.status === "terealisasi" && (
                <p className="text-sm">Direalisasikan {tglId(d.tanggal_realisasi)}{d.bukti_url && <> · <a className="text-primary underline" href={d.bukti_url} target="_blank" rel="noopener noreferrer">bukti transfer</a></>}</p>
              )}
              {d.catatan && <p className="text-muted-foreground text-sm">Catatan: {d.catatan}</p>}

              <div className="rounded-md border">
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b px-3 py-1.5 text-xs font-medium">
                  <span>Faktur</span><span className="text-right">DPP</span><span className="text-right">CN</span>
                </div>
                {d.items.map((i) => (
                  <div key={i.invoice_id} className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b px-3 py-1.5 text-sm last:border-0">
                    <span><span className="font-medium">{i.invoice_number}</span><span className="text-muted-foreground ml-2 text-xs">{tglId(i.tanggal_invoice)} · {i.salesman_name ?? "tanpa sales"}</span></span>
                    <span className="text-right tabular-nums">{rupiah(i.dpp)}</span><span className="text-right tabular-nums">{rupiah(i.nilai_cn)}</span>
                  </div>
                ))}
              </div>

              {langkah.length > 0 && (
                <div className="space-y-2 rounded-md border p-3">
                  {adaRealisasi && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1"><Label htmlFor="cn-bukti">Tautan bukti transfer (https)</Label>
                        <Input id="cn-bukti" value={bukti} onChange={(e) => setBukti(e.target.value)} placeholder="https://drive.google.com/…" /></div>
                      <div className="space-y-1"><Label htmlFor="cn-tgl">Tanggal realisasi</Label>
                        <Input id="cn-tgl" type="date" value={tglReal} onChange={(e) => setTglReal(e.target.value)} /></div>
                    </div>
                  )}
                  <div className="space-y-1"><Label htmlFor="cn-alasan">Catatan / alasan (wajib untuk tolak & batal)</Label>
                    <Textarea id="cn-alasan" rows={2} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></div>
                  <div className="flex flex-wrap gap-2">
                    {langkah.map((ke) => (
                      <Button key={ke} size="sm" variant={ke === "ditolak" ? "outline" : ke === "dibatalkan" ? "ghost" : "default"}
                        disabled={busy || (perluAlasan(ke) && !alasan.trim()) || (ke === "terealisasi" && !bukti.trim())}
                        onClick={() => void pindah(ke)}>{AKSI_LABEL[ke]}</Button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 text-sm font-medium">Riwayat</div>
                <ul className="space-y-1 text-sm">
                  {d.events.map((e) => (
                    <li key={e.id} className="text-muted-foreground">
                      {new Date(e.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} — <span className="text-foreground">{STATUS_LABEL[e.ke]}</span>
                      {e.oleh ? ` oleh ${e.oleh}` : ""}{e.catatan ? ` — ${e.catatan}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
