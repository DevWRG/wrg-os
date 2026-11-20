// Pemilihan tab untuk halaman hasil peleburan menu (evaluasi menu 19 Nov 2026).
// Server page menghitung tab yang BOLEH dilihat user (navOwnVisible untuk tab
// induk, tabVisible untuk tab dari menu yang dilebur), lalu merender HANYA tab
// aktif — data tab yang tak diizinkan tak pernah diambil.

export interface DefTab { key: string; label: string }

// Tab aktif = ?tab= bila diizinkan; selain itu tab pertama yang diizinkan.
// null = tak ada tab yang boleh dilihat (gerbang rute mestinya sudah menolak).
export function pilihTab(diizinkan: readonly DefTab[], diminta: string | string[] | undefined): string | null {
  const minta = Array.isArray(diminta) ? diminta[0] : diminta;
  if (minta && diizinkan.some((t) => t.key === minta)) return minta;
  return diizinkan[0]?.key ?? null;
}
