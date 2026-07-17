"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Sparkles, Info, TrendingUp, ListChecks, CircleCheckBig, TriangleAlert,
  Gavel, Crown, Users, ChevronDown, ChevronsDownUp, ChevronsUpDown, Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MonitorMarkdown } from "@/components/monitor/monitor-markdown";
import { cn } from "@/lib/utils";

interface DigestEntry {
  waktu: string | null;
  content: string;
}
interface DigestData {
  dates: string[];
  date: string | null;
  entries: DigestEntry[];
}

// ── section meta (resume = 8 seksi tetap dari services/ai) ──
type Accent = "cyan" | "emerald" | "amber" | "red" | "violet" | "rose" | "blue" | "slate";
interface SectionMeta {
  label: string;
  icon: ComponentType<{ className?: string }>;
  accent: Accent;
  priority?: boolean;
}
const SECTION_META: Record<number, SectionMeta> = {
  1: { label: "Situasi Umum", icon: Info, accent: "cyan" },
  2: { label: "Pipeline & Sales", icon: TrendingUp, accent: "emerald" },
  3: { label: "Action Items", icon: ListChecks, accent: "amber" },
  4: { label: "Konfirmasi Tracking", icon: CircleCheckBig, accent: "cyan" },
  5: { label: "Kendala & Isu", icon: TriangleAlert, accent: "red" },
  6: { label: "Keputusan", icon: Gavel, accent: "violet" },
  7: { label: "Untuk Direktur", icon: Crown, accent: "rose", priority: true },
  8: { label: "Untuk HOD", icon: Users, accent: "blue" },
};

// Kelas Tailwind literal per-accent (harus literal supaya tak ke-purge JIT).
const ACCENT: Record<Accent, { chipBg: string; chipText: string; iconWrap: string; ring: string }> = {
  cyan: { chipBg: "bg-cyan-50 dark:bg-cyan-500/10", chipText: "text-cyan-700 dark:text-cyan-300", iconWrap: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300", ring: "" },
  emerald: { chipBg: "bg-emerald-50 dark:bg-emerald-500/10", chipText: "text-emerald-700 dark:text-emerald-300", iconWrap: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", ring: "" },
  amber: { chipBg: "bg-amber-50 dark:bg-amber-500/10", chipText: "text-amber-700 dark:text-amber-300", iconWrap: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", ring: "" },
  red: { chipBg: "bg-red-50 dark:bg-red-500/10", chipText: "text-red-700 dark:text-red-300", iconWrap: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300", ring: "" },
  violet: { chipBg: "bg-violet-50 dark:bg-violet-500/10", chipText: "text-violet-700 dark:text-violet-300", iconWrap: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", ring: "" },
  rose: { chipBg: "bg-rose-50 dark:bg-rose-500/10", chipText: "text-rose-700 dark:text-rose-300", iconWrap: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", ring: "ring-1 ring-rose-300/70 dark:ring-rose-500/30" },
  blue: { chipBg: "bg-blue-50 dark:bg-blue-500/10", chipText: "text-blue-700 dark:text-blue-300", iconWrap: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300", ring: "" },
  slate: { chipBg: "bg-slate-100 dark:bg-slate-500/10", chipText: "text-slate-700 dark:text-slate-300", iconWrap: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300", ring: "" },
};

// ── parser: konten AI → header + 8 seksi bernomor ──
interface Section {
  num: number;
  title: string;
  body: string[];
}
const isBullet = (t: string) => /^[•\-*]\s+/.test(t);
const hasTidakAda = (t: string) => /tidak ada/i.test(t);

function parseResume(content: string): { headerLines: string[]; sections: Section[] } {
  const lines = content.replace(/\r/g, "").split("\n");
  const headerLines: string[] = [];
  const sections: Section[] = [];
  let expect = 1;
  let cur: Section | null = null;
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(/^([1-8])[.)]\s+(.+)$/);
    if (m && Number(m[1]) === expect) {
      cur = { num: expect, title: m[2].trim(), body: [] };
      sections.push(cur);
      expect++;
      continue;
    }
    if (cur) cur.body.push(line);
    else if (!/^[-=]{3,}$/.test(t)) headerLines.push(line);
  }
  return { headerLines: headerLines.map((l) => l.trim()).filter(Boolean), sections };
}

const countBullets = (body: string[]) =>
  body.map((l) => l.trim()).filter((l) => isBullet(l) && !hasTidakAda(l)).length;

function konfirmasiStats(body: string[]) {
  let phase: "confirm" | "outstanding" | "" = "";
  let confirmed = 0;
  let outstanding = 0;
  let tua = 0;
  for (const raw of body) {
    const t = raw.trim();
    if (!isBullet(t) && /terkonfirmasi/i.test(t)) { phase = "confirm"; continue; }
    if (!isBullet(t) && /(outstanding|menunggu)/i.test(t)) { phase = "outstanding"; continue; }
    if (isBullet(t) && !hasTidakAda(t)) {
      if (phase === "outstanding") { outstanding++; if (/\btua\b/i.test(t)) tua++; }
      else if (phase === "confirm") confirmed++;
    }
  }
  return { confirmed, outstanding, tua };
}

const domId = (num: number) => `resume-sec-${num}`;

export function ResumeView({ initial }: { initial: DigestData }) {
  const [data, setData] = useState<DigestData>(initial);
  const [date, setDate] = useState<string>(initial.date ?? "");
  const [entryIdx, setEntryIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  const [active, setActive] = useState(1);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/monitor/resume?date=${d}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch; disengaja.
    if (date && date !== data.date) void load(date);
  }, [date, data.date, load]);

  const entry = data.entries[entryIdx] ?? data.entries[0] ?? null;
  const content = entry?.content ?? "";
  const { headerLines, sections } = useMemo(() => parseResume(content), [content]);

  // Reset pilihan entri + buka semua seksi saat konten berganti (ganti tanggal/entri).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkron state UI dgn data baru; disengaja.
    setOpen(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  }, [content]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp index saat daftar entri berubah.
    if (entryIdx >= data.entries.length) setEntryIdx(0);
  }, [data.entries.length, entryIdx]);

  // Scroll-spy: sorot seksi aktif di rail.
  useEffect(() => {
    if (!sections.length) return;
    const els = sections
      .map((s) => document.getElementById(domId(s.num)))
      .filter((e): e is HTMLElement => e !== null);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(Number((vis[0].target as HTMLElement).dataset.num));
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [sections]);

  const goTo = (num: number) => {
    setOpen((prev) => (prev.has(num) ? prev : new Set(prev).add(num)));
    requestAnimationFrame(() => {
      document.getElementById(domId(num))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const toggle = (num: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });

  async function generate() {
    setGenerating(true);
    setGenMsg(null);
    try {
      const res = await fetch(`/api/monitor/resume/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(date ? { date } : {}),
      });
      const j = await res.json();
      if (!res.ok) setGenMsg(j.error ?? "gagal generate");
      else {
        setGenMsg(j.dry_run ? "Tersimpan (mode template — OPENROUTER key tak aktif)" : "Tersimpan via AI");
        const d = date || data.date;
        if (d) await load(d);
      }
    } catch {
      setGenMsg("gagal generate");
    } finally {
      setGenerating(false);
    }
  }

  const secByNum = useMemo(() => {
    const m = new Map<number, Section>();
    for (const s of sections) m.set(s.num, s);
    return m;
  }, [sections]);

  const konf = useMemo(() => {
    const s = secByNum.get(4);
    return s ? konfirmasiStats(s.body) : { confirmed: 0, outstanding: 0, tua: 0 };
  }, [secByNum]);

  const sectionCount = (num: number): number | null => {
    const s = secByNum.get(num);
    if (!s) return null;
    if (num === 3) return countBullets(s.body);
    if (num === 4) return konf.outstanding;
    if (num === 7 || num === 8) return countBullets(s.body);
    return null;
  };

  const chips = [
    { label: "Action", value: secByNum.has(3) ? countBullets(secByNum.get(3)!.body) : 0, target: 3, accent: "amber" as Accent, icon: ListChecks },
    { label: "Outstanding", value: konf.outstanding, target: 4, accent: "cyan" as Accent, icon: Clock },
    { label: "Item TUA", value: konf.tua, target: 4, accent: "red" as Accent, icon: TriangleAlert },
    { label: "Untuk Direktur", value: secByNum.has(7) ? countBullets(secByNum.get(7)!.body) : 0, target: 7, accent: "rose" as Accent, icon: Crown },
    { label: "Untuk HOD", value: secByNum.has(8) ? countBullets(secByNum.get(8)!.body) : 0, target: 8, accent: "blue" as Accent, icon: Users },
  ];

  const allOpen = sections.length > 0 && sections.every((s) => open.has(s.num));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="resume-date" className="text-muted-foreground text-xs">Tanggal</label>
        <select
          id="resume-date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border-input bg-card h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary"
        >
          {data.dates.map((d) => (
            <option key={d} value={d}>{prettyDate(d)}</option>
          ))}
        </select>

        {data.entries.length > 1 && (
          <div className="bg-muted/60 flex items-center gap-0.5 rounded-md p-0.5">
            {data.entries.map((e, i) => (
              <button
                key={`${e.waktu}-${i}`}
                onClick={() => setEntryIdx(i)}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                  i === entryIdx ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Clock className="size-3" /> {e.waktu ?? `#${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {loading && <span className="text-muted-foreground text-xs">memuat…</span>}

        <div className="ml-auto flex items-center gap-2">
          {sections.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((s) => s.num)))}>
              {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
              {allOpen ? "Tutup semua" : "Buka semua"}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={generating} onClick={() => void generate()}>
            <Sparkles /> {generating ? "Generate…" : "Generate resume hari ini"}
          </Button>
        </div>
      </div>
      {genMsg && <p className="text-muted-foreground text-xs">{genMsg}</p>}

      {!content.trim() ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState title="Tidak ada resume" description="Tak ada data untuk tanggal ini." />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Header + scorecard */}
          <Card>
            <CardContent className="space-y-3 py-4">
              <div>
                <p className="text-foreground text-base font-semibold">{headerLines[0] ?? "Resume Eksekutif"}</p>
                {headerLines.slice(1).map((l, i) => (
                  <p key={i} className="text-muted-foreground text-xs">{l}</p>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {chips.map((c) => {
                  const a = ACCENT[c.accent];
                  const Icon = c.icon;
                  const on = c.value > 0;
                  return (
                    <button
                      key={c.label}
                      onClick={() => goTo(c.target)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        on ? cn("border-transparent", a.chipBg) : "bg-muted/40 border-border/60",
                      )}
                    >
                      <span className={cn("flex size-7 items-center justify-center rounded-md", on ? a.iconWrap : "bg-muted text-muted-foreground")}>
                        <Icon className="size-3.5" />
                      </span>
                      <span>
                        <span className={cn("block text-lg leading-none font-semibold tabular-nums", on ? a.chipText : "text-muted-foreground")}>{c.value}</span>
                        <span className="text-muted-foreground text-[11px]">{c.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Rail nav + seksi */}
          <div className="grid gap-4 lg:grid-cols-[190px_1fr]">
            <nav className="top-20 hidden self-start lg:sticky lg:block">
              <ul className="space-y-0.5">
                {sections.map((s) => {
                  const meta = SECTION_META[s.num];
                  const cnt = sectionCount(s.num);
                  const isActive = active === s.num;
                  return (
                    <li key={s.num}>
                      <button
                        onClick={() => goTo(s.num)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          isActive ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", isActive ? "bg-primary" : "bg-border")} />
                        <span className="flex-1 truncate">{s.num}. {meta?.label ?? s.title}</span>
                        {cnt != null && cnt > 0 && (
                          <span className="text-muted-foreground tabular-nums">{cnt}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="min-w-0 space-y-3">
              {sections.map((s) => {
                const meta = SECTION_META[s.num] ?? { label: s.title, icon: Info, accent: "slate" as Accent };
                const a = ACCENT[meta.accent];
                const Icon = meta.icon;
                const cnt = sectionCount(s.num);
                const isOpen = open.has(s.num);
                return (
                  <section
                    key={s.num}
                    id={domId(s.num)}
                    data-num={s.num}
                    className={cn("bg-card scroll-mt-24 rounded-lg border", a.ring)}
                  >
                    <button
                      onClick={() => toggle(s.num)}
                      className="flex w-full items-center gap-3 p-3.5 text-left"
                    >
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", a.iconWrap)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="text-foreground flex-1 text-sm font-semibold">{s.num}. {meta.label}</span>
                      {meta.priority && (
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase", a.chipBg, a.chipText)}>Prioritas</span>
                      )}
                      {cnt != null && cnt > 0 && (
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", a.chipBg, a.chipText)}>{cnt}</span>
                      )}
                      <ChevronDown className={cn("text-muted-foreground size-4 shrink-0 transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="border-border/60 border-t px-4 pt-1 pb-4">
                        <MonitorMarkdown content={s.body.join("\n")} />
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function prettyDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return y && m && day ? `${day} ${MON[m - 1]} ${y}` : d;
}
