import { teruskanGet, teruskanJson } from "./_gerbang";

export const dynamic = "force-dynamic";

export function GET() {
  return teruskanGet("/proyek-hd");
}

export function POST(req: Request) {
  return teruskanJson(req, "/proyek-hd", "POST", "create");
}
