import { teruskan } from "../kampanye/_gerbang";

export const dynamic = "force-dynamic";

// Opsi form kampanye: daftar brand kanonik + AM yang boleh diberi target (scope pemanggil).
export const GET = () => teruskan(null, "/campaign-options", "GET", "view");
