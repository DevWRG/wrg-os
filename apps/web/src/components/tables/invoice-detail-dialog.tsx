"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface InvItem { line_no: number | null; name: string; qty: number | null; unit: string | null; unit_price: number; discount: number; total: number }
interface InvHead { number: string; customer_name: string; tanggal: string | null; total: number; taxable: number; tax: number; paid: number; outstanding: number; status: string | null; am: string | null; cabang: string | null }
interface InvDetail { ok: boolean; invoice: InvHead | null; items: InvItem[] }

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const tgl = (v: string | null) => {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return y && m && d ? `${d}/${m}/${y}` : v;
};

// Dialog detail satu invoice — dibuka dari tabel "Semua Invoice" & dari rincian
// invoice per-customer. Fetch on-demand via BFF /api/ar/invoice/:no.
export function InvoiceDetailDialog({ no, onClose }: { no: string | null; onClose: () => void }) {
  // Simpan hasil bersama `no`-nya → loading/err diturunkan tanpa setState sinkron.
  const [state, setState] = useState<{ no: string; data: InvDetail | null; err: boolean } | null>(null);

  useEffect(() => {
    if (!no) return;
    let cancel = false;
    fetch(`/api/ar/invoice/${encodeURIComponent(no)}`)
      .then((r) => r.json())
      .then((d: InvDetail) => { if (!cancel) setState({ no, data: d, err: false }); })
      .catch(() => { if (!cancel) setState({ no, data: null, err: true }); });
    return () => { cancel = true; };
  }, [no]);

  const loaded = state && state.no === no ? state : null;
  const data = loaded?.data ?? null;
  const err = loaded?.err ?? false;
  const inv = data?.invoice ?? null;
  return (
    <Dialog open={!!no} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Invoice {no}</div>
          <DialogTitle className="break-words">{inv?.customer_name ?? "Detail invoice"}</DialogTitle>
          {inv && (
            <div className="text-muted-foreground text-sm">
              {inv.am ?? "—"}{inv.cabang ? ` · ${inv.cabang}` : ""} · tanggal {tgl(inv.tanggal)} · {inv.status ?? "—"}
            </div>
          )}
        </DialogHeader>
        <DialogBody>
          {no && data === null && !err ? (
            <div className="text-muted-foreground flex items-center gap-2 py-3 text-xs"><Loader2 className="size-3.5 animate-spin" /> Memuat…</div>
          ) : err || (data && !data.ok) ? (
            <div className="text-muted-foreground py-3 text-xs">Detail invoice tidak ditemukan.</div>
          ) : inv ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-4">
                <div><div className="text-muted-foreground text-xs">DPP</div><div className="tabular-nums">{rp(inv.taxable)}</div></div>
                <div><div className="text-muted-foreground text-xs">PPN</div><div className="tabular-nums">{rp(inv.tax)}</div></div>
                <div><div className="text-muted-foreground text-xs">Total</div><div className="font-semibold tabular-nums">{rp(inv.total)}</div></div>
                <div><div className="text-muted-foreground text-xs">Outstanding</div><div className="font-semibold tabular-nums text-rose-600">{rp(inv.outstanding)}</div></div>
              </div>
              <div>
                <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Item ({data?.items.length ?? 0})</div>
                {!data?.items.length ? (
                  <div className="text-muted-foreground py-2 text-xs">Tidak ada rincian item.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left text-xs">
                          <th className="py-1.5 pr-2 font-medium">Item</th>
                          <th className="py-1.5 px-2 text-right font-medium">Qty</th>
                          <th className="py-1.5 px-2 text-right font-medium">Harga</th>
                          <th className="py-1.5 pl-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((it, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1.5 pr-2">{it.name}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{it.qty ?? "—"}{it.unit ? ` ${it.unit}` : ""}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">{rp(it.unit_price)}</td>
                            <td className="py-1.5 pl-2 text-right tabular-nums whitespace-nowrap">{rp(it.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
