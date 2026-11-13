"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { OpsEditor } from "./ops-editor";
import { kirim, type TabOps } from "./types";

// Halaman data operasional: navigasi 8 tab + editor tab aktif. `proyekId` = saring satu proyek.
export function OpsHalaman({ slug, proyekId, boleh }: {
  slug: string; proyekId: string | null; boleh: { buat: boolean; ubah: boolean; hapus: boolean };
}) {
  const [spek, setSpek] = useState<TabOps[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let batal = false;
    kirim<{ items: TabOps[] }>("/api/proyek-hd/ops-spek").then((d) => { if (!batal) setSpek(d.items); }).catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, []);
  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!spek) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const tab = spek.find((t) => t.slug === slug);
  const q = proyekId ? `?proyek=${proyekId}` : "";
  return (
    <div className="space-y-4">
      <nav aria-label="Tab data operasional" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {spek.map((t) => (
          <Link key={t.slug} href={`/proyek-hd/data/${t.slug}${q}`} aria-current={t.slug === slug ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              t.slug === slug ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-foreground/30")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab ? <OpsEditor key={`${slug}-${proyekId ?? ""}`} tab={tab} proyekId={proyekId} boleh={boleh} />
        : <p className="text-muted-foreground text-sm">Tab tidak dikenal.</p>}
    </div>
  );
}
