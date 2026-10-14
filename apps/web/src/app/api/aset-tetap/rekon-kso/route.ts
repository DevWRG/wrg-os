import { teruskanGet } from "../_gerbang";

export const dynamic = "force-dynamic";

// Pratinjau penautan KSO-n ↔ alat KSO (read-only; isinya memuat nama faskes → gerbang 'view').
export const GET = () => teruskanGet("/aset-tetap/rekon-kso");
