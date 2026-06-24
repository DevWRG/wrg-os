"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Plus, Users, ShieldCheck, Search, Copy, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { featureCatalog } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── Tipe (mirror apps/api/src/repo/rbac.ts) ──
interface GroupRow { id: number; key: string; name: string; description: string | null; is_system: boolean; superuser: boolean; member_count: number }
interface FeatureRow { key: string; name: string; section: string; path: string; sort: number }
interface PermRow { feature_key: string; active: boolean; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }
interface Member { id: string; email: string; name: string | null }
interface GroupDetail { id: number; key: string; name: string; description: string | null; is_system: boolean; superuser: boolean; members: Member[]; permissions: PermRow[] }
interface AppUserRow { id: string; email: string; name: string | null }

const ACTIONS = [
  { key: "active", label: "Aktif" },
  { key: "can_create", label: "Buat" },
  { key: "can_edit", label: "Ubah" },
  { key: "can_delete", label: "Hapus" },
  { key: "can_view", label: "Lihat" },
] as const;
type ActionKey = (typeof ACTIONS)[number]["key"];
type Cell = Record<ActionKey, boolean>;

// Parse aman: tak pernah lempar "Unexpected end of JSON input" walau body kosong/
// bukan JSON — tampilkan pesan asli (mis. error backend) atau status HTTP.
async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();
  let d: { error?: string } = {};
  try { d = text ? JSON.parse(text) : {}; } catch { d = { error: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(d.error ?? `gagal memuat (HTTP ${r.status})`);
  return d as T;
}

export function AccessGroupManager() {
  const [editing, setEditing] = useState<number | null>(null);
  if (editing !== null) return <GroupEditor id={editing} onBack={() => setEditing(null)} />;
  return <GroupList onOpen={setEditing} />;
}

// ── Daftar grup ──
function GroupList({ onOpen }: { onOpen: (id: number) => void }) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    jget<{ groups: GroupRow[] }>("/api/admin/access/groups").then((d) => setGroups(d.groups)).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  async function syncFeatures() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await fetch("/api/admin/access/features/sync", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ features: featureCatalog() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "gagal sync");
      setSyncMsg(`${d.upserted} fitur tersinkron ✓`);
    } catch (e) { setSyncMsg(String((e as Error).message ?? e)); } finally { setSyncing(false); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const r = await fetch("/api/admin/access/groups", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error ?? "gagal membuat grup"); return; }
    setNewName(""); setCreating(false);
    if (d.id) onOpen(Number(d.id)); else load();
  }

  if (error) return <Card><CardContent className="text-destructive py-8 text-center text-sm">{error}</CardContent></Card>;
  if (!groups) return <Card><CardContent className="text-muted-foreground py-10 text-center text-sm">Memuat…</CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm">{groups.length} grup</p>
          <Button size="sm" variant="outline" onClick={syncFeatures} disabled={syncing}>
            <RefreshCw className={syncing ? "animate-spin" : ""} /> {syncing ? "Sync…" : "Sync Fitur"}
          </Button>
          {syncMsg && <span className={cn("text-xs", syncMsg.includes("✓") ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>{syncMsg}</span>}
        </div>
        {creating ? (
          <form onSubmit={create} className="flex items-center gap-2">
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nama grup baru" className="h-8 w-48" />
            <Button type="submit" size="sm" disabled={!newName.trim()}>Buat</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName(""); }}>Batal</Button>
          </form>
        ) : (
          <Button size="sm" onClick={() => setCreating(true)}><Plus /> Tambah Grup</Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <button key={g.id} type="button" onClick={() => onOpen(g.id)}
            className="hover:border-primary/50 hover:bg-muted/40 rounded-lg border p-4 text-left transition-colors">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{g.name}</span>
              {g.superuser ? <Badge variant="default" className="gap-1"><ShieldCheck className="size-3" />Super</Badge>
                : g.is_system ? <Badge variant="secondary">Sistem</Badge> : null}
            </div>
            {g.description && <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{g.description}</p>}
            <p className="text-muted-foreground mt-3 flex items-center gap-1 text-xs"><Users className="size-3" />{g.member_count} anggota</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Editor grup (Umum + Hak Akses) ──
function GroupEditor({ id, onBack }: { id: number; onBack: () => void }) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // edit state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [grid, setGrid] = useState<Record<string, Cell>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Catatan: setState dilakukan di dalam .then (asinkron) — bukan sinkron di
  // body effect — agar tidak memicu cascading-render (react-hooks lint).
  const load = useCallback(() => {
    return Promise.all([
      jget<{ group: GroupDetail }>(`/api/admin/access/groups/${id}`),
      jget<{ features: FeatureRow[] }>("/api/admin/access/features"),
      jget<{ users: AppUserRow[] }>("/api/admin/users"),
      jget<{ groups: GroupRow[] }>("/api/admin/access/groups"),
    ])
      .then(([d, f, u, g]) => {
        setDetail(d.group); setFeatures(f.features); setUsers(u.users); setGroups(g.groups);
        setName(d.group.name); setDescription(d.group.description ?? "");
        setMembers(new Set(d.group.members.map((m) => m.id)));
        const byKey = new Map(d.group.permissions.map((p) => [p.feature_key, p]));
        const initial: Record<string, Cell> = {};
        for (const feat of f.features) {
          const p = byKey.get(feat.key);
          initial[feat.key] = {
            active: p?.active ?? false, can_create: p?.can_create ?? false,
            can_edit: p?.can_edit ?? false, can_delete: p?.can_delete ?? false, can_view: p?.can_view ?? false,
          };
        }
        setGrid(initial); setError(null);
      })
      .catch((e) => setError(String((e as Error).message ?? e)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="space-y-3"><BackBtn onBack={onBack} /><Card><CardContent className="text-destructive py-8 text-center text-sm">{error}</CardContent></Card></div>;
  if (!detail) return <div className="space-y-3"><BackBtn onBack={onBack} /><Card><CardContent className="text-muted-foreground py-10 text-center text-sm">Memuat…</CardContent></Card></div>;

  async function saveUmum() {
    setBusy(true); setMsg(null);
    try {
      const r1 = await fetch(`/api/admin/access/groups/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), description }) });
      if (!r1.ok) throw new Error((await r1.json()).error ?? "gagal simpan grup");
      const r2 = await fetch(`/api/admin/access/groups/${id}/members`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ userIds: [...members] }) });
      if (!r2.ok) throw new Error((await r2.json()).error ?? "gagal simpan anggota");
      setMsg("Tersimpan ✓");
    } catch (e) { setMsg(String((e as Error).message ?? e)); } finally { setBusy(false); }
  }

  async function savePerms() {
    setBusy(true); setMsg(null);
    try {
      const permissions: PermRow[] = features.map((f) => ({
        feature_key: f.key, active: grid[f.key].active, can_view: grid[f.key].can_view,
        can_create: grid[f.key].can_create, can_edit: grid[f.key].can_edit, can_delete: grid[f.key].can_delete,
      }));
      const r = await fetch(`/api/admin/access/groups/${id}/permissions`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ permissions }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "gagal simpan hak akses");
      setMsg("Hak akses tersimpan ✓");
    } catch (e) { setMsg(String((e as Error).message ?? e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BackBtn onBack={onBack} />
        <div className="flex items-center gap-3">
          {msg && <span className={cn("text-sm", msg.includes("✓") ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>{msg}</span>}
          {detail.superuser && <Badge variant="default" className="gap-1"><ShieldCheck className="size-3" />Superuser — akses penuh</Badge>}
        </div>
      </div>

      <Tabs defaultValue="umum">
        <TabsList>
          <TabsTrigger value="umum">Umum</TabsTrigger>
          <TabsTrigger value="hak">Hak Akses</TabsTrigger>
        </TabsList>

        {/* ── Umum ── */}
        <TabsContent value="umum">
          <Card><CardContent className="grid gap-5 py-5">
            <div className="grid max-w-md gap-1.5">
              <Label htmlFor="g-name">Nama Grup *</Label>
              <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} disabled={detail.is_system} />
              {detail.is_system && <p className="text-muted-foreground text-xs">Grup sistem — nama terkunci.</p>}
            </div>
            <div className="grid max-w-md gap-1.5">
              <Label htmlFor="g-desc">Deskripsi</Label>
              <Input id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Daftar Pengguna ({members.size})</Label>
              <MemberPicker users={users} selected={members} onToggle={(uid) => setMembers((s) => {
                const n = new Set(s);
                if (n.has(uid)) n.delete(uid); else n.add(uid);
                return n;
              })} />
            </div>
            <div><Button onClick={saveUmum} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button></div>
          </CardContent></Card>
        </TabsContent>

        {/* ── Hak Akses ── */}
        <TabsContent value="hak">
          <PermMatrix
            features={features} grid={grid} setGrid={setGrid} groups={groups} selfId={id}
            onSave={savePerms} busy={busy}
            onCopyFrom={async (srcId) => {
              setBusy(true); setMsg(null);
              try {
                const r = await fetch(`/api/admin/access/groups/${id}/copy-from/${srcId}`, { method: "POST" });
                if (!r.ok) throw new Error((await r.json()).error ?? "gagal salin hak");
                await load(); setMsg("Hak disalin ✓");
              } catch (e) { setMsg(String((e as Error).message ?? e)); } finally { setBusy(false); }
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackBtn({ onBack }: { onBack: () => void }) {
  return <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft /> Kembali</Button>;
}

// ── Pemilih anggota (search + checkbox list) ──
function MemberPicker({ users, selected, onToggle }: { users: AppUserRow[]; selected: Set<string>; onToggle: (id: string) => void }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return s ? users.filter((u) => (u.name ?? "").toLowerCase().includes(s) || u.email.toLowerCase().includes(s)) : users;
  }, [users, q]);
  return (
    <div className="rounded-md border">
      <div className="relative border-b p-2">
        <Search className="text-muted-foreground absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pengguna…" className="h-8 pl-8" />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 ? <p className="text-muted-foreground p-4 text-center text-sm">Tak ada pengguna.</p> : filtered.map((u) => (
          <label key={u.id} className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm">
            <Checkbox checked={selected.has(u.id)} onCheckedChange={() => onToggle(u.id)} />
            <span className="flex-1 truncate">{u.name || u.email}</span>
            <span className="text-muted-foreground truncate text-xs">{u.email}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Matriks hak akses ──
function PermMatrix({
  features, grid, setGrid, groups, selfId, onSave, busy, onCopyFrom,
}: {
  features: FeatureRow[]; grid: Record<string, Cell>; setGrid: React.Dispatch<React.SetStateAction<Record<string, Cell>>>;
  groups: GroupRow[]; selfId: number; onSave: () => void; busy: boolean; onCopyFrom: (srcId: number) => void;
}) {
  const [q, setQ] = useState("");
  const [copySrc, setCopySrc] = useState("");

  const visible = useMemo(() => {
    const s = q.toLowerCase().trim();
    return s ? features.filter((f) => f.name.toLowerCase().includes(s) || f.section.toLowerCase().includes(s)) : features;
  }, [features, q]);

  // grup per section utk render
  const sections = useMemo(() => {
    const m = new Map<string, FeatureRow[]>();
    for (const f of visible) { const a = m.get(f.section) ?? []; a.push(f); m.set(f.section, a); }
    return [...m.entries()];
  }, [visible]);

  const setCell = (key: string, action: ActionKey, val: boolean) =>
    setGrid((g) => ({ ...g, [key]: { ...g[key], [action]: val } }));

  const colAllChecked = (action: ActionKey) => visible.length > 0 && visible.every((f) => grid[f.key]?.[action]);
  const toggleCol = (action: ActionKey, val: boolean) =>
    setGrid((g) => { const n = { ...g }; for (const f of visible) n[f.key] = { ...n[f.key], [action]: val }; return n; });

  return (
    <Card><CardContent className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari fitur…" className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <select value={copySrc} onChange={(e) => setCopySrc(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm">
            <option value="">Salin Hak dari…</option>
            {groups.filter((g) => g.id !== selfId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <Button type="button" variant="outline" size="sm" disabled={!copySrc || busy} onClick={() => onCopyFrom(Number(copySrc))}><Copy /> Salin</Button>
          <Button type="button" size="sm" onClick={onSave} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Hak Akses"}</Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3 font-medium">Hak Akses</th>
              {ACTIONS.map((a) => (
                <th key={a.key} className="w-16 px-1 text-center font-medium">
                  <div className="flex flex-col items-center gap-1">
                    <span>{a.label}</span>
                    <Checkbox checked={colAllChecked(a.key)} onCheckedChange={(v) => toggleCol(a.key, v === true)} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(([section, feats]) => (
              <SectionRows key={section} section={section} feats={feats} grid={grid} setCell={setCell} />
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="text-muted-foreground py-8 text-center">Tak ada fitur cocok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </CardContent></Card>
  );
}

function SectionRows({ section, feats, grid, setCell }: {
  section: string; feats: FeatureRow[]; grid: Record<string, Cell>; setCell: (key: string, action: ActionKey, val: boolean) => void;
}) {
  return (
    <>
      <tr className="bg-muted/40"><td colSpan={6} className="px-1 py-1.5 text-xs font-semibold tracking-wide uppercase text-muted-foreground">{section}</td></tr>
      {feats.map((f) => (
        <tr key={f.key} className="border-b last:border-0">
          <td className="py-1.5 pr-3">{f.name}</td>
          {ACTIONS.map((a) => (
            <td key={a.key} className="px-1 text-center">
              <div className="flex justify-center">
                <Checkbox checked={grid[f.key]?.[a.key] ?? false} onCheckedChange={(v) => setCell(f.key, a.key, v === true)} />
              </div>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
