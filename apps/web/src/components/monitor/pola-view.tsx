"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, MessagesSquare, ChevronRight, Clock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { MonitorReport } from "@/components/monitor/monitor-report";

export type WaGroupCategory = "principal" | "internal" | "customer";

export interface WaGroup {
  group_jid: string;
  group_name: string;
  category: WaGroupCategory | null;
  category_source: "manual" | "prefix" | null;
  note: string | null;
  has_pola: boolean;
  message_count: number;
  last_message_at: string | null;
  /** true = pra-daftar: bot sudah di grupnya tapi grup belum pernah kirim pesan. */
  pending: boolean;
  name_prefix: string | null;
}

type Filter = "all" | WaGroupCategory | "none";

// Label & warna badge per kategori. "none" = belum dikategori.
const CAT: Record<WaGroupCategory, { label: string; badge: string }> = {
  principal: { label: "Principal", badge: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  internal: { label: "Internal & Karyawan", badge: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  customer: { label: "Customer", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
};
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "principal", label: "Principal" },
  { key: "internal", label: "Internal & Karyawan" },
  { key: "customer", label: "Customer" },
  { key: "none", label: "Belum dikategori" },
];

const label = (g: WaGroup) =>
  g.group_name && g.group_name !== g.group_jid ? g.group_name : g.group_jid.replace(/@g\.us$/, "");

// Baris pra-daftar tak punya JID → dikunci oleh awalan namanya.
const rowKey = (g: WaGroup) => g.group_jid || `prefix:${g.name_prefix ?? g.group_name}`;
// Badan request: grup nyata pakai group_jid, pra-daftar pakai name_prefix.
const rowTarget = (g: WaGroup) =>
  g.pending ? { name_prefix: g.name_prefix ?? g.group_name } : { group_jid: g.group_jid };

const selectClass =
  "border-input bg-transparent dark:bg-input/30 h-7 rounded-md border px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function PolaView({ groups: initial, canEdit }: { groups: WaGroup[]; canEdit: boolean }) {
  const [groups, setGroups] = useState<WaGroup[]>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: groups.length, principal: 0, internal: 0, customer: 0, none: 0 };
    for (const g of groups) c[g.category ?? "none"] += 1;
    return c;
  }, [groups]);

  const shown = useMemo(
    () => (filter === "all" ? groups : groups.filter((g) => (g.category ?? "none") === filter)),
    [groups, filter],
  );

  async function open(jid: string) {
    setSelected(jid);
    setContent(null);
    setNoteDraft(groups.find((g) => g.group_jid === jid)?.note ?? "");
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/monitor/pola?jid=${encodeURIComponent(jid)}`, { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { group_jid: string | null; content: string | null };
        // /monitor/pola fallback ke grup pertama kalau jid tak punya profil —
        // jangan tampilkan profil grup lain sebagai profil grup ini.
        setContent(d.group_jid === jid ? d.content : null);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function setCategory(g0: WaGroup, next: WaGroupCategory | null) {
    const key = rowKey(g0);
    const prev = groups;
    setGroups((gs) =>
      gs.map((g) => (rowKey(g) === key ? { ...g, category: next, category_source: "manual" as const } : g)),
    );
    setSaving(key);
    setError(null);
    try {
      const res = await fetch("/api/monitor/groups/category", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `note` sengaja TIDAK dikirim → backend membiarkan catatan yang ada.
        body: JSON.stringify({ ...rowTarget(g0), category: next }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setGroups(prev);
        setError(d.error || `gagal menyimpan (${res.status})`);
      }
    } catch {
      setGroups(prev);
      setError("gagal menyimpan (backend tak terjangkau)");
    } finally {
      setSaving(null);
    }
  }

  // Simpan catatan bebas. Grup tanpa kategori pun boleh punya catatan — dipakai
  // menandai grup yang kategorinya mau ditentukan sendiri nanti.
  async function saveNote(g0: WaGroup) {
    const key = rowKey(g0);
    const next = noteDraft.trim() || null;
    const prev = groups;
    setGroups((gs) => gs.map((x) => (rowKey(x) === key ? { ...x, note: next } : x)));
    setSaving(key);
    setError(null);
    try {
      const res = await fetch("/api/monitor/groups/category", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...rowTarget(g0), category: g0.category ?? null, note: next }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setGroups(prev);
        setError(d.error || `gagal menyimpan catatan (${res.status})`);
      }
    } catch {
      setGroups(prev);
      setError("gagal menyimpan catatan (backend tak terjangkau)");
    } finally {
      setSaving(null);
    }
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-2">
          <EmptyState title="Belum ada grup" description="Tak ada grup WhatsApp yang terekam." />
        </CardContent>
      </Card>
    );
  }

  // ── Detail satu grup ──
  if (selected) {
    const g = groups.find((x) => x.group_jid === selected);
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="-ml-2">
          <ArrowLeft className="size-4" /> Semua grup
        </Button>
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="bg-primary-soft text-primary flex size-8 items-center justify-center rounded-lg">
                <MessagesSquare className="size-4" />
              </span>
              <div className="mr-auto">
                <p className="text-foreground text-sm font-semibold">{g ? label(g) : "—"}</p>
                <p className="text-muted-foreground text-xs">Profil pola komunikasi</p>
              </div>
              {g?.category ? (
                <Badge className={CAT[g.category].badge}>{CAT[g.category].label}</Badge>
              ) : (
                <Badge variant="outline">Belum dikategori</Badge>
              )}
              {canEdit && g ? (
                <select
                  aria-label="Kategori grup"
                  className={selectClass}
                  value={g.category ?? ""}
                  disabled={saving === g.group_jid}
                  onChange={(e) => setCategory(g, (e.target.value || null) as WaGroupCategory | null)}
                >
                  <option value="">— belum dikategori —</option>
                  <option value="principal">Principal</option>
                  <option value="internal">Internal & Karyawan</option>
                  <option value="customer">Customer</option>
                </select>
              ) : null}
            </div>
            {canEdit && g ? (
              <div className="mb-3 flex items-center gap-2">
                <Input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Catatan bebas — mis. nama principal, PIC, atau kenapa kategorinya belum jelas"
                  maxLength={500}
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveNote(g)}
                  disabled={saving === rowKey(g) || noteDraft.trim() === (g.note ?? "")}
                >
                  Simpan catatan
                </Button>
              </div>
            ) : g?.note ? (
              <p className="text-muted-foreground mb-3 text-xs italic">{g.note}</p>
            ) : null}
            {error ? <p className="text-destructive mb-2 text-xs">{error}</p> : null}
            {loading ? (
              <p className="text-muted-foreground text-sm">memuat…</p>
            ) : content ? (
              <MonitorReport content={content} />
            ) : (
              <EmptyState
                title="Belum ada profil pola"
                description={`Grup ini belum diprofilkan (job pola-komunikasi butuh ≥5 pesan/7 hari). Pesan terekam: ${g?.message_count ?? 0}.`}
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Galeri grup ──
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1 sm:w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === f.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {f.label} <span className="opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState title="Tak ada grup" description="Tak ada grup pada kategori ini." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((g) => (
            <div
              key={rowKey(g)}
              className={`border-border bg-card group flex flex-col gap-2 rounded-xl border p-4 ${g.pending ? "border-dashed" : "hover:border-primary"}`}
            >
              {/* Baris pra-daftar tak punya profil untuk dibuka → bukan tombol. */}
              {g.pending ? (
                <div className="flex items-start gap-3">
                  <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Clock className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">{label(g)}…</span>
                    <span className="text-muted-foreground text-xs">
                      Pra-daftar — menunggu pesan pertama
                    </span>
                  </span>
                </div>
              ) : (
                <button onClick={() => open(g.group_jid)} className="flex items-start gap-3 text-left">
                  <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <MessagesSquare className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">{label(g)}</span>
                    <span className="text-muted-foreground text-xs">
                      {g.has_pola ? "Lihat profil pola" : "Belum ada profil pola"}
                    </span>
                  </span>
                  <ChevronRight className="text-muted-foreground group-hover:text-primary mt-1 size-4 shrink-0" />
                </button>
              )}
              {g.note ? (
                <p className="text-muted-foreground line-clamp-2 pl-12 text-xs italic">{g.note}</p>
              ) : null}
              <div className="flex items-center gap-2 pl-12">
                {g.category ? (
                  <Badge className={CAT[g.category].badge}>{CAT[g.category].label}</Badge>
                ) : (
                  <Badge variant="outline">Belum dikategori</Badge>
                )}
                {canEdit ? (
                  <select
                    aria-label={`Kategori ${label(g)}`}
                    className={`${selectClass} ml-auto`}
                    value={g.category ?? ""}
                    disabled={saving === rowKey(g)}
                    onChange={(e) => setCategory(g, (e.target.value || null) as WaGroupCategory | null)}
                  >
                    <option value="">— belum —</option>
                    <option value="principal">Principal</option>
                    <option value="internal">Internal</option>
                    <option value="customer">Customer</option>
                  </select>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
