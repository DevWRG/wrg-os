import { teruskanTulis } from "../../_gerbang";

export const dynamic = "force-dynamic";

// Batalkan massal tautan hasil otomatis; tautan manual/konfirmasi tak disentuh.
export const POST = () => teruskanTulis(null, "/aset-tetap/rekon-kso/batalkan-otomatis", "POST");
