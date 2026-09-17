// Klien tipis ke services/ai (FastAPI). Dipakai index.ts (proxy/persist) dan
// repo/agents.ts (agen A1 distillation cascade). api = orkestrator domain yang
// meng-enrich data dari DB sebelum memanggil tier AI.

export const aiBaseUrl = (): string => process.env.AI_URL ?? "http://localhost:8000";

// Apakah memaksa dry_run (tanpa LLM) dari sisi orkestrator? Default: TIDAK —
// keputusan live/dry diserahkan ke services/ai yang memegang OPENROUTER_API_KEY
// (services/ai otomatis fallback ke template bila key tak ada). Set
// AI_DRY_RUN=true untuk memaksa semua agen LLM ke mode dry_run (hemat token / uji).
export const aiDryRun = (): boolean =>
  (process.env.AI_DRY_RUN ?? "").toLowerCase() === "true";

// Batas tunggu satu panggilan ke services/ai. Tanpa ini, services/ai yang
// menggantung ikut menggantungkan pemanggilnya — termasuk processUnprocessed
// yang di-await oleh POST /webhooks/wa, jadi satu foto #KLAIM bisa membekukan
// webhook WA. 30s = sama dengan timeout execFile di infra/wa-bridge.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30000);

// Call services/ai dan parse JSON (untuk pemanggil yang perlu hasil terstruktur).
//
// TIDAK PERNAH melempar. services/ai mati / tak terjangkau / balasan bukan JSON
// dilaporkan sebagai status 503, bukan exception. Alasannya: 19 pemanggil sudah
// punya cabang `if (status >= 400)`, tapi TAK ADA yang menangkap exception —
// jadi fetch yang melempar dulu merambat naik sampai membatalkan seluruh batch
// pemanggilnya. Kasus terburuk yang terbukti: satu #KLAIM berfoto saat
// services/ai mati membatalkan sisa batch processUnprocessed, sementara baris
// itu sendiri sudah ditandai processed_at → klaimnya hilang permanen tanpa
// balasan apa pun ke pengirim. Mengembalikan 503 membuat semua pemanggil masuk
// jalur error yang sudah mereka punya.
export async function callAi(
  aiPath: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${aiBaseUrl()}${aiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    const alasan = err.name === "TimeoutError" || err.name === "AbortError" ? `timeout ${AI_TIMEOUT_MS}ms` : err.message;
    return { status: 503, data: { error: `services/ai tak terjangkau (${aiPath}): ${alasan}` } };
  }
  try {
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  } catch {
    // Status HTTP-nya dipertahankan bila sudah error; hanya balasan 2xx yang
    // tak-JSON yang perlu dipetakan ke 503 (kontrak "data selalu objek").
    return {
      status: res.ok ? 503 : res.status,
      data: { error: `services/ai ${aiPath} balas non-JSON (status ${res.status})` },
    };
  }
}
