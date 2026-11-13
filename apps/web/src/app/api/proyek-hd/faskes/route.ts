import { teruskanGet } from "../_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  return teruskanGet(`/proyek-hd/faskes?q=${encodeURIComponent(q)}`);
}
