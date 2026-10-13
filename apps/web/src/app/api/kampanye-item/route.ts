import { teruskan } from "../kampanye/_gerbang";

export const dynamic = "force-dynamic";

// Cari item Accurate (nama/kode) untuk dipilih ke kampanye.
export function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  return teruskan(null, `/campaign-items?q=${encodeURIComponent(q)}`, "GET", "view");
}
