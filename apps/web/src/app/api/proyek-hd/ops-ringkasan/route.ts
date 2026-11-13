import { teruskanGet } from "../_gerbang";

export const dynamic = "force-dynamic";

export function GET() {
  return teruskanGet("/proyek-hd/ops-ringkasan");
}
