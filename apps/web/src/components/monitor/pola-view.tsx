"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface PolaData {
  groups: { group_jid: string; group_name: string }[];
  group_jid: string | null;
  group_name: string | null;
  content: string | null;
}

export function PolaView({ initial }: { initial: PolaData }) {
  const [data, setData] = useState<PolaData>(initial);
  const [jid, setJid] = useState<string>(initial.group_jid ?? "");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (j: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/monitor/pola?jid=${encodeURIComponent(j)}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch; disengaja.
    if (jid && jid !== data.group_jid) void load(jid);
  }, [jid, data.group_jid, load]);

  if (data.groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-2">
          <EmptyState title="Belum ada profil pola" description="Tak ada data pola komunikasi grup." />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="pola-group" className="text-muted-foreground text-xs">Grup</label>
        <select
          id="pola-group"
          value={jid}
          onChange={(e) => setJid(e.target.value)}
          className="border-input bg-card h-9 max-w-xs rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary"
        >
          {data.groups.map((g) => (
            <option key={g.group_jid} value={g.group_jid}>{g.group_name}</option>
          ))}
        </select>
        {loading && <span className="text-muted-foreground text-xs">memuat…</span>}
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{data.group_name ?? "—"}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-foreground/90 font-sans text-sm whitespace-pre-wrap">{data.content ?? "—"}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
