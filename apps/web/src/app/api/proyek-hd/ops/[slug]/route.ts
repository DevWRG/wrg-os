import { idAman, slugAman, teruskanGet, teruskanJson } from "../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };
const tolak = () => Response.json({ error: "tab tidak valid" }, { status: 400 });

export async function GET(req: Request, ctx: Ctx) {
  const slug = slugAman((await ctx.params).slug);
  if (!slug) return tolak();
  const pid = new URL(req.url).searchParams.get("proyek_id");
  const aman = pid ? idAman(pid) : null;
  if (pid && !aman) return Response.json({ error: "proyek_id tidak valid" }, { status: 400 });
  return teruskanGet(`/proyek-hd/ops/${slug}${aman ? `?proyek_id=${aman}` : ""}`);
}

export async function POST(req: Request, ctx: Ctx) {
  const slug = slugAman((await ctx.params).slug);
  return slug ? teruskanJson(req, `/proyek-hd/ops/${slug}`, "POST", "create") : tolak();
}
