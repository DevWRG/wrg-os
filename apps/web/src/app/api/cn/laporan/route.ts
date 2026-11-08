import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return teruskan(null, `/cn/laporan${new URL(req.url).search}`, "GET", "view");
}
