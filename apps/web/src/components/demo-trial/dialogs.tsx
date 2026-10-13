"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { GagalKirim, HASIL_CLS, HASIL_LABEL, JENIS_CLS, JENIS_LABEL, kirim, tglId, type AmOpsi, type DemoTrial, type HasilDT, type JenisDT } from "./types";

const selCls = "h-9 w-full rounded-md border border-border bg-card px-2 text-sm";
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const plusHari = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Konteks deal saat dibuka dari kartu Pipeline — faskes, AM, dan tautan ikut deal. */
export interface DariDeal { deal_id: string; facility_name: string; brand: string | null; product: string | null }

// ── Tambah (menu Demo & Trial + kartu deal Pipeline) ────────────────────────

export function TambahDemoTrialDialog({ open, onClose, amOpsi = [], dariDeal, onSelesai }: {
  open: boolean; onClose: () => void; amOpsi?: AmOpsi[]; dariDeal?: DariDeal; onSelesai?: (r: DemoTrial) => void;
}) {
  const router = useRouter();
  const [jenis, setJenis] = useState<JenisDT>("demo");
  const [f, setF] = useState({
    facility_name: dariDeal?.facility_name ?? "", alat: [dariDeal?.brand, dariDeal?.product].filter(Boolean).join(" "),
    brand: dariDeal?.brand ?? "", tanggal: hariIni(), tanggal_selesai: plusHari(hariIni(), 14), catatan: "", am_id: "",
  });
  const [kandidat, setKandidat] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function simpan(namaFaskes?: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await kirim<DemoTrial>("/api/demo-trial", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jenis, facility_name: namaFaskes ?? f.facility_name, alat: f.alat, brand: f.brand || null,
          tanggal: f.tanggal, tanggal_selesai: jenis === "trial" ? f.tanggal_selesai : null, catatan: f.catatan || null,
          am_id: f.am_id || null, deal_id: dariDeal?.deal_id ?? null,
        }),
      });
      router.refresh();
      onSelesai?.(r);
      onClose();
    } catch (e) {
      if (e instanceof GagalKirim && Array.isArray(e.data.kandidat)) setKandidat(e.data.kandidat as string[]);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Catat demo / trial</DialogTitle>
          <DialogDescription>
            {dariDeal ? `Untuk deal ${dariDeal.facility_name} — otomatis tertaut ke deal ini.` : "Dari WhatsApp cukup: #DEMO faskes: alat — atau #TRIAL faskes: alat, 14 hari."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          {err && <p className="text-destructive text-sm sm:col-span-2">{err}</p>}
          {kandidat.length > 0 && (
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              {kandidat.map((k) => (
                <Button key={k} size="sm" variant="soft" disabled={busy} onClick={() => { setF({ ...f, facility_name: k }); setKandidat([]); void simpan(k); }}>{k}</Button>
              ))}
            </div>
          )}
          <div className="space-y-1"><Label htmlFor="dt-jenis">Jenis</Label>
            <select id="dt-jenis" className={selCls} value={jenis} onChange={(e) => setJenis(e.target.value as JenisDT)}>
              <option value="demo">Demo — sekali datang</option><option value="trial">Trial — alat dipinjamkan</option>
            </select></div>
          {amOpsi.length > 0 && !dariDeal && (
            <div className="space-y-1"><Label htmlFor="dt-am">AM</Label>
              <select id="dt-am" className={selCls} value={f.am_id} onChange={(e) => setF({ ...f, am_id: e.target.value })}>
                <option value="">— belum ada —</option>
                {amOpsi.map((a) => <option key={a.am_id} value={a.am_id}>{a.nama}{a.cabang ? ` · ${a.cabang}` : ""}</option>)}
              </select></div>
          )}
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="dt-faskes">Faskes *</Label>
            <Input id="dt-faskes" value={f.facility_name} disabled={!!dariDeal} onChange={(e) => { setF({ ...f, facility_name: e.target.value }); setKandidat([]); }} /></div>
          <div className="space-y-1"><Label htmlFor="dt-alat">Alat / produk *</Label>
            <Input id="dt-alat" value={f.alat} onChange={(e) => setF({ ...f, alat: e.target.value })} placeholder="mis. Zybio Z3 hematologi" /></div>
          <div className="space-y-1"><Label htmlFor="dt-brand">Brand</Label>
            <Input id="dt-brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} placeholder="untuk rekap konversi per produk" /></div>
          <div className="space-y-1"><Label htmlFor="dt-tgl">{jenis === "trial" ? "Mulai" : "Tanggal demo"}</Label>
            <Input id="dt-tgl" type="date" value={f.tanggal} onChange={(e) => setF({ ...f, tanggal: e.target.value })} /></div>
          {jenis === "trial" && (
            <div className="space-y-1"><Label htmlFor="dt-selesai">Selesai</Label>
              <Input id="dt-selesai" type="date" value={f.tanggal_selesai} min={f.tanggal} onChange={(e) => setF({ ...f, tanggal_selesai: e.target.value })} /></div>
          )}
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="dt-cat">Catatan</Label>
            <Textarea id="dt-cat" rows={2} value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} placeholder="siapa yang hadir, kondisi alat existing, dsb." /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !f.facility_name.trim() || !f.alat.trim()} onClick={() => void simpan()}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail: tutup dengan hasil / perpanjang trial ───────────────────────────

export function DetailDemoTrialDialog({ id, onClose, bolehUbah }: { id: string | null; onClose: () => void; bolehUbah: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<DemoTrial | null>(null);
  const [hasil, setHasil] = useState<HasilDT | "">("");
  const [alasan, setAlasan] = useState("");
  const [selesai, setSelesai] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let batal = false;
    kirim<DemoTrial>(`/api/demo-trial/${id}`)
      .then((d) => { if (!batal) { setR(d); setSelesai(d.tanggal_selesai ?? ""); } })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [id]);

  async function aksi(url: string, method: string, body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const d = await kirim<DemoTrial>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setR(d);
      setSelesai(d.tanggal_selesai ?? "");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tutup = () => {
    setR(null); setHasil(""); setAlasan(""); setErr(null);
    onClose();
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) tutup(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{r ? `${r.kode} · ${r.facility_name}` : "Demo / trial"}</DialogTitle>
          {r && (
            <DialogDescription>
              <span className={cn("mr-2 rounded px-1.5 py-0.5 text-xs font-semibold", JENIS_CLS[r.jenis])}>{JENIS_LABEL[r.jenis]}</span>
              {r.alat} · {tglId(r.tanggal)}{r.tanggal_selesai ? ` s/d ${tglId(r.tanggal_selesai)}` : ""} · {r.am_nama ?? "belum ber-AM"}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {!r && !err && <p className="text-muted-foreground text-sm">Memuat…</p>}
          {r && (
            <>
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground text-xs">Faskes</dt><dd>{r.facility_name}{r.account_id ? "" : <span className="text-muted-foreground"> (calon pelanggan)</span>}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Deal</dt><dd>{r.deal_id ? `Tertaut · ${r.deal_stage ?? "—"}` : <span className="text-muted-foreground">Belum tertaut</span>}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Brand</dt><dd>{r.brand ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Dicatat</dt><dd>{r.created_by ?? "—"} · {r.source === "wa" ? "WhatsApp" : r.source === "pipeline" ? "kartu deal" : "web"}</dd></div>
              </dl>
              {r.catatan && <p className="whitespace-pre-line rounded-md border px-3 py-2 text-sm">{r.catatan}</p>}

              {r.hasil ? (
                <div className="rounded-md border px-3 py-2 text-sm">
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", HASIL_CLS[r.hasil])}>{HASIL_LABEL[r.hasil]}</span>
                  <span className="text-muted-foreground ml-2 text-xs">ditutup {r.ditutup_oleh ?? ""} · {tglId(r.ditutup_at)}</span>
                  {r.alasan_hasil && <div className="mt-1 whitespace-pre-line">{r.alasan_hasil}</div>}
                </div>
              ) : bolehUbah ? (
                <div className="space-y-2 rounded-lg border p-3">
                  {r.lewat_selesai && (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Trial sudah lewat tanggal selesai — catat hasilnya atau perpanjang.</p>
                  )}
                  <div className="text-sm font-semibold">Hasil</div>
                  <div className="flex flex-wrap gap-2">
                    {(["positif", "netral", "negatif"] as HasilDT[]).map((h) => (
                      <button key={h} type="button" onClick={() => setHasil(h)}
                        className={cn("rounded-md border px-3 py-1.5 text-sm transition-colors", hasil === h ? cn("border-primary-dark font-semibold", HASIL_CLS[h]) : "bg-card hover:border-primary")}>
                        {HASIL_LABEL[h]}
                      </button>
                    ))}
                  </div>
                  <Textarea rows={2} value={alasan} onChange={(e) => setAlasan(e.target.value)}
                    placeholder={hasil === "positif" ? "opsional — mis. kepala lab minta penawaran" : "wajib untuk netral/negatif — mis. kalah harga, alat existing masih kontrak"} />
                  {r.jenis === "trial" && (
                    <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                      <div className="space-y-1"><Label htmlFor="dt-perpanjang">Tanggal selesai trial</Label>
                        <Input id="dt-perpanjang" type="date" value={selesai} min={r.tanggal} onChange={(e) => setSelesai(e.target.value)} className="w-44" /></div>
                      <Button size="sm" variant="soft" disabled={busy || !selesai || selesai === r.tanggal_selesai}
                        onClick={() => void aksi(`/api/demo-trial/${r.id}`, "PATCH", { tanggal_selesai: selesai })}>Perpanjang</Button>
                    </div>
                  )}
                </div>
              ) : <p className="text-muted-foreground text-sm">Belum ada hasil.</p>}
            </>
          )}
        </DialogBody>
        {r && !r.hasil && bolehUbah && (
          <DialogFooter>
            <Button variant="ghost" onClick={tutup}>Batal</Button>
            <Button disabled={busy || !hasil || (hasil !== "positif" && !alasan.trim())}
              onClick={() => void aksi(`/api/demo-trial/${r.id}/tutup`, "POST", { hasil, alasan: alasan || null })}>Simpan hasil</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
