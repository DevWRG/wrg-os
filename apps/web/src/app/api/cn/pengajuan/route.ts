import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return teruskan(null, `/cn/pengajuan${new URL(req.url).search}`, "GET", "view");
}
export const POST = (req: Request) => teruskan(req, "/cn/pengajuan", "POST", "create");
