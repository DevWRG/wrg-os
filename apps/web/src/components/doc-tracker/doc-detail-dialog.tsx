"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { KETERANGAN_STATE, LABEL_DOKUMEN, LABEL_STATE, STATES, ambil, labelTahap, rp, waktu, type DocDetail, type JenisDokumen, type SjBukti } from "./types";

const JENIS: JenisDokumen[] = ["po_customer", "sj_ttd_gudang", "sj_ttd_sales", "sj_ttd_kepala_sales", "sj_ttd_teknisi"];

// BAST satu SJ: WA #BAST atau BAST Instalasi Aftersales, yang lebih dulu (cermin bastSj di apps/api).
const bastSj = (s: SjBukti): { at: string | null; sumber: "BAST WA" | "BAST Instalasi" | null } => {
  const wa = s.bastAt ?? null;
  const ins = s.bastInstalasiAt ?? null;
  if (wa && ins) return Date.parse(ins) < Date.parse(wa) ? { at: ins, sumber: "BAST Instalasi" } : { at: wa, sumber: "BAST WA" };
  if (wa) return { at: wa, sumber: "BAST WA" };
  if (ins) return { at: ins, sumber: "BAST Instalasi" };
  return { at: null, sumber: null };
};

// Detail satu transaksi: timeline 7 tahap beserta buktinya, SJ & faktur terkait, dan (bila canEdit)
// checklist tanda tangan serta tautan faktur manual (tautan otomatis dari Accurate hanya ditampilkan, tak bisa
// dilepas; centang dari Arsip juga tak bisa dibatalkan — toggle hanya mengubah catatan manual). Pemanggil memberi
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
  const sumberBast = d ? [...new Set(d.sj.map((s) => bastSj(s).sumber).filter((x): x is NonNullable<typeof x> => x != null))] : [];
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
              {h.belumTercatat.length > 0 && (
                <p className="text-muted-foreground -mt-3 text-xs">Belum tercatat (tidak menahan state): {labelTahap(h.belumTercatat)}</p>
              )}

              {h.anomali.length > 0 && (
                <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <strong>Dokumen kurang:</strong>
                  <ul className="mt-1 list-disc pl-5">{h.anomali.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}

              <ol className="space-y-1.5">
                {STATES.map((s) => {
                  const t = h.tahap[s];
                  const belum = h.belumTercatat.includes(s);
                  return (
                    <li key={s} className="flex items-center gap-2 text-sm">
                      {t.selesai ? <Check className="size-4 text-emerald-600" /> : <Circle className="text-muted-foreground size-4" />}
                      <span className={cn("w-24 font-medium", !t.selesai && "text-muted-foreground")}>{LABEL_STATE[s]}</span>
                      <span className="text-muted-foreground">{KETERANGAN_STATE[s]}</span>
                      <span className="ml-auto text-xs tabular-nums">
                        {s === "executed" && t.selesai && sumberBast.length > 0 && <span className="text-muted-foreground mr-2">{sumberBast.join(" + ")}</span>}
                        {belum ? <span className="text-muted-foreground">belum tercatat</span> : t.at ? waktu(t.at.length === 10 ? `${t.at}T00:00:00+07:00` : t.at) : ""}
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
                    {d.sj.map((s) => {
                      const b = bastSj(s);
                      return (
                        <li key={s.nomor} className="flex flex-wrap gap-x-3">
                          <span className="font-medium">{s.nomor}</span>
                          <span className="text-muted-foreground text-xs">
                            {s.tanggal ? `DO ${s.tanggal} · ` : ""}kirim {waktu(s.kirimAt)} · terima {waktu(s.terimaAt)} · BAST {waktu(b.at)}{b.sumber ? ` (${b.sumber})` : ""}
                          </span>
                        </li>
                      );
                    })}
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
                      <span className="text-muted-foreground text-xs">{f.otomatis ? "otomatis (Accurate)" : "manual"}</span>
                      {canEdit && !f.otomatis && (
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
                    <p className="text-muted-foreground mt-1 text-xs">Faktur yang membawa rujukan SO di Accurate tertaut otomatis; sisanya (tanpa rujukan) dipilih manual — tidak ditebak.</p>
                  </details>
                )}
              </section>

              <section className="space-y-1">
                <h4 className="text-sm font-semibold">Checklist dokumen</h4>
                <ul className="space-y-1 text-sm">
                  {JENIS.map((j) => {
                    const row = d.dokumen[j];
                    const arsip = d.dokumen_arsip?.[j] ?? [];
                    const dariArsip = arsip.length > 0;
                    const wajib = d.dokumen_wajib.includes(j);
                    return (
                      <li key={j} className="flex flex-wrap items-center gap-x-2">
                        <input
                          type="checkbox" className="size-4" checked={dariArsip || row?.ada === true} disabled={!canEdit || busy || dariArsip}
                          onChange={(e) => aksi("dokumen", { jenis: j, ada: e.target.checked })}
                          aria-label={LABEL_DOKUMEN[j]}
                          title={dariArsip ? "Tercentang otomatis dari Arsip Dokumen — tidak bisa dibatalkan di sini" : undefined}
                        />
                        <span>{LABEL_DOKUMEN[j]}</span>
                        {!wajib && <span className="text-muted-foreground text-xs">(informasi)</span>}
                        {dariArsip && <span className="text-xs text-emerald-700 dark:text-emerald-400">dari Arsip {arsip.join(", ")}</span>}
                        {row?.ada && <span className="text-muted-foreground text-xs">{dariArsip ? "juga dicentang " : ""}oleh {row.by}, {waktu(row.at)}</span>}
                        {row && !row.ada && <span className="text-muted-foreground text-xs">centang dibatalkan oleh {row.by}, {waktu(row.at)}</span>}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-muted-foreground text-xs">
                  Closed butuh faktur lunas dan semua dokumen wajib (non-informasi) tercentang. Scan SJ bertanda tangan di Arsip Dokumen
                  (buku SJ, rujukan No. SJ) otomatis mencentang ketiga ttd SJ; arsip yang membawa No. PO dan merujuk SJ/faktur SO ini
                  mencentang PO customer.
                </p>
              </section>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
