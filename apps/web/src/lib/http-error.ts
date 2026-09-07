// Pesan error dari sebuah Response gagal — dipakai klien (komponen) yang
// memanggil BFF `/api/*`.
//
// Alasan ada file ini: 403 dari APLIKASI dan 403 dari EDGE (Cloudflare/proxy di
// depan web) tampak identik di UI. Pola lama di seluruh komponen —
//
//   const body = await res.json().catch(() => ({}));
//   setErr(body?.error || `gagal (${res.status})`);
//
// — menelan halaman HTML challenge Cloudflare menjadi `{}` lalu menampilkan
// "gagal (403)", yang terbaca user & developer sebagai "aplikasi menolak Anda".
// Insiden 2026-09-07: submit "Deal Baru" balas 403 padahal akunnya admin dan
// `createDeal` tak punya jalur 403 sama sekali; penyebabnya Managed Challenge
// Cloudflare — halaman biasa lolos karena browser menyelesaikan challenge
// (cookie `cf_clearance`), tapi fetch()/XHR TIDAK BISA menyelesaikannya, jadi
// begitu cookie itu kedaluwarsa POST berikutnya menerima HTML 403. Waktu
// diagnosis habis di gerbang RBAC yang sebetulnya tak pernah aktif.
//
// Konsekuensi desain: klasifikasi ini bergantung pada respons yang TIDAK
// berasal dari apps/api. BFF selalu membalas JSON (`gateway.relay`), jadi body
// non-JSON = respons itu tak pernah sampai/kembali dari aplikasi.

/** Jejak penolakan lapisan jaringan, bukan aplikasi. `cf-mitigated` dikirim
 * Cloudflare saat challenge/block; header respons same-origin boleh dibaca JS
 * (penyaringan header hanya berlaku untuk respons CORS). */
type EdgeSignal = "cloudflare" | "proxy";

function edgeSignal(res: Response): EdgeSignal | null {
  if (res.headers.get("cf-mitigated")) return "cloudflare";
  // Tanpa header itu: HTML di endpoint yang kontraknya JSON = perantara yang
  // menjawab, bukan BFF kita.
  if ((res.headers.get("content-type") ?? "").includes("text/html")) return "proxy";
  return null;
}

// Dua pesan, karena keyakinannya beda. `cf-mitigated` = Cloudflare MENOLAK
// sebelum request sampai origin → aman menyatakan "tidak tersimpan". HTML tanpa
// header itu cuma berarti "yang menjawab bukan aplikasi kita" — bisa 502/504
// dari perantara SETELAH origin memproses, jadi jangan janjikan apa pun soal
// tersimpan/tidaknya.
const EDGE_MESSAGE: Record<EdgeSignal, string> = {
  cloudflare:
    "Permintaan diblokir lapisan jaringan (Cloudflare), bukan oleh aplikasi — data Anda tidak tersimpan. " +
    "Muat ulang halaman lalu kirim lagi; kalau terus terjadi, laporkan ke admin (aturan WAF/Bot Fight Mode).",
  proxy:
    "Respons tidak berasal dari aplikasi — ada perantara jaringan yang menjawab. " +
    "Muat ulang halaman lalu periksa apakah perubahan Anda masuk sebelum mengirim ulang.",
};

export interface HttpFailure {
  /** Siap ditampilkan ke user; status code SELALU ikut — "gagal" tanpa angka
   * menyulitkan penelusuran. */
  message: string;
  /** true = ditolak sebelum sampai aplikasi (Cloudflare/proxy). */
  edge: boolean;
  status: number;
}

/** Baca Response gagal SEKALI, lalu klasifikasikan. Jangan panggil untuk
 * respons ok — body-nya habis terbaca di sini. */
export async function httpFailure(res: Response, fallback = "gagal"): Promise<HttpFailure> {
  const signal = edgeSignal(res);
  if (signal) {
    // Body-nya sengaja TIDAK dibaca/ditampilkan: 5 KB markup challenge tak
    // berguna bagi user dan hanya menenggelamkan kalimat yang penting.
    return { message: `${EDGE_MESSAGE[signal]} (${res.status} ${signal})`, edge: true, status: res.status };
  }
  const text = await res.text().catch(() => "");
  let error: unknown;
  try {
    error = text ? (JSON.parse(text) as { error?: unknown }).error : undefined;
  } catch {
    // Bukan JSON dan tanpa penanda edge (mis. body kosong dari proxy) —
    // kegagalan tak terklasifikasi, jangan disajikan sbg pesan aplikasi.
    error = undefined;
  }
  const head = typeof error === "string" && error.trim() ? error.trim() : fallback;
  return { message: `${head} (${res.status})`, edge: false, status: res.status };
}

/** Bentuk singkat bila pemanggil hanya butuh teksnya. */
export async function httpErrorMessage(res: Response, fallback = "gagal"): Promise<string> {
  return (await httpFailure(res, fallback)).message;
}
