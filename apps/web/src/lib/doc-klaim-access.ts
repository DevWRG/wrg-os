// Cermin aturan wewenang DOC #KLAIM di apps/api/src/repo/doc-klaim.ts
// (alasanTolakPutus / alasanTolakBayar). Dipakai UI untuk menyembunyikan
// tombol dan menjelaskan siapa yang berwenang — SERVER tetap penentu akhir.
//
// Keputusan user 15 Okt 2026: setujui/tolak = HoD pengaju (atau Direktur/
// admin), tandai dibayar = grup Finance (finance-hod) atau admin; pengaju
// tak boleh memutus/membayar klaimnya sendiri.

export interface PemutusKlaim {
  amId: string | null;
  hodKey: string | null;
  role: string | null;
  superuser: boolean;
  finance: boolean;
}

const istimewa = (a: PemutusKlaim): boolean =>
  a.superuser || a.role === "admin" || a.role === "direktur";

export function alasanTolakPutus(k: { am_id: string | null; hod_key: string | null }, a: PemutusKlaim): string | null {
  if (a.amId && k.am_id && a.amId === k.am_id) return "Klaim sendiri — diputus HoD-mu.";
  if (istimewa(a)) return null;
  if (!k.hod_key) return "Menunggu Direktur/admin (HoD pengaju tak tercatat).";
  if (a.hodKey && a.hodKey === k.hod_key) return null;
  return "Menunggu HoD pengaju.";
}

export function alasanTolakBayar(k: { am_id: string | null }, a: PemutusKlaim): string | null {
  if (a.amId && k.am_id && a.amId === k.am_id) return "Klaim sendiri — dibayar Finance.";
  if (a.finance || a.superuser || a.role === "admin") return null;
  return "Menunggu pembayaran Finance.";
}
