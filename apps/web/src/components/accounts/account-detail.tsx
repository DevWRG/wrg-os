"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface AccountContact {
  id: string; nama: string; jabatan: string | null; role_deal: string | null;
  hp_wa: string | null; email: string | null; is_primary: boolean; notes: string | null; seq: number;
}
export interface AccountData {
  id: string; name: string; no: string | null;
  tipe: string | null; kelas_rs: string | null; wilayah: string | null; cabang: string | null;
  npwp: string | null; status_bayar: string | null; notes: string | null;
  owner_am_id: string | null; owner_nama: string | null;
  revenue: number; invoices: number; last_date: string | null; days_since: number | null; outstanding: number;
  contacts: AccountContact[];
}
// Kandidat pemilik dari /accounts-owners. Kosong = user ini tak berhak memindah
// kepemilikan (AM) → field Pemilik ditampilkan read-only.
export interface OwnerOption { am_id: string; nama: string; cabang: string | null }

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const TIPE = ["RS Pemerintah", "RS Swasta", "Klinik", "Lab Mandiri", "Bidan", "Distributor"];
const KELAS = ["A", "B", "C", "D"];
const BAYAR = ["BPJS", "Umum"];
const ROLES: { v: string; l: string }[] = [
  { v: "economic_buyer", l: "Economic Buyer" }, { v: "user", l: "User" },
  { v: "technical", l: "Technical" }, { v: "champion", l: "Champion" },
];
const roleLabel = (v: string | null) => ROLES.find((r) => r.v === v)?.l ?? null;
const roleTone = (v: string | null) =>
  v === "economic_buyer" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
  : v === "champion" ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
  : v === "technical" ? "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
  : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300";

const selCls = "h-8 rounded-md border border-border bg-card px-2 text-sm";

export function AccountDetail({ account, owners = [] }: { account: AccountData; owners?: OwnerOption[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canAssign = owners.length > 0;
  const [f, setF] = useState({
    tipe: account.tipe ?? "", kelas_rs: account.kelas_rs ?? "", wilayah: account.wilayah ?? "",
    cabang: account.cabang ?? "", npwp: account.npwp ?? "", status_bayar: account.status_bayar ?? "", notes: account.notes ?? "",
    owner_am_id: account.owner_am_id ?? "",
  });
  const [editingId, setEditingId] = useState<string | null>(null); // contact id, or "new"

  async function saveProfil() {
    setSaving(true);
    setErr(null);
    // owner_am_id hanya dikirim bila user berhak — backend tetap menolak kalau
    // dipaksa, ini cuma supaya AM tak mengirim field yang pasti ditolak.
    const body = canAssign ? { ...f, owner_am_id: f.owner_am_id || null } : { ...f, owner_am_id: undefined };
    const res = await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(String(d.error ?? `gagal menyimpan (HTTP ${res.status})`));
      return;
    }
    router.refresh();
  }
  async function delContact(id: string) {
    if (!confirm("Hapus kontak ini?")) return;
    await fetch(`/api/accounts/${account.id}/contacts/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* ringkasan komersial */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Revenue (netto)</div><div className="mt-1 text-2xl font-bold" title={rp(account.revenue)}>{rp(account.revenue)}</div><div className="text-muted-foreground text-xs">{account.invoices} faktur</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">AR outstanding</div><div className={`mt-1 text-2xl font-bold ${account.outstanding > 0 ? "text-rose-600" : ""}`}>{rp(account.outstanding)}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Order terakhir</div><div className="mt-1 text-lg font-semibold">{account.last_date ?? "—"}</div><div className={`text-xs ${account.days_since != null && account.days_since > 60 ? "text-amber-600" : "text-muted-foreground"}`}>{account.days_since != null ? `${account.days_since} hari lalu` : ""}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Kode Accurate</div><div className="mt-1 text-lg font-semibold">{account.no ?? "—"}</div></CardContent></Card>
      </div>

      {/* profil CRM */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="text-sm font-semibold">Profil faskes</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs"><span className="text-muted-foreground">Tipe faskes</span>
              <select className={`${selCls} w-full`} value={f.tipe} onChange={(e) => setF({ ...f, tipe: e.target.value })}><option value="">—</option>{TIPE.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="space-y-1 text-xs"><span className="text-muted-foreground">Kelas RS</span>
              <select className={`${selCls} w-full`} value={f.kelas_rs} onChange={(e) => setF({ ...f, kelas_rs: e.target.value })}><option value="">—</option>{KELAS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
            <label className="space-y-1 text-xs"><span className="text-muted-foreground">Status bayar</span>
              <select className={`${selCls} w-full`} value={f.status_bayar} onChange={(e) => setF({ ...f, status_bayar: e.target.value })}><option value="">—</option>{BAYAR.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
            <label className="space-y-1 text-xs"><span className="text-muted-foreground">Wilayah/teritori</span><Input className="h-8" value={f.wilayah} onChange={(e) => setF({ ...f, wilayah: e.target.value })} /></label>
            <label className="space-y-1 text-xs"><span className="text-muted-foreground">Cabang WRG</span><Input className="h-8" value={f.cabang} onChange={(e) => setF({ ...f, cabang: e.target.value })} /></label>
            <label className="space-y-1 text-xs"><span className="text-muted-foreground">NPWP</span><Input className="h-8" value={f.npwp} onChange={(e) => setF({ ...f, npwp: e.target.value })} /></label>
            {/* Pemilik = penentu siapa yang bisa melihat account ini (row-level
                scope). AM tak boleh memindah kepemilikan → tampil read-only. */}
            <label className="space-y-1 text-xs"><span className="text-muted-foreground">Pemilik (AM)</span>
              {canAssign ? (
                <select className={`${selCls} w-full`} value={f.owner_am_id} onChange={(e) => setF({ ...f, owner_am_id: e.target.value })}>
                  <option value="">— belum ada pemilik —</option>
                  {owners.map((o) => <option key={o.am_id} value={o.am_id}>{o.nama}{o.cabang ? ` · ${o.cabang}` : ""}</option>)}
                </select>
              ) : (
                <div className="flex h-8 items-center text-sm">{account.owner_nama || <span className="text-muted-foreground">Belum ada pemilik</span>}</div>
              )}
            </label>
          </div>
          <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Catatan</span><textarea className="w-full rounded-md border border-border bg-card p-2 text-sm" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={saveProfil} disabled={saving}>{saving ? "Menyimpan…" : "Simpan profil"}</Button>
            {err && <span className="text-destructive text-xs">{err}</span>}
          </div>
        </CardContent>
      </Card>

      {/* kontak multi-stakeholder */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Kontak ({account.contacts.length})</div>
            {editingId !== "new" && <Button size="sm" variant="outline" onClick={() => setEditingId("new")}>+ Tambah kontak</Button>}
          </div>
          {editingId === "new" && <ContactForm accountId={account.id} onDone={() => { setEditingId(null); router.refresh(); }} onCancel={() => setEditingId(null)} />}
          {account.contacts.length === 0 && editingId !== "new" && <p className="text-muted-foreground text-sm">Belum ada kontak. Tambahkan pengambil keputusan (Economic Buyer / Champion) — dipakai gate Negotiation di pipeline.</p>}
          <div className="space-y-2">
            {account.contacts.map((c) => editingId === c.id ? (
              <ContactForm key={c.id} accountId={account.id} contact={c} onDone={() => { setEditingId(null); router.refresh(); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.nama}</span>
                    {c.is_primary && <Badge variant="outline">Primary</Badge>}
                    {c.role_deal && <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${roleTone(c.role_deal)}`}>{roleLabel(c.role_deal)}</span>}
                  </div>
                  <div className="text-muted-foreground text-xs">{[c.jabatan, c.hp_wa, c.email].filter(Boolean).join(" · ") || "—"}</div>
                  {c.notes && <div className="text-muted-foreground mt-0.5 text-xs italic">{c.notes}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(c.id)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => delContact(c.id)}>Hapus</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ContactForm({ accountId, contact, onDone, onCancel }: { accountId: string; contact?: AccountContact; onDone: () => void; onCancel: () => void }) {
  const [saving, setSaving] = useState(false);
  const [c, setC] = useState({
    nama: contact?.nama ?? "", jabatan: contact?.jabatan ?? "", role_deal: contact?.role_deal ?? "",
    hp_wa: contact?.hp_wa ?? "", email: contact?.email ?? "", is_primary: contact?.is_primary ?? false, notes: contact?.notes ?? "",
  });
  async function save() {
    if (!c.nama.trim()) return;
    setSaving(true);
    const url = contact ? `/api/accounts/${accountId}/contacts/${contact.id}` : `/api/accounts/${accountId}/contacts`;
    await fetch(url, { method: contact ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
    setSaving(false);
    onDone();
  }
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary-soft/30 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input className="h-8" placeholder="Nama kontak *" value={c.nama} onChange={(e) => setC({ ...c, nama: e.target.value })} />
        <Input className="h-8" placeholder="Jabatan" value={c.jabatan} onChange={(e) => setC({ ...c, jabatan: e.target.value })} />
        <select className={`${selCls} w-full`} value={c.role_deal} onChange={(e) => setC({ ...c, role_deal: e.target.value })}><option value="">Role deal —</option>{ROLES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
        <Input className="h-8" placeholder="No HP / WA" value={c.hp_wa} onChange={(e) => setC({ ...c, hp_wa: e.target.value })} />
        <Input className="h-8" placeholder="Email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.is_primary} onChange={(e) => setC({ ...c, is_primary: e.target.checked })} /> Kontak utama (primary)</label>
      </div>
      <Input className="h-8" placeholder="Catatan" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving || !c.nama.trim()}>{saving ? "Menyimpan…" : "Simpan"}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Batal</Button>
      </div>
    </div>
  );
}
