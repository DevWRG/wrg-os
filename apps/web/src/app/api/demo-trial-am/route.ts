import { teruskan } from "../demo-trial/_gerbang";

export const dynamic = "force-dynamic";

// Kandidat AM untuk demo/trial yang dicatat HoD/admin (AM = kosong → atas nama sendiri).
export const GET = () => teruskan(null, "/demo-trial-am", "GET", "view");
