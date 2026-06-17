import { Fragment, type ReactNode } from "react";

// Renderer markdown-lite untuk konten AI monitor (pola/resume/rekap). Tanpa
// dependency. Tangani: heading (#/##/###), **bold**, bullet (-/•/*), numbered,
// tabel |…|, garis (---/===), baris ACTION (→), key-value, paragraf.

function inline(text: string, kp: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${kp}-${i}`} className="text-foreground font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={`${kp}-${i}`} className="bg-muted rounded px-1 py-0.5 text-[0.85em]">{p.slice(1, -1)}</code>;
    return <Fragment key={`${kp}-${i}`}>{p}</Fragment>;
  });
}

const isTableRow = (s: string) => s.trim().startsWith("|");
const isTableSep = (s: string) => /^\|?[\s:|-]+\|?$/.test(s.trim()) && s.includes("-");
const cells = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function MonitorMarkdown({ content }: { content: string | null }) {
  if (!content || !content.trim()) return <p className="text-muted-foreground text-sm">— belum ada data —</p>;
  const lines = content.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    // kosong → spacer kecil
    if (!t) { i++; continue; }

    // garis pemisah (--- / ===)
    if (/^[-=]{3,}$/.test(t)) { out.push(<hr key={k++} className="border-border/60 my-3" />); i++; continue; }

    // tabel
    if (isTableRow(t) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(t);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && !isTableSep(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push(
        <div key={k++} className="my-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b text-left">
                {head.map((h, j) => <th key={j} className="text-muted-foreground py-1.5 pr-3 font-medium">{inline(h, `th${k}-${j}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-border/40 border-b last:border-0">
                  {r.map((c, ci) => <td key={ci} className="py-1.5 pr-3 align-top">{inline(c, `td${k}-${ri}-${ci}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // heading
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const txt = h[2].replace(/[#*]+$/, "").trim();
      if (lvl === 1) out.push(<h2 key={k++} className="text-foreground mt-1 mb-2 text-lg font-bold">{inline(txt, `h${k}`)}</h2>);
      else if (lvl === 2) out.push(<h3 key={k++} className="text-primary mt-4 mb-1.5 flex items-center gap-2 text-sm font-semibold tracking-wide uppercase"><span className="bg-primary inline-block h-3.5 w-1 rounded-full" />{inline(txt, `h${k}`)}</h3>);
      else out.push(<h4 key={k++} className="text-foreground mt-3 mb-1 text-sm font-semibold">{inline(txt, `h${k}`)}</h4>);
      i++; continue;
    }

    // baris ACTION / → (highlight)
    if (/^(→|->|ACTION\b|⚠️|❗)/.test(t)) {
      out.push(<p key={k++} className="border-primary bg-primary-soft/40 text-foreground my-1.5 rounded-r border-l-2 py-1 pr-2 pl-3 text-sm">{inline(t.replace(/^->/, "→"), `act${k}`)}</p>);
      i++; continue;
    }

    // bullets (grup berurutan)
    if (/^[-•*]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-•*]\s+/, "")); i++; }
      out.push(<ul key={k++} className="marker:text-primary my-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed">{items.map((it, j) => <li key={j}>{inline(it, `li${k}-${j}`)}</li>)}</ul>);
      continue;
    }

    // numbered (grup berurutan)
    if (/^\d+[.)]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, "")); i++; }
      out.push(<ol key={k++} className="marker:text-primary my-1.5 list-decimal space-y-1 pl-5 text-sm leading-relaxed">{items.map((it, j) => <li key={j}>{inline(it, `ol${k}-${j}`)}</li>)}</ol>);
      continue;
    }

    // paragraf biasa
    out.push(<p key={k++} className="text-foreground/90 my-1.5 text-sm leading-relaxed">{inline(t, `p${k}`)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{out}</div>;
}
