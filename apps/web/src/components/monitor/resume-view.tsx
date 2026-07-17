"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Sparkles, Info, TrendingUp, ListChecks, CircleCheckBig, TriangleAlert, Gavel, Crown, Users, Clock } from "lucide-react";

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
  4: { label: "Konfirmasi", icon: CircleCheckBig, accent: "cyan" },
  5: { label: "Kendala & Isu", icon: TriangleAlert, accent: "red" },
  6: { label: "Keputusan", icon: Gavel, accent: "violet" },
  7: { label: "Untuk Direktur", icon: Crown, accent: "rose", priority: true },
  8: { label: "Untuk HOD", icon: Users, accent: "blue" },
};

// Kelas Tailwind literal per-accent / tone (harus literal supaya tak ke-purge JIT).
const ICON_WRAP: Record<Accent, string> = {
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};
type Tone = "red" | "amber" | "emerald" | "blue" | "slate" | "rose";
const TONE: Record<Tone, string> = {
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
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

// Pisah seksi 4 (Konfirmasi) → grup terkonfirmasi vs outstanding (baris bullet).
function splitKonfirmasi(body: string[]): { confirm: string[]; outstanding: string[] } {
  let phase: "confirm" | "outstanding" = "confirm";
  const confirm: string[] = [];
  const outstanding: string[] = [];
  for (const raw of body) {
    const t = raw.trim();
    if (!t) continue;
    if (!isBullet(t) && /terkonfirmasi/i.test(t)) { phase = "confirm"; continue; }
    if (!isBullet(t) && /(outstanding|menunggu)/i.test(t)) { phase = "outstanding"; continue; }
    if (isBullet(t) && !hasTidakAda(t)) (phase === "outstanding" ? outstanding : confirm).push(t);
  }
  return { confirm, outstanding };
}

// Parse satu baris bullet → item terstruktur (judul, PIC, tag [HOD], field key:value, TUA, eskalasi).
interface Item {
  title: string;
  pic: string | null;
  tag: string | null;
  fields: { label?: string; value: string }[];
  tua: boolean;
  escalation: boolean;
}
function parseItem(raw: string): Item {
  let t = raw.replace(/^[•\-*]\s+/, "").trim();
  const tua = /\[?\btua\b\]?/i.test(t);
  const escalation = /escalat|eskalas/i.test(t);
  t = t.replace(/\s*\[?\btua\b\]?/gi, "").trim();
  let tag: string | null = null;
  const bm = t.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bm) { tag = bm[1].trim(); t = bm[2].trim(); }
  const parts = (t.includes("|") ? t.split("|") : t.split(/\s+[—–]\s+/)).map((p) => p.trim()).filter(Boolean);
  let title = parts[0] ?? t;
  let pic: string | null = null;
  const pm = title.match(/^(.{1,32}?)\s*→\s*(.+)$/);
  if (pm) { pic = pm[1].trim(); title = pm[2].trim(); }
  const fields = parts.slice(1).map((p) => {
    const m = p.match(/^([A-Za-z][A-Za-z /&]{1,18}):\s*(.+)$/);
    return m ? { label: m[1].trim(), value: m[2].trim() } : { value: p };
  });
  return { title, pic, tag, fields, tua, escalation };
}

function Pill({ tone, caps, children }: { tone: Tone; caps?: boolean; children: ReactNode }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 font-medium", caps ? "text-[10px] font-semibold tracking-wide uppercase" : "text-[11px]", TONE[tone])}>
      {children}
    </span>
  );
}

function ItemCard({ item }: { item: Item }) {
  return (
    <div className="bg-muted/25 border-border/60 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {item.tag && <Pill tone="blue">{item.tag}</Pill>}
          {item.pic && <Pill tone="slate">{item.pic}</Pill>}
          <span className="text-foreground text-sm font-medium">{item.title}</span>
        </div>
        {(item.tua || item.escalation) && (
          <div className="flex shrink-0 gap-1">
            {item.tua && <Pill tone="red" caps>TUA</Pill>}
            {item.escalation && <Pill tone="amber" caps>Eskalasi</Pill>}
          </div>
        )}
      </div>
      {item.fields.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {item.fields.map((f, i) => (
            <span key={i} className="inline-flex gap-1">
              {f.label && <span className="text-muted-foreground capitalize">{f.label}:</span>}
              <span className="text-foreground/80">{f.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Body seksi → kartu per item bila berisi bullet; prosa via MonitorMarkdown.
function SectionBody({ section }: { section: Section }) {
  if (section.num === 4) {
    const g = splitKonfirmasi(section.body);
    return (
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CircleCheckBig className="size-3.5" /> Terkonfirmasi Baru ({g.confirm.length})
          </h4>
          {g.confirm.length ? (
            <div className="grid gap-2 lg:grid-cols-2">{g.confirm.map((t, i) => <ItemCard key={i} item={parseItem(t)} />)}</div>
          ) : <p className="text-muted-foreground text-sm">Tidak ada.</p>}
        </div>
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <Clock className="size-3.5" /> Outstanding — masih menunggu ({g.outstanding.length})
          </h4>
          {g.outstanding.length ? (
            <div className="grid gap-2 lg:grid-cols-2">{g.outstanding.map((t, i) => <ItemCard key={i} item={parseItem(t)} />)}</div>
          ) : <p className="text-muted-foreground text-sm">Tidak ada.</p>}
        </div>
      </div>
    );
  }

  const bulletLines = section.body.map((l) => l.trim()).filter(isBullet);
  if (bulletLines.length === 0) return <MonitorMarkdown content={section.body.join("\n")} />;

  const intro: string[] = [];
  for (const l of section.body) {
    if (isBullet(l.trim())) break;
    if (l.trim()) intro.push(l);
  }
  const items = bulletLines.filter((l) => !hasTidakAda(l)).map(parseItem);
  return (
    <div className="space-y-3">
      {intro.length > 0 && <MonitorMarkdown content={intro.join("\n")} />}
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Tidak ada.</p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">{items.map((it, i) => <ItemCard key={i} item={it} />)}</div>
      )}
    </div>
  );
}

export function ResumeView({ initial }: { initial: DigestData }) {
  const [data, setData] = useState<DigestData>(initial);
  const [date, setDate] = useState<string>(initial.date ?? "");
  const [entryIdx, setEntryIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [tab, setTab] = useState(1);

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

  const secByNum = useMemo(() => {
    const m = new Map<number, Section>();
    for (const s of sections) m.set(s.num, s);
    return m;
  }, [sections]);

  // Pilih tab pertama yang ada saat konten berganti; clamp index entri.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkron tab aktif dgn data baru.
    setTab(sections[0]?.num ?? 1);
  }, [sections]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamp index saat daftar entri berubah.
    if (entryIdx >= data.entries.length) setEntryIdx(0);
  }, [data.entries.length, entryIdx]);

  const konf = useMemo(() => {
    const s = secByNum.get(4);
    if (!s) return { confirm: 0, outstanding: 0, tua: 0 };
    const g = splitKonfirmasi(s.body);
    const tua = g.outstanding.filter((t) => /\btua\b/i.test(t)).length;
    return { confirm: g.confirm.length, outstanding: g.outstanding.length, tua };
  }, [secByNum]);

  const sectionCount = (num: number): number | null => {
    const s = secByNum.get(num);
    if (!s) return null;
    if (num === 3 || num === 7 || num === 8) return countBullets(s.body);
    if (num === 4) return konf.outstanding;
    return null;
  };

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

  const chips = [
    { label: "Action", value: secByNum.has(3) ? countBullets(secByNum.get(3)!.body) : 0, target: 3, tone: "amber" as Tone, icon: ListChecks },
    { label: "Outstanding", value: konf.outstanding, target: 4, tone: "blue" as Tone, icon: Clock },
    { label: "Item TUA", value: konf.tua, target: 4, tone: "red" as Tone, icon: TriangleAlert },
    { label: "Untuk Direktur", value: secByNum.has(7) ? countBullets(secByNum.get(7)!.body) : 0, target: 7, tone: "rose" as Tone, icon: Crown },
    { label: "Untuk HOD", value: secByNum.has(8) ? countBullets(secByNum.get(8)!.body) : 0, target: 8, tone: "blue" as Tone, icon: Users },
  ];

  const activeSection = secByNum.get(tab) ?? sections[0] ?? null;
  const activeMeta = activeSection ? (SECTION_META[activeSection.num] ?? { label: activeSection.title, icon: Info, accent: "slate" as Accent }) : null;

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

        <Button variant="outline" size="sm" className="ml-auto" disabled={generating} onClick={() => void generate()}>
          <Sparkles /> {generating ? "Generate…" : "Generate resume hari ini"}
        </Button>
      </div>
      {genMsg && <p className="text-muted-foreground text-xs">{genMsg}</p>}

      {!content.trim() || !activeSection || !activeMeta ? (
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
                  const Icon = c.icon;
                  const on = c.value > 0;
                  return (
                    <button
                      key={c.label}
                      onClick={() => setTab(c.target)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        on ? cn("border-transparent", TONE[c.tone]) : "bg-muted/40 border-border/60",
                      )}
                    >
                      <Icon className={cn("size-4", on ? "" : "text-muted-foreground")} />
                      <span>
                        <span className="block text-lg leading-none font-semibold tabular-nums">{c.value}</span>
                        <span className={cn("text-[11px]", on ? "opacity-80" : "text-muted-foreground")}>{c.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Tab bar */}
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <div className="bg-muted/50 flex w-max gap-1 rounded-lg border p-1">
              {sections.map((s) => {
                const meta = SECTION_META[s.num] ?? { label: s.title, icon: Info, accent: "slate" as Accent };
                const Icon = meta.icon;
                const cnt = sectionCount(s.num);
                const on = tab === s.num;
                return (
                  <button
                    key={s.num}
                    onClick={() => setTab(s.num)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                      on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span>{s.num}. {meta.label}</span>
                    {cnt != null && cnt > 0 && (
                      <span className={cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-muted text-foreground" : "bg-muted-foreground/15")}>{cnt}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Konten seksi aktif */}
          <Card>
            <CardContent className="py-4">
              <div className="mb-3 flex items-center gap-2">
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", ICON_WRAP[activeMeta.accent])}>
                  {(() => { const Icon = activeMeta.icon; return <Icon className="size-4" />; })()}
                </span>
                <h3 className="text-foreground flex-1 text-sm font-semibold">{activeSection.num}. {activeMeta.label}</h3>
                {activeMeta.priority && <Pill tone="rose" caps>Prioritas</Pill>}
              </div>
              <SectionBody section={activeSection} />
            </CardContent>
          </Card>
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
