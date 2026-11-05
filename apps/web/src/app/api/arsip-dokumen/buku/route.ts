import { teruskanGet, teruskanJson } from "../_gerbang";

export const dynamic = "force-dynamic";

export const GET = () => teruskanGet("/arsip-dokumen/buku");
export const POST = (req: Request) => teruskanJson(req, "/arsip-dokumen/buku", "POST", "buku");
