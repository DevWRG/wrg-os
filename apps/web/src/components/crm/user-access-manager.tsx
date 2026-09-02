"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/use-confirm";

export interface AppUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  title: string | null;
  active: boolean;
  wa_number: string | null;
  hod_key: string | null;
  last_login_at: string | null;
  created_at: string;
}
interface RosterItem { am_id: string; nama?: string | null; wa_number?: string | null }
interface WaStatus { mode: "stub" | "dry-run" | "live"; delivered: boolean; error?: string }

const ROLES = ["admin", "user", "viewer"];

// Status WA jujur: delivered hanya di mode live sukses; dry-run/stub = belum live.
function waLabel(wa: WaStatus): { text: string; ok: boolean } {
  if (wa.delivered) return { text: "terkirim via WA ✓", ok: true };
  if (wa.error) return { text: `WA gagal: ${wa.error}`, ok: false };
  if (wa.mode === "dry-run") return { text: "WA DRY-RUN — tidak terkirim live (set WA_DRY_RUN=false)", ok: false };
  if (wa.mode === "stub") return { text: "WA belum aktif — gateway belum diset (WA_SEND_URL)", ok: false };
  return { text: "WA tidak terkirim", ok: false };
}

export function UserAccessManager({ users, roster }: { users: AppUserRow[]; roster: RosterItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: string; password: string; wa?: WaStatus } | null>(null);
  const [err, setErr] = useState("");
  const { confirm, dialog } = useConfirm();

  // form tambah manual
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [wa, setWa] = useState("");
  // form dari roster
  const [rAm, setRAm] = useState("");
  const [rEmail, setREmail] = useState("");
  // Roster 60+ nama: dipakai combobox yang bisa dicari, jadi urutkan menurut nama
  // supaya hasil filter terbaca wajar (roster dari API urut am_id).
  const opsiRoster = useMemo(
    () => roster
      .map((m) => ({ value: m.am_id, label: m.nama ?? m.am_id }))
      .sort((a, b) => a.label.localeCompare(b.label, "id")),
    [roster],
  );

  async function call(path: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setErr("");
    setBusy(true);
    try {
      const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(String(data.error ?? `HTTP ${res.status}`)); return null; }
      return data;
    } catch {
      setErr("gagal hubungi server");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createManual() {
    if (!email) { setErr("email wajib"); return; }
    const d = await call("/api/admin/users", "POST", { email, name, role, wa_number: wa || undefined, generate: true });
    if (d?.user) {
      setResult({ email: String((d.user as { email: string }).email), password: String(d.password), wa: d.wa as WaStatus | undefined });
      setEmail(""); setName(""); setWa(""); setRole("user");
      router.refresh();
    }
  }
  async function createFromRoster() {
    if (!rAm || !rEmail) { setErr("pilih karyawan & isi email"); return; }
    const d = await call("/api/admin/users/from-roster", "POST", { am_id: rAm, email: rEmail });
    if (d?.user) {
      setResult({ email: String((d.user as { email: string }).email), password: String(d.password) });
      setRAm(""); setREmail("");
      router.refresh();
    }
  }
  async function resetPw(u: AppUserRow, sendWa: boolean) {
    const d = await call(`/api/admin/users/${u.id}/password`, "POST", { generate: true, force: true, send_wa: sendWa });
    if (d) { setResult({ email: u.email, password: String(d.password), wa: d.wa as WaStatus | undefined }); router.refresh(); }
  }
  async function toggleActive(u: AppUserRow) {
    if (await call(`/api/admin/users/${u.id}`, "PATCH", { active: !u.active })) router.refresh();
  }
  async function setRoleFor(u: AppUserRow, newRole: string) {
    if (await call(`/api/admin/users/${u.id}`, "PATCH", { role: newRole })) router.refresh();
  }
  // Set hod_key (F127 scope tim per-cabang). Kosong → null (lihat semua).
  async function setHodKey(u: AppUserRow, val: string) {
    const next = val.trim() || null;
    if (next === (u.hod_key ?? null)) return;
    if (await call(`/api/admin/users/${u.id}`, "PATCH", { hod_key: next })) router.refresh();
  }
  function del(u: AppUserRow) {
    confirm({ title: "Hapus akun?", description: `Akun ${u.email} akan dihapus.`, destructive: true, confirmLabel: "Hapus" }, async () => {
      if (await call(`/api/admin/users/${u.id}`, "DELETE")) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {err ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div> : null}
      {result ? (
        <Card className="border-[#5a7a1a]/40 bg-[#5a7a1a]/5">
          <CardContent className="space-y-1 py-3 text-sm">
            <div className="font-semibold">Password untuk {result.email}</div>
            <div className="flex items-center gap-2">
              <code className="rounded bg-background px-2 py-1 text-base">{result.password}</code>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(result.password)}>Copy</Button>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>Tutup</Button>
            </div>
            {result.wa && (() => {
              const l = waLabel(result.wa);
              return <div className={l.ok ? "text-success text-xs font-medium" : "text-warning text-xs font-medium"}>{l.text}</div>;
            })()}
            <div className="text-muted-foreground text-xs">Tampil sekali — share ke karyawan, minta ganti setelah login.</div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Tambah akun (manual)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-1"><Label htmlFor="ua-email">Email</Label><Input id="ua-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@wahanalifeline.co.id" /></div>
            <div className="grid gap-1"><Label htmlFor="ua-name">Nama</Label><Input id="ua-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1"><Label htmlFor="ua-wa">No. WA (opsional, buat kirim password)</Label><Input id="ua-wa" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="6285…" /></div>
            <div className="grid gap-1">
              <Label htmlFor="ua-role">Role</Label>
              <select id="ua-role" value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={createManual} disabled={busy}>Buat + generate password</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Dari roster karyawan</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="grid gap-1">
              <Label htmlFor="ua-roster">Karyawan</Label>
              <Combobox id="ua-roster" value={rAm} onChange={setRAm} options={opsiRoster}
                emptyOption="— pilih —" searchPlaceholder="Ketik nama karyawan…"
                emptyText="Nama tidak ada di roster." />
            </div>
            <div className="grid gap-1"><Label htmlFor="ua-remail">Email login</Label><Input id="ua-remail" value={rEmail} onChange={(e) => setREmail(e.target.value)} placeholder="email karyawan" /></div>
            <Button size="sm" onClick={createFromRoster} disabled={busy}>Buat dari roster</Button>
            <p className="text-muted-foreground text-xs">No. WA diambil dari roster otomatis (buat kirim password).</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Akun login ({users.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr className="border-b">
                <th className="py-2 pr-3">Email</th><th className="pr-3">Nama</th><th className="pr-3">Role</th>
                <th className="pr-3">Status</th><th className="pr-3">WA</th><th className="pr-3">HoD key</th><th className="pr-3">Login terakhir</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b align-top">
                  <td className="py-2 pr-3 font-medium">{u.email}</td>
                  <td className="pr-3">{u.name ?? "—"}</td>
                  <td className="pr-3">
                    <select value={u.role} onChange={(e) => setRoleFor(u, e.target.value)} disabled={busy} className="h-7 rounded border bg-background px-1 text-xs">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="pr-3"><Badge variant={u.active ? "secondary" : "outline"}>{u.active ? "aktif" : "nonaktif"}</Badge></td>
                  <td className="pr-3 text-muted-foreground">{u.wa_number ?? "—"}</td>
                  <td className="pr-3">
                    <input defaultValue={u.hod_key ?? ""} onBlur={(e) => setHodKey(u, e.target.value)} disabled={busy}
                      placeholder="rocky/yogi…" title="hod_key (hod_territory) → HoD lihat cabang timnya. Kosong = lihat semua."
                      className="h-7 w-24 rounded border bg-background px-1 text-xs" />
                  </td>
                  <td className="pr-3 text-muted-foreground text-xs">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("id-ID") : "belum"}</td>
                  <td className="space-x-1 whitespace-nowrap py-1">
                    <Button size="sm" variant="outline" onClick={() => resetPw(u, false)} disabled={busy}>Reset</Button>
                    <Button size="sm" variant="outline" onClick={() => resetPw(u, true)} disabled={busy || !u.wa_number} title={u.wa_number ? "" : "no WA kosong"}>Reset+WA</Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(u)} disabled={busy}>{u.active ? "Nonaktif" : "Aktif"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => del(u)} disabled={busy}>Hapus</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {dialog}
    </div>
  );
}
