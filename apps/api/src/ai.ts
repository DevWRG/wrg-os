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

// Nilai `model` yang dipakai services/ai saat LLM SEHARUSNYA jalan tapi gagal
// (key ditolak, kuota habis, semua model error) dan ia balas template.
//
// Bedakan baik-baik dari "dry-run": `model: "dry-run"` = sengaja tanpa LLM
// (AI_DRY_RUN / tanpa API key) dan itu sah. `model: "dry-run-fallback"` =
// KEGAGALAN yang menyamar jadi sukses 200.
const MODEL_DEGRADASI = "dry-run-fallback";

// Penghitung degradasi sejak proses hidup — dipapar di GET /health supaya
// "AI-nya diam-diam mati" bisa dipantau tanpa menunggu ada orang membaca log.
const degradasi = { total: 0, terakhirPath: "", terakhirAt: "" };

export const statistikDegradasiAi = (): { total: number; terakhir_path: string; terakhir_at: string } => ({
  total: degradasi.total,
  terakhir_path: degradasi.terakhirPath,
  terakhir_at: degradasi.terakhirAt,
});

export interface CallAiOpts {
  /** Terima teks template apa adanya saat LLM gagal, alih-alih memperlakukannya
   *  sebagai error. HANYA untuk pemanggil yang templatenya memang produk yang
   *  sah. Default false — lihat catatan di callAi. */
  izinkanTemplate?: boolean;
  /** Batas tunggu khusus panggilan ini (ms). Tanpa opsi ini perilaku lama
   *  (tanpa batas) dipertahankan untuk semua pemanggil lain. */
  timeoutMs?: number;
}

// Call services/ai dan parse JSON (untuk pemanggil yang perlu hasil terstruktur).
//
// HASIL TERDEGRADASI DIPERLAKUKAN SEBAGAI ERROR (port #1428 dari dev, 5 Nov 2026).
//
// services/ai membalas 200 + teks template saat LLM gagal, dengan penanda
// `model: "dry-run-fallback"`. Buat pemanggil, 200 itu terlihat sukses — jadi
// templatenya ikut DISIMPAN dan DIKIRIM seolah hasil sungguhan. Terjadi 25 Sep
// 2026 (dump prompt masuk monitor_digest 'rekap') dan 5 Nov 2026 (limit key
// OpenRouter habis → dump prompt Daily Summary terkirim ke grup WA).
//
// Ditegakkan DI SINI, bukan di tiap pemanggil: yang terlewat gagal ke arah aman
// — semua pemanggil di main punya cabang `if (status >= 400)` atau try/catch,
// dan cabang itu tidak menyimpan dan tidak mengirim. Pemanggil yang templatenya
// memang produk sah memakai `izinkanTemplate` (di main belum ada).
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
  const data = (await res.json()) as Record<string, unknown>;
  if (res.ok && data.model === MODEL_DEGRADASI) {
    degradasi.total += 1;
    degradasi.terakhirPath = aiPath;
    degradasi.terakhirAt = new Date().toISOString();
    // console.error, bukan warn: ini kegagalan yang sebelumnya tak
    // meninggalkan satu baris pun di log mana pun.
    console.error(
      `[ai] DEGRADASI ${aiPath}: LLM gagal, services/ai balas template (model=${MODEL_DEGRADASI}). ` +
        "Hasil TIDAK dipakai. Cek kuota/key OpenRouter.",
    );
    if (!opts.izinkanTemplate) {
      return {
        status: 503,
        data: {
          error:
            `services/ai ${aiPath}: LLM gagal dan hasilnya cuma template — tidak dipakai. ` +
            "Cek kuota/key OpenRouter.",
          degraded: true,
          model: MODEL_DEGRADASI,
        },
      };
    }
  }
  return { status: res.status, data };
}
