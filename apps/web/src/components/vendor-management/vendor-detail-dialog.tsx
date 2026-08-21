"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ContractStatus = "active" | "expiring_soon" | "expired" | "no_end_date" | "terminated";

interface VendorContract {
  id: string;
  contract_number: string | null;
  contract_type: string | null;
  start_date: string;
  end_date: string | null;
  value: number | null;
  terminated_at: string | null;
  notes: string | null;
  status: ContractStatus;
}

interface VendorDetail {
  id: string;
  name: string;
  category: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  cabang: string | null;
  is_active: boolean;
  notes: string | null;
  contracts: VendorContract[];
}

const STATUS_BADGE: Record<ContractStatus, { label: string; cls: string }> = {
  active: { label: "Aktif", cls: "bg-success-soft text-success" },
  expiring_soon: { label: "Akan Expired", cls: "bg-warning-soft text-warning" },
  expired: { label: "Expired", cls: "bg-danger-soft text-danger" },
  no_end_date: { label: "Tanpa Batas", cls: "bg-muted text-muted-foreground" },
  terminated: { label: "Dihentikan", cls: "bg-muted text-muted-foreground" },
};

const tgl = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const rp = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n));

const blankForm = () => ({ contract_number: "", contract_type: "", start_date: new Date().toISOString().slice(0, 10), end_date: "", value: "", notes: "" });

// Dialog detail vendor — fetch on-demand via BFF /api/vendor-management/:id
// (pola sama InvoiceDetailDialog). Berisi form tambah/edit kontrak nested
// (pola dana-ops item, tanpa Sheet-di-dalam-Dialog — cukup toggle panel inline).
export function VendorDetailDialog({ vendorId, onClose }: { vendorId: string | null; onClose: () => void }) {
  const [state, setState] = useState<{ id: string; data: VendorDetail | null; err: boolean } | null>(null);
  const [formOpen, setFormOpen] = useState<"add" | string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  // Reset form/error saat vendorId berganti — pola "adjust state during render"
  // (React docs), bukan di useEffect, supaya tak kena lint set-state-in-effect.
  const [trackedId, setTrackedId] = useState(vendorId);
  if (vendorId !== trackedId) {
    setTrackedId(vendorId);
    setFormOpen(null);
    setError(null);
  }

  function reload(id: string) {
    fetch(`/api/vendor-management/${id}`)
      .then((r) => r.json())
      .then((d: VendorDetail) => setState({ id, data: d, err: false }))
      .catch(() => setState({ id, data: null, err: true }));
  }

  useEffect(() => {
    if (!vendorId) return;
    reload(vendorId);
  }, [vendorId]);

  const loaded = state && state.id === vendorId ? state : null;
  const vendor = loaded?.data ?? null;
  const err = loaded?.err ?? false;

  function openAdd() {
    setForm(blankForm());
    setError(null);
    setFormOpen("add");
  }

  function openEdit(c: VendorContract) {
    setForm({
      contract_number: c.contract_number ?? "",
      contract_type: c.contract_type ?? "",
      start_date: c.start_date,
      end_date: c.end_date ?? "",
      value: c.value != null ? String(c.value) : "",
      notes: c.notes ?? "",
    });
    setError(null);
    setFormOpen(c.id);
  }

  async function submitContract(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        contract_number: form.contract_number.trim() || null,
        contract_type: form.contract_type.trim() || null,
        start_date: form.start_date || undefined,
        end_date: form.end_date || null,
        value: form.value.trim() ? Number(form.value) : null,
        notes: form.notes.trim() || null,
      };
      const isEdit = formOpen && formOpen !== "add";
      const url = isEdit ? `/api/vendor-management/${vendorId}/contracts/${formOpen}` : `/api/vendor-management/${vendorId}/contracts`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan kontrak");
      setFormOpen(null);
      reload(vendorId);
    } catch (e2) {
      setError(String(e2 instanceof Error ? e2.message : e2));
    } finally {
      setBusy(false);
    }
  }

  function deleteContract(c: VendorContract) {
    if (!vendorId) return;
    confirm(
      { title: "Hapus kontrak?", description: `Kontrak ${c.contract_number ?? "(tanpa nomor)"} akan dihapus permanen.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/vendor-management/${vendorId}/contracts/${c.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          reload(vendorId);
        } finally {
          setBusy(false);
        }
      },
    );
  }

  return (
    <>
      {dialog}
      <Dialog open={!!vendorId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Vendor</div>
            <DialogTitle className="break-words">{vendor?.name ?? "Detail vendor"}</DialogTitle>
            {vendor && (
              <div className="text-muted-foreground text-sm">
                {vendor.category ?? "—"}{vendor.cabang ? ` · ${vendor.cabang}` : ""} · {vendor.contact_person ?? "—"}{vendor.phone ? ` (${vendor.phone})` : ""}
              </div>
            )}
          </DialogHeader>
          <DialogBody>
            {vendorId && vendor === null && !err ? (
              <div className="text-muted-foreground flex items-center gap-2 py-3 text-xs"><Loader2 className="size-3.5 animate-spin" /> Memuat…</div>
            ) : err ? (
              <div className="text-muted-foreground py-3 text-xs">Detail vendor tidak ditemukan.</div>
            ) : vendor ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Kontrak ({vendor.contracts.length})</div>
                  <Button size="sm" variant="outline" onClick={openAdd} disabled={busy}>
                    <Plus /> Tambah Kontrak
                  </Button>
                </div>

                {formOpen && (
                  <form onSubmit={submitContract} className="space-y-3 rounded-lg border p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="vc-number">No. Kontrak</Label>
                        <Input id="vc-number" value={form.contract_number} onChange={(e) => setForm((p) => ({ ...p, contract_number: e.target.value }))} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="vc-type">Tipe Kontrak</Label>
                        <Input id="vc-type" value={form.contract_type} onChange={(e) => setForm((p) => ({ ...p, contract_type: e.target.value }))} placeholder="Retainer / SLA / MOU" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="vc-start">Mulai *</Label>
                        <Input id="vc-start" type="date" required value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="vc-end">Selesai</Label>
                        <Input id="vc-end" type="date" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="vc-value">Nilai (Rp)</Label>
                        <Input id="vc-value" type="number" min="0" step="1" value={form.value} onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))} />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="vc-notes">Catatan</Label>
                      <Textarea id="vc-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                    </div>
                    {error && <p className="text-destructive text-sm">{error}</p>}
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setFormOpen(null)}>Batal</Button>
                      <Button type="submit" size="sm" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
                    </div>
                  </form>
                )}

                {!vendor.contracts.length ? (
                  <div className="text-muted-foreground py-2 text-xs">Belum ada kontrak.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left text-xs">
                          <th className="py-1.5 pr-2 font-medium">No. Kontrak</th>
                          <th className="py-1.5 px-2 font-medium">Tipe</th>
                          <th className="py-1.5 px-2 font-medium">Mulai</th>
                          <th className="py-1.5 px-2 font-medium">Selesai</th>
                          <th className="py-1.5 px-2 text-right font-medium">Nilai</th>
                          <th className="py-1.5 px-2 font-medium">Status</th>
                          <th className="py-1.5 pl-2 text-right font-medium">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendor.contracts.map((c) => {
                          const b = STATUS_BADGE[c.status];
                          return (
                            <tr key={c.id} className="border-b last:border-0">
                              <td className="py-1.5 pr-2">{c.contract_number ?? "—"}</td>
                              <td className="py-1.5 px-2">{c.contract_type ?? "—"}</td>
                              <td className="py-1.5 px-2 whitespace-nowrap">{tgl(c.start_date)}</td>
                              <td className="py-1.5 px-2 whitespace-nowrap">{tgl(c.end_date)}</td>
                              <td className="py-1.5 px-2 text-right whitespace-nowrap tabular-nums">{rp(c.value)}</td>
                              <td className="py-1.5 px-2"><Badge className={b.cls}>{b.label}</Badge></td>
                              <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                                <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => openEdit(c)} disabled={busy}>
                                  <Pencil />
                                </Button>
                                <Button variant="ghost" size="icon-sm" aria-label="Hapus" onClick={() => deleteContract(c)} disabled={busy} className="text-danger hover:text-danger">
                                  <Trash2 />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
