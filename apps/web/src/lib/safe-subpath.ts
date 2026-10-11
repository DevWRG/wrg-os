// Validasi segmen path untuk route BFF catch-all (`[...path]`) sebelum
// diteruskan ke gateway apps/api. Hanya segmen "polos" yang diterima: huruf,
// angka, dan - _ . (tanpa segmen yang seluruhnya titik). Segmen lain ditolak
// 400 — proxy cukup meneruskan sub-route yang memang dimiliki fitur itu.

const SEGMEN_SAH = /^[A-Za-z0-9_.-]+$/;

export function safeSubpath(path: string[] | undefined | null): string | null {
  const segs = path ?? [];
  for (const s of segs) {
    if (!SEGMEN_SAH.test(s) || /^\.+$/.test(s)) return null;
  }
  return segs.join("/");
}

export const badSubpath = (): Response => Response.json({ error: "path tidak valid" }, { status: 400 });
