import { teruskanGet, teruskanTulis } from "./_gerbang";

export const dynamic = "force-dynamic";

export const GET = () => teruskanGet("/kso-kontrak");
export const POST = (req: Request) => teruskanTulis(req, "/kso-kontrak", "POST");
