import { teruskan } from "../leads/_gerbang";

export const dynamic = "force-dynamic";

// Kandidat AM untuk penunjukan lead (HoD = AM cabang timnya; AM = kosong).
export const GET = () => teruskan(null, "/leads-am", "GET", "view");
