import { bulanAman, teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const b = bulanAman(new URL(req.url).searchParams.get("bulan"));
  return teruskan(null, `/jadwal-teknisi${b ? `?bulan=${b}` : ""}`, "GET");
}
