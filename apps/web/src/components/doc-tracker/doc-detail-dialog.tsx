"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { KETERANGAN_STATE, LABEL_DOKUMEN, LABEL_STATE, STATES, ambil, rp, waktu, type DocDetail, type JenisDokumen } from "./types";

const JENIS: JenisDokumen[] = ["po_customer", "sj_ttd_gudang", "sj_ttd_sales", "sj_ttd_kepala_sales", "sj_ttd_teknisi"];

// Detail satu transaksi: timeline 9 tahap beserta buktinya, SJ & faktur terkait, dan (bila canEdit)
// stempel Review/Approved, checklist tanda tangan, serta tautan faktur manual. Pemanggil memberi
// `key={soId}` supaya state lama tak bocor ke transaksi lain. Setiap aksi → muat ulang detail + beri tahu
// pemanggil (onBerubah) agar funnel/daftar ikut segar.
export function DocDetailDialog({ soId, canEdit, onClose, onBerubah }: {
  soId: number | null; canEdit: boolean; onClose: () => void; onBerubah: () => void;
}) {
  const [d, setD] = useState<DocDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const muat = useCallback(async () => {
    if (soId == null) return;
    try {
      setD(await ambil<DocDetail>(`/api/doc-tracker/${soId}`));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [soId]);

  useEffect(() => {
    let batal = false;
    if (soId == null) return;
    ambil<DocDetail>(`/api/doc-tracker/${soId}`)
      .then((r) => { if (!batal) { setD(r); setErr(null); } })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [soId]);

  const aksi = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await ambil(`/api/doc-tracker/${soId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await muat();
      onBerubah();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const h = d?.hasil;
  return (
    <Dialog open={soId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{d ? d.so.number : "Memuat…"}</DialogTitle>
          <DialogDescription>
            {d ? `${d.so.customer} · SO ${d.so.tanggal} · ${rp(d.so.total)}` : "Rantai dokumen transaksi"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {err && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{err}</div>}
          {d && h && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{LABEL_STATE[h.state]}</Badge>
                <span className="text-muted-foreground">{KETERANGAN_STATE[h.state]}{h.umurHari != null ? ` · ${h.umurHari} hari di tahap ini` : ""}</span>
                {h.billingRisiko && <Badge variant="destructive">Berisiko ditagih terlambat</Badge>}
              </div>

              {h.anomali.length > 0 && (
                <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <strong>Dokumen kurang:</strong>
                  <ul className="mt-1 list-disc pl-5">{h.anomali.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}

              <ol className="space-y-1.5">
                {STATES.map((s) => {
                  const t = h.tahap[s];
                  return (
                    <li key={s} className="flex items-center gap-2 text-sm">
                      {t.selesai ? <Check className="size-4 text-emerald-600" /> : <Circle className="text-muted-foreground size-4" />}
                      <span className={cn("w-24 font-medium", !t.selesai && "text-muted-foreground")}>{LABEL_STATE[s]}</span>
                      <span className="text-muted-foreground">{KETERANGAN_STATE[s]}</span>
                      <span className="ml-auto text-xs tabular-nums">
                        {t.tersirat ? <span className="text-muted-foreground">tersirat (SO lama)</span> : t.at ? waktu(t.at.length === 10 ? `${t.at}T00:00:00+07:00` : t.at) : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <section className="space-y-1">
                <h4 className="text-sm font-semibold">Surat Jalan &amp; pengiriman ({h.hitungan.sj})</h4>
                {d.sj.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Belum ada SJ yang tertaut ke SO ini.</p>
                ) : (
                  <ul className="space-y-0.5 text-sm">
                    {d.sj.map((s) => (
                      <li key={s.nomor} className="flex flex-wrap gap-x-3">
                        <span className="font-medium">{s.nomor}</span>
                        <span className="text-muted-foreground text-xs">kirim {waktu(s.kirimAt)} · terima {waktu(s.terimaAt)} · BAST {waktu(s.bastAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-1">
                <h4 className="text-sm font-semibold">Faktur terkait ({h.hitungan.faktur}, lunas {h.hitungan.lunas})</h4>
                {d.faktur.length === 0 && <p className="text-muted-foreground text-sm">Belum ada faktur yang ditautkan.</p>}
                <ul className="space-y-0.5 text-sm">
                  {d.faktur.map((f) => (
                    <li key={f.invoice_id} className="flex items-center gap-2">
                      <span className="font-medium">{f.nomor}</span>
                      <span className="text-muted-foreground text-xs">{f.tanggal}</span>
                      <Badge variant={f.lunas ? "outline" : "secondary"}>{f.lunas ? "Lunas" : "Belum lunas"}</Badge>
                      {canEdit && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => aksi("faktur/lepas", { invoice_id: f.invoice_id })}>Lepas</Button>
                      )}
                    </li>
                  ))}
                </ul>
                {canEdit && d.kandidat_faktur.length > 0 && (
                  <details className="text-sm">
                    <summary className="text-muted-foreground cursor-pointer">Tautkan faktur customer ini ({d.kandidat_faktur.length} kandidat)</summary>
                    <ul className="mt-1 space-y-0.5">
                      {d.kandidat_faktur.map((k) => (
                        <li key={k.invoice_id} className="flex items-center gap-2">
                          <span className="font-medium">{k.nomor}</span>
                          <span className="text-muted-foreground text-xs">{k.tanggal} · {rp(k.total)}</span>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => aksi("faktur", { invoice_id: k.invoice_id })}>Tautkan</Button>
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground mt-1 text-xs">Faktur di Accurate belum membawa referensi SO, jadi tautan dipilih manual — tidak ditebak.</p>
                  </details>
                )}
              </section>

              <section className="space-y-1">
                <h4 className="text-sm font-semibold">Stempel</h4>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {(["review", "approved"] as const).map((t) => {
                    const st = d.stempel[t];
                    return (
                      <span key={t} className="flex items-center gap-2">
                        <Badge variant={st ? "outline" : "secondary"}>{LABEL_STATE[t]}{st ? ` · ${st.by}, ${waktu(st.at)}` : " · belum"}</Badge>
                        {canEdit && !st && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => aksi("stamp", { tahap: t })}>Tandai {LABEL_STATE[t]}</Button>
                        )}
                        {canEdit && st && (t === "approved" || !d.stempel.approved) && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => aksi("stamp/cabut", { tahap: t })}>Cabut</Button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-1">
                <h4 className="text-sm font-semibold">Checklist dokumen</h4>
                <ul className="space-y-1 text-sm">
                  {JENIS.map((j) => {
                    const row = d.dokumen[j];
                    const wajib = d.dokumen_wajib.includes(j);
                    return (
                      <li key={j} className="flex items-center gap-2">
                        <input
                          type="checkbox" className="size-4" checked={row?.ada === true} disabled={!canEdit || busy}
                          onChange={(e) => aksi("dokumen", { jenis: j, ada: e.target.checked })}
                          aria-label={LABEL_DOKUMEN[j]}
                        />
                        <span>{LABEL_DOKUMEN[j]}</span>
                        {!wajib && <span className="text-muted-foreground text-xs">(informasi)</span>}
                        {row?.ada && <span className="text-muted-foreground text-xs">oleh {row.by}, {waktu(row.at)}</span>}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-muted-foreground text-xs">Closed butuh faktur lunas dan semua dokumen wajib (non-informasi) tercentang.</p>
              </section>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
