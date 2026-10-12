import { teruskanTulis } from "../_gerbang";

export const dynamic = "force-dynamic";

// Picu sinkron cermin aset tetap dari Accurate (berjalan di latar, ≈10 menit).
export const POST = () => teruskanTulis(null, "/accurate/sync/fixed-assets", "POST");
