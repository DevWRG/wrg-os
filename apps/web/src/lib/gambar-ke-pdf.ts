// PDF satu halaman berisi satu gambar JPEG, ditulis tangan supaya tidak perlu
// menambah dependensi PDF hanya untuk "unduh bagan sebagai PDF". JPEG bisa
// ditanam apa adanya (filter DCTDecode) — PNG tidak, karena PDF butuh data
// piksel PNG dibongkar dulu.
//
// Ukuran halaman (pt) dipilih pemanggil; gambar direntang memenuhi halaman.

export function jpegKePdf(
  jpeg: Uint8Array,
  lebarPx: number,
  tinggiPx: number,
  lebarPt: number,
  tinggiPt: number,
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const bagian: Uint8Array[] = [];
  const offset: number[] = [];
  let panjang = 0;
  const tulis = (b: Uint8Array | string) => {
    const u = typeof b === "string" ? enc.encode(b) : b;
    bagian.push(u);
    panjang += u.length;
  };
  const objek = (n: number) => {
    offset[n] = panjang;
    tulis(`${n} 0 obj\n`);
  };

  const W = lebarPt.toFixed(2);
  const H = tinggiPt.toFixed(2);
  const isi = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`;

  tulis("%PDF-1.4\n");
  objek(1); tulis("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objek(2); tulis("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objek(3);
  tulis(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
    "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n");
  objek(4);
  tulis(`<< /Type /XObject /Subtype /Image /Width ${lebarPx} /Height ${tinggiPx} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  tulis(jpeg);
  tulis("\nendstream\nendobj\n");
  objek(5); tulis(`<< /Length ${enc.encode(isi).length} >>\nstream\n${isi}endstream\nendobj\n`);

  const xref = panjang;
  tulis("xref\n0 6\n0000000000 65535 f \n");
  for (let n = 1; n <= 5; n++) tulis(`${String(offset[n]).padStart(10, "0")} 00000 n \n`);
  tulis(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const hasil = new Uint8Array(panjang);
  let i = 0;
  for (const b of bagian) { hasil.set(b, i); i += b.length; }
  return hasil;
}

// Data URL PNG (hasil ekspor bagan, di-render `skala`× ukuran layar) → Blob PDF.
// Halaman seukuran bagan di layar (1 px CSS = 0,75 pt), jadi teksnya tetap
// sebesar yang dilihat orang; resolusi ekstra dari `skala` menjaga ketajaman
// saat di-zoom atau dicetak.
export async function pngKePdf(dataUrl: string, skala: number): Promise<Blob> {
  const img = new Image();
  await new Promise<void>((ok, gagal) => {
    img.onload = () => ok();
    img.onerror = () => gagal(new Error("gambar bagan gagal dimuat"));
    img.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  // JPEG tak punya transparansi — tanpa latar putih, area kosong jadi hitam.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const b64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  const jpeg = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pdf = jpegKePdf(
    jpeg, canvas.width, canvas.height,
    (canvas.width / skala) * 0.75, (canvas.height / skala) * 0.75,
  );
  return new Blob([pdf], { type: "application/pdf" });
}
