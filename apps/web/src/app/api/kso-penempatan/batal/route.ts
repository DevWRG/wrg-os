import { teruskanTulis } from "../_gerbang";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => teruskanTulis(req, "/kso-penempatan/batal");
