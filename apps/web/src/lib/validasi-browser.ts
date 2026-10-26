import { pesanValidasi } from "./pesan-validasi";

type ElemenForm = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const elemenForm = (t: EventTarget | null): t is ElemenForm =>
  t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

// Dipasang sekali (root layout, <ValidasiBrowserId/>): semua tooltip validasi bawaan browser jadi
// Bahasa Indonesia tanpa mengubah form satu per satu (lihat lib/pesan-validasi).
//
// Caranya setCustomValidity saat event `invalid`. Jebakannya: pesan custom
// membuat elemen tetap "invalid" sampai dikosongkan. Dikosongkan di `input` &
// `change`; untuk nilai yang diubah lewat kode (combobox/picker tanpa event
// input) sisa pesan basi dideteksi di `invalid` berikutnya — dikosongkan lalu
// form dikirim ulang sekali, supaya pengguna tak perlu klik dua kali.
// Pesan custom milik komponen lain (bukan buatan kita) tak disentuh.
export function pasangValidasiId(doc: Document): () => void {
  const milikKita = new WeakMap<ElemenForm, string>();
  const kirimUlang = new Set<HTMLFormElement>(); // satu kirim ulang per form per putaran

  const kosongkan = (el: ElemenForm) => {
    if (milikKita.has(el)) {
      el.setCustomValidity("");
      milikKita.delete(el);
    }
  };

  const onInvalid = (e: Event) => {
    const el = e.target;
    if (!elemenForm(el)) return;
    if (milikKita.has(el)) {
      kosongkan(el);
      if (el.validity.valid) {
        // Pesan basi: nilainya sudah benar, cuma belum sempat dikosongkan.
        const form = el.form;
        if (form && !kirimUlang.has(form)) {
          kirimUlang.add(form);
          // setTimeout, bukan microtask: requestSubmit di tengah putaran
          // validasi yang sedang berjalan diabaikan browser (teruji Chromium).
          setTimeout(() => {
            kirimUlang.delete(form);
            form.requestSubmit();
          }, 0);
        }
        return;
      }
    }
    if (el.validity.customError) return; // pesan custom dari komponen lain
    const pesan = pesanValidasi(el);
    if (!pesan) return;
    el.setCustomValidity(pesan);
    milikKita.set(el, pesan);
  };

  const onUbah = (e: Event) => {
    if (elemenForm(e.target)) kosongkan(e.target);
  };

  doc.addEventListener("invalid", onInvalid, true);
  doc.addEventListener("input", onUbah, true);
  doc.addEventListener("change", onUbah, true);
  return () => {
    doc.removeEventListener("invalid", onInvalid, true);
    doc.removeEventListener("input", onUbah, true);
    doc.removeEventListener("change", onUbah, true);
  };
}
