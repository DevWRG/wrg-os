// Dipakai add/edit sheet Uji Profisiensi (F25) — BFF di app ini cuma proxy
// JSON (lihat gateway.ts), jadi file dikirim sbg base64 dalam body JSON biasa
// (bukan multipart) supaya tak perlu tambah parsing multipart baru di Hono API.
export async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
