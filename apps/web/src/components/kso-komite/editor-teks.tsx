"use client";

// F170 Komite KSO — editor WYSIWYG untuk isian teks bebas (issue #2388, permintaan user 17 Nov 2026).
// TipTap v3 + @tiptap/markdown: yang disimpan tetap MARKDOWN di kolom teks yang sama (tanpa ubah skema), jadi teks
// lama (polos) terbaca apa adanya dan teks baru tetap bisa dibaca di mana pun. Format "lengkap" (keputusan user):
// tebal, miring, coret, judul, daftar berbutir/bernomor, kutipan, tautan, tabel. Ditampilkan oleh TeksKaya
// (react-markdown + remark-gfm, tanpa HTML mentah).

import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold, Columns3, Heading2, Heading3, Italic, Link as IkonLink, List, ListOrdered, Quote, Rows3, Strikethrough, Table as IkonTabel,
  Trash2, Unlink,
} from "lucide-react";
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { usePrompt } from "@/components/ui/use-prompt";
import { cn } from "@/lib/utils";

// Gaya isi (editor & tampilan) — tanpa plugin typography: judul, daftar, kutipan, tabel, tautan.
const GAYA_ISI = cn(
  "text-sm leading-relaxed break-words",
  "[&_p]:my-1 [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold",
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_a]:text-primary [&_a]:underline",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
  "[&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-1.5 [&_th]:text-left",
);

/** Markdown editor, dirapikan: kosong → "", baris kosong beruntun dipadatkan (serializer menambah satu di depan tabel). */
function mdDari(e: Editor): string {
  return e.isEmpty ? "" : e.getMarkdown().replace(/\n{3,}/g, "\n\n").trim();
}

function TombolAlat({ aktif, mati, judul, onClick, children }: {
  aktif?: boolean; mati?: boolean; judul: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" title={judul} aria-label={judul} aria-pressed={aktif} disabled={mati}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cn("inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4", aktif && "bg-primary/10 text-primary")}>
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { prompt, dialog } = usePrompt();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"),
      h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), quote: e.isActive("blockquote"),
      link: e.isActive("link"), tabel: e.isActive("table"),
    }),
  });
  const c = () => editor.chain().focus();
  const tautan = () =>
    prompt({ title: "Sisipkan tautan", placeholder: "https://…", defaultValue: editor.getAttributes("link").href ?? "", required: true },
      (url) => {
        const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
        if (editor.state.selection.empty) c().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] }).run();
        else c().extendMarkRange("link").setLink({ href }).run();
      });
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b p-1">
      <TombolAlat judul="Tebal" aktif={s.bold} onClick={() => c().toggleBold().run()}><Bold /></TombolAlat>
      <TombolAlat judul="Miring" aktif={s.italic} onClick={() => c().toggleItalic().run()}><Italic /></TombolAlat>
      <TombolAlat judul="Coret" aktif={s.strike} onClick={() => c().toggleStrike().run()}><Strikethrough /></TombolAlat>
      <span className="bg-border mx-1 h-5 w-px" aria-hidden />
      <TombolAlat judul="Judul" aktif={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 /></TombolAlat>
      <TombolAlat judul="Subjudul" aktif={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}><Heading3 /></TombolAlat>
      <TombolAlat judul="Daftar berbutir" aktif={s.ul} onClick={() => c().toggleBulletList().run()}><List /></TombolAlat>
      <TombolAlat judul="Daftar bernomor" aktif={s.ol} onClick={() => c().toggleOrderedList().run()}><ListOrdered /></TombolAlat>
      <TombolAlat judul="Kutipan" aktif={s.quote} onClick={() => c().toggleBlockquote().run()}><Quote /></TombolAlat>
      <span className="bg-border mx-1 h-5 w-px" aria-hidden />
      <TombolAlat judul="Tautan" aktif={s.link} onClick={tautan}><IkonLink /></TombolAlat>
      {s.link && <TombolAlat judul="Hapus tautan" onClick={() => c().extendMarkRange("link").unsetLink().run()}><Unlink /></TombolAlat>}
      <TombolAlat judul="Sisipkan tabel" mati={s.tabel}
        onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><IkonTabel /></TombolAlat>
      {s.tabel && (
        <>
          <TombolAlat judul="Tambah baris" onClick={() => c().addRowAfter().run()}><Rows3 /></TombolAlat>
          <TombolAlat judul="Tambah kolom" onClick={() => c().addColumnAfter().run()}><Columns3 /></TombolAlat>
          <TombolAlat judul="Hapus baris" onClick={() => c().deleteRow().run()}><Rows3 className="text-destructive" /></TombolAlat>
          <TombolAlat judul="Hapus kolom" onClick={() => c().deleteColumn().run()}><Columns3 className="text-destructive" /></TombolAlat>
          <TombolAlat judul="Hapus tabel" onClick={() => c().deleteTable().run()}><Trash2 className="text-destructive" /></TombolAlat>
        </>
      )}
      {dialog}
    </div>
  );
}

/**
 * Isian teks kaya. `value`/`onChange` = markdown. Teks polos lama dibaca apa adanya. `id` untuk <Label htmlFor>.
 * Isi kosong dikirim sebagai "" (bukan "<p></p>"), jadi validasi "wajib diisi" yang lama tetap berlaku.
 */
export function EditorTeks({ value, onChange, id, placeholder, className, minTinggi = "5rem" }: {
  value: string; onChange: (md: string) => void; id?: string; placeholder?: string; className?: string; minTinggi?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false, // Next SSR: editor baru dibuat di klien
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false, horizontalRule: false,
                             link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      TableKit.configure({ table: { resizable: false } }),
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        "aria-multiline": "true",
        role: "textbox",
        ...(placeholder ? { "aria-placeholder": placeholder, "data-placeholder": placeholder } : {}),
        class: cn(GAYA_ISI, "px-3 py-2 outline-none"),
        style: `min-height:${minTinggi}`,
      },
    },
    onUpdate: ({ editor: e }) => onChange(mdDari(e)),
  });
  const kosong = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? true });

  // nilai diganti dari luar (mis. form di-reset) → isi editor ikut, tanpa memicu onChange berulang
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const kini = mdDari(editor);
    if (value.trim() !== kini) editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cn("rounded-md border bg-white shadow-xs focus-within:ring-2 focus-within:ring-ring/40 dark:bg-card", className)}>
      {editor && <Toolbar editor={editor} />}
      <div className="relative">
        {kosong && placeholder && (
          <span className="text-muted-foreground pointer-events-none absolute top-2 left-3 text-sm">{placeholder}</span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Tampilan isian teks kaya (markdown). Aman: HTML mentah tidak dirender; tautan dibuka di tab baru. */
export function TeksKaya({ md, className }: { md: string | null | undefined; className?: string }) {
  if (!md?.trim()) return null;
  return (
    <div className={cn(GAYA_ISI, "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}>
        {md}
      </ReactMarkdown>
    </div>
  );
}
