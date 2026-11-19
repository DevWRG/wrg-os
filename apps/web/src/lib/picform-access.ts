// Gerbang proxy /api/picform/[...path] (data Form PIC F157, GET saja) — sub-path
// apps/api /picform/* dipetakan ke menu yang memakainya. Dulu tanpa gerbang
// menu: siapa pun yang login bisa membaca langkah SOP, RACI posisi, dan peta
// koordinasi lintas divisi.
//
// koordinasi/pohon = data Spider Network SAJA. Pemegang SOP & Otomasi tanpa
// Spider Network (grup HoD) tidak boleh membacanya lewat sini.
// Segmen di luar peta = null → route menolak kecuali admin.

const MENU: Record<string, readonly string[]> = {
  summary: ["/sop-otomasi"],
  divisi: ["/sop-otomasi"],
  kelengkapan: ["/sop-otomasi"],
  "sop-langkah": ["/sop-otomasi"],
  raci: ["/sop-otomasi"],
  "raci-karyawan": ["/people/raci"],
  koordinasi: ["/network"],
  pohon: ["/network"],
};

export function picformGate(sub: string): readonly string[] | null {
  return MENU[sub.split("/")[0] ?? ""] ?? null;
}
