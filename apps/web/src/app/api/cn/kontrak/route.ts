import { teruskan } from "../_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return teruskan(null, `/cn/kontrak${new URL(req.url).search}`, "GET", "view");
}
export const POST = (req: Request) => teruskan(req, "/cn/kontrak", "POST", "create");
