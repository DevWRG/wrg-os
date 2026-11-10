// Salin teks ke clipboard. navigator.clipboard hanya ada di konteks aman (https/localhost); dashboard
// yang dibuka lewat http://IP (stack dev) → cadangan execCommand("copy") lewat textarea tersembunyi
// (pola components/brosur/brosur-view.tsx). false = gagal → pemanggil menampilkan teks untuk disalin manual.
export async function salinTeks(teks: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(teks);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = teks;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
