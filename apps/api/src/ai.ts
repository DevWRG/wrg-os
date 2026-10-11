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

export interface CallAiOpts {
  /** Batas tunggu khusus panggilan ini (ms). Tanpa opsi ini perilaku lama
   *  (tanpa batas) dipertahankan untuk semua pemanggil lain. */
  timeoutMs?: number;
}

// Call services/ai dan parse JSON (untuk pemanggil yang perlu hasil terstruktur).
export async function callAi(
  aiPath: string,
  body: unknown,
  opts: CallAiOpts = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${aiBaseUrl()}${aiPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}
