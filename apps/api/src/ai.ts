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
}

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
//
// HASIL TERDEGRADASI DIPERLAKUKAN SEBAGAI ERROR (25 Sep 2026).
//
// services/ai membalas 200 + teks template saat LLM gagal, dengan penanda
// `model: "dry-run-fallback"`. Buat pemanggil, 200 itu terlihat sukses — jadi
// templatenya ikut DISIMPAN dan DIKIRIM seolah hasil sungguhan. Yang terjadi
// 25 Sep 2026 saat kuota OpenRouter habis: dua baris `monitor_digest` kind
// 'rekap' terisi DUMP PROMPT ("[DRY RUN — tanpa LLM] SYSTEM: ..."), satu di
// antaranya 54.878 karakter. generateResume membaca rekap dari tabel yang sama,
// jadi kesalahannya berantai; daily-summary jam 22:00 akan mengirim dump itu ke
// grup direksi.
//
// Ditegakkan DI SINI, bukan di 20 pemanggil satu per satu: menambal per
// pemanggil berarti yang terlewat gagal ke arah yang berbahaya. Di sini yang
// terlewat gagal ke arah aman — semua pemanggil sudah punya cabang
// `if (status >= 400)`, dan cabang itu tidak menyimpan dan tidak mengirim.
// Pemanggil yang templatenya memang produk sah memakai `izinkanTemplate`.
export async function callAi(
  aiPath: string,
  body: unknown,
  opts: CallAiOpts = {},
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
    const data = (await res.json()) as Record<string, unknown>;
    if (res.ok && data.model === MODEL_DEGRADASI) {
      degradasi.total += 1;
      degradasi.terakhirPath = aiPath;
      degradasi.terakhirAt = new Date().toISOString();
      // console.error, bukan warn: ini kegagalan yang sebelumnya tak
      // meninggalkan satu baris pun di log mana pun.
      console.error(
        `[ai] DEGRADASI ${aiPath}: LLM gagal, services/ai balas template (model=${MODEL_DEGRADASI}). ` +
          `Hasil TIDAK dipakai. Cek kuota/key OpenRouter (lihat job notif-quota).`,
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
  } catch {
    // Status HTTP-nya dipertahankan bila sudah error; hanya balasan 2xx yang
    // tak-JSON yang perlu dipetakan ke 503 (kontrak "data selalu objek").
    return {
      status: res.ok ? 503 : res.status,
      data: { error: `services/ai ${aiPath} balas non-JSON (status ${res.status})` },
    };
  }
}
