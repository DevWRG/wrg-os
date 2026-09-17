"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { buildStickerPageHtml, type StickerSize } from "@/lib/asset-sticker";
import type { AssetTag } from "@/components/tables/asset-tags-table";

const SIZE_LABEL: Record<StickerSize, string> = { s: "Kecil", m: "Sedang", l: "Besar" };

export function PrintStickerTab({ assets }: { assets: AssetTag[] }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [size, setSize] = useState<StickerSize>("m");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return assets;
    return assets.filter((a) => a.kode.toLowerCase().includes(s) || a.nama.toLowerCase().includes(s));
  }, [assets, q]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((a) => a.id))));
  }

  async function cetak() {
    const picked = assets.filter((a) => selected.has(a.id));
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const html = await buildStickerPageHtml(picked, size);
      const w = window.open("", "_blank");
      if (!w) {
        setError("Popup diblokir — izinkan popup untuk cetak stiker.");
        return;
      }
      w.document.write(html);
      w.document.close();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  if (assets.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState title="Belum ada aset" description='Tambah aset dulu di tab "Aset".' />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode / nama…" className="max-w-xs" />
          <div className="flex items-center gap-1">
            {(["s", "m", "l"] as const).map((k) => (
              <Button key={k} size="sm" variant={size === k ? "default" : "outline"} onClick={() => setSize(k)}>
                {SIZE_LABEL[k]}
              </Button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="text-muted-foreground text-sm">{selected.size} terpilih</span>
          <Button size="sm" onClick={() => void cetak()} disabled={selected.size === 0 || busy}>
            {busy ? "Menyiapkan…" : `Cetak ${selected.size} Stiker`}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <label className="mb-2 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
            Pilih semua ({filtered.length})
          </label>
          <div className="divide-y">
            {filtered.map((a) => (
              <label key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="font-medium">{a.kode}</span>
                <span className="text-muted-foreground">{a.nama}</span>
                {a.lokasi_cabang && <span className="text-muted-foreground text-xs">· {a.lokasi_cabang}</span>}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
