import { MonitorMarkdown } from "@/components/monitor/monitor-markdown";

// Pecah konten AI (resume/rekap/pola) jadi BLOK per-seksi biar gak satu dinding
// teks. Boundary seksi: garis ===/---, heading #/##, atau judul bernomor ALL-CAPS
// ("1. SITUASI UMUM"). Blok pertama tanpa judul = header laporan.

interface Block {
  title: string;
  body: string[];
}

const isSep = (t: string) => /^[-=]{3,}$/.test(t);

function parse(content: string): { header: string[]; blocks: Block[] } {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let cur: Block = { title: "", body: [] };
  let pendingTitle = false;
  const flush = () => {
    if (cur.title || cur.body.some((l) => l.trim())) blocks.push(cur);
    cur = { title: "", body: [] };
  };
  for (const line of lines) {
    const t = line.trim();
    if (isSep(t)) { flush(); pendingTitle = true; continue; }
    if (pendingTitle && t) { cur.title = t.replace(/^\d+[.)]\s+/, "").replace(/[#*]+$/, "").trim(); pendingTitle = false; continue; }
    const head = t.match(/^#{1,3}\s+(.*)$/);
    const numCaps = t.match(/^\d+[.)]\s+([A-Z][A-Za-z0-9 &/().,'-]{2,})$/);
    if (head || numCaps) {
      flush();
      cur.title = (head ? head[1] : numCaps![1]).replace(/[#*]+$/, "").trim();
      continue;
    }
    cur.body.push(line);
  }
  flush();
  // blok pertama tanpa judul → header
  let header: string[] = [];
  if (blocks.length && !blocks[0].title) header = blocks.shift()!.body;
  return { header, blocks };
}

export function MonitorReport({ content }: { content: string | null }) {
  if (!content || !content.trim()) return <p className="text-muted-foreground text-sm">— belum ada data —</p>;
  const { header, blocks } = parse(content);
  const headerLines = header.map((l) => l.trim()).filter(Boolean);

  return (
    <div className="space-y-3">
      {headerLines.length > 0 && (
        <div className="border-border/60 border-b pb-2">
          <p className="text-foreground text-sm font-semibold">{headerLines[0]}</p>
          {headerLines.slice(1).map((l, i) => (
            <p key={i} className="text-muted-foreground text-xs">{l}</p>
          ))}
        </div>
      )}
      {blocks.length === 0 ? (
        <MonitorMarkdown content={header.length ? "" : content} />
      ) : (
        <div className="grid gap-3">
          {blocks.map((b, i) => (
            <section key={i} className="border-border/70 bg-muted/30 rounded-lg border p-3.5">
              {b.title && (
                <h3 className="text-primary mb-2 flex items-center gap-2 text-sm font-semibold tracking-wide">
                  <span className="bg-primary inline-block h-4 w-1 rounded-full" />
                  {b.title}
                </h3>
              )}
              <MonitorMarkdown content={b.body.join("\n")} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
