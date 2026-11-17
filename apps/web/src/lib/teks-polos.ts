// F170 (issue #2388): isian teks Komite KSO kini markdown (editor WYSIWYG). Untuk tempat yang hanya muat satu baris
// teks (peringatan di jendela usulan) markdown diratakan jadi teks polos. Salinan logika yang sama ada di
// apps/api/src/lib/teks-polos.ts (balasan WhatsApp) — ubah keduanya bersamaan.

/** Markdown → teks polos satu baris: penanda format dibuang, tautan jadi teksnya, baris/sel tabel digabung. */
export function teksPolos(md: string | null | undefined): string {
  if (!md) return "";
  return md
    .split(/\r?\n/)
    .filter((b) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(b)) // pemisah tabel
    .map((b) => b
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\s*\|(.*)\|\s*$/, (_, isi: string) => isi.split("|").map((x) => x.trim()).filter(Boolean).join(", "))
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?![\w*])/g, "$1$2")
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
      .trim())
    .filter(Boolean)
    .join(" · ");
}
