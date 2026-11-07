"use client";

import { useEffect } from "react";

import { pasangValidasiId } from "@/lib/validasi-browser";

// Pesan validasi bawaan browser → Bahasa Indonesia untuk seluruh aplikasi
// (lihat lib/validasi-browser.ts & lib/pesan-validasi.ts).
export function ValidasiBrowserId() {
  useEffect(() => pasangValidasiId(document), []);
  return null;
}
