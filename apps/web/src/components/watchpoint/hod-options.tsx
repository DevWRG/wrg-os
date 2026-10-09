// Daftar HoD (selaras HOD_DEFS di apps/api/src/repo/watchpoint.ts).
export const HOD_OPTIONS: { key: string; label: string }[] = [
  { key: "rocky", label: "Rocky — Sales East" },
  { key: "yogi", label: "Yogi — Sales West" },
  { key: "mufid", label: "Mufid — Business IVD" },
  { key: "arman", label: "Arman — Business Medical & HD" },
  { key: "pakMuhid", label: "Pak Muhid — Aftersales" },
  { key: "ika", label: "Ika — Finance & SC" },
  { key: "fafa", label: "Fafa — Accounting & Tax" },
  { key: "husni", label: "Husni — BD & GA" },
];

export const hodLabel = (key: string) => HOD_OPTIONS.find((h) => h.key === key)?.label ?? key;

// className utk <select> native agar selaras dengan komponen Input.
export const selectClass =
  "border-input bg-transparent dark:bg-input/30 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";
