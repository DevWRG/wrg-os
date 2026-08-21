// Opsi dropdown bersama add-print-spec-sheet & print-spec-row-actions (F44) —
// hindari duplikasi daftar paper size/orientation di 2 komponen.

export const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const PAPER_SIZE_OPTIONS = [
  { value: "A4", label: "A4" },
  { value: "A5", label: "A5" },
  { value: "A6", label: "A6" },
  { value: "F4", label: "F4 (Legal)" },
  { value: "Letter", label: "Letter" },
] as const;

export const ORIENTATION_OPTIONS = [
  { value: "portrait", label: "Potrait" },
  { value: "landscape", label: "Landscape" },
] as const;
