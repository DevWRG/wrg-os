import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const semua = new URL(req.url).searchParams.get("semua") === "1";
  return teruskan(null, `/materi${semua ? "?semua=1" : ""}`, "GET", "view");
}
export const POST = (req: Request) => teruskan(req, "/materi", "POST", "create");
