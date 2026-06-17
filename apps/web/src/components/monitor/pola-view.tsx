"use client";

import { useState } from "react";
import { ArrowLeft, MessagesSquare, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MonitorReport } from "@/components/monitor/monitor-report";

interface PolaData {
  groups: { group_jid: string; group_name: string }[];
  group_jid: string | null;
  group_name: string | null;
  content: string | null;
}

const label = (g: { group_jid: string; group_name: string }) =>
  g.group_name && g.group_name !== g.group_jid ? g.group_name : g.group_jid.replace(/@g\.us$/, "");

export function PolaView({ initial }: { initial: PolaData }) {
  const [data, setData] = useState<PolaData>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(jid: string) {
    setSelected(jid);
    if (jid !== data.group_jid || data.content == null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/monitor/pola?jid=${encodeURIComponent(jid)}`, { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
  }

  if (data.groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-2">
          <EmptyState title="Belum ada profil pola" description="Tak ada data pola komunikasi grup." />
        </CardContent>
      </Card>
    );
  }

  // ── Detail satu grup ──
  if (selected) {
    const g = data.groups.find((x) => x.group_jid === selected);
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="-ml-2">
          <ArrowLeft className="size-4" /> Semua grup
        </Button>
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="bg-primary-soft text-primary flex size-8 items-center justify-center rounded-lg">
                <MessagesSquare className="size-4" />
              </span>
              <div>
                <p className="text-foreground text-sm font-semibold">{g ? label(g) : "—"}</p>
                <p className="text-muted-foreground text-xs">Profil pola komunikasi</p>
              </div>
            </div>
            {loading ? (
              <p className="text-muted-foreground text-sm">memuat…</p>
            ) : (
              <MonitorReport content={data.content} />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Galeri grup ──
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.groups.map((g) => (
        <button
          key={g.group_jid}
          onClick={() => open(g.group_jid)}
          className="border-border bg-card hover:border-primary hover:bg-primary-soft/20 group flex items-start gap-3 rounded-xl border p-4 text-left transition"
        >
          <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <MessagesSquare className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-foreground block truncate text-sm font-medium">{label(g)}</span>
            <span className="text-muted-foreground text-xs">Lihat profil pola</span>
          </span>
          <ChevronRight className="text-muted-foreground group-hover:text-primary mt-1 size-4 shrink-0" />
        </button>
      ))}
    </div>
  );
}
