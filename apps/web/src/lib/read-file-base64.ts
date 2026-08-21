// Baca File browser jadi base64 murni (tanpa prefix "data:...;base64,") —
// dipakai form upload yang mengirim file lewat BFF sbg base64 dalam body JSON
// biasa (BFF di app ini cuma proxy JSON, tak ada multipart).
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("gagal membaca file"));
    reader.readAsDataURL(file);
  });
}
