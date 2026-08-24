// Dev tool (bukan bagian tsc build — di luar `src/`, lihat tsconfig `include`):
// panggil langsung handleCekQuery() dan cetak teks balasan #CEK CUSTOMER apa
// adanya. sendViaWaGateway mode stub TIDAK menyimpan isi pesan (cuma
// {to,sent,stub}), jadi ini satu-satunya cara lihat balasan asli tanpa server
// jalan. Load .env sendiri (parser minimal sama seperti scripts/dev.mjs root
// — server dev biasa tidak jalan di sini, jadi DATABASE_URL belum ke-set).
//
// Pemakaian:
//   pnpm --filter @wrg/api exec tsx scripts/cek-reply.ts "CUSTOMER PT Testing"
//
// Lihat docs/LOCAL-DEV.md bagian "Trial #CEK CUSTOMER (QW3)".

import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadDotEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // no .env — biarkan process.env apa adanya
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key || key in process.env) continue; // shell env menang atas .env
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotEnv(join(import.meta.dirname, "../../../.env"));

const { handleCekQuery } = await import("../src/repo/inbound-cek.js");

const arg = process.argv.slice(2).join(" ").trim();
if (!arg) {
  console.error('Pemakaian: pnpm --filter @wrg/api exec tsx scripts/cek-reply.ts "CUSTOMER <nama>"');
  process.exit(1);
}
const body = arg.toLowerCase().startsWith("#cek") ? arg : `#CEK ${arg}`;
const reply = await handleCekQuery(body);
console.log(reply);
process.exit(0);
