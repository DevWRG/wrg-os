// Izin buka berkas lewat /api/media (foto kunjungan WA + berkas Aset GA).
//
// /api/media dulu hanya mensyaratkan login — siapa pun yang tahu path bisa
// membaca foto kunjungan WA (dan, di dev, berkas aset GA). Sekarang root yang
// boleh dibuka mengikuti izin LIHAT menu pemakainya:
//   "wa" (MEDIA_ROOT, foto kunjungan)       → menu Visits Plan & Report
//   "ga" (GA_UPLOAD_ROOT, foto/dokumen/BA)  → menu Aset GA atau Relokasi Aset
// apps/api /media menolak path di luar root yang dikirim lewat header x-media-scope.

import { featureAllowedAny } from "@/lib/feature-guard";
import type { SessionUserSrv } from "@/lib/admin-guard";

export const MENU_SCOPE = {
  wa: ["/visits"],
  ga: ["/ga-aset", "/ga-relokasi"],
} as const;

export type ScopeMedia = keyof typeof MENU_SCOPE;

export function scopeMedia(me: SessionUserSrv): ScopeMedia[] {
  return (Object.keys(MENU_SCOPE) as ScopeMedia[]).filter((k) => featureAllowedAny(me, MENU_SCOPE[k], "view"));
}
