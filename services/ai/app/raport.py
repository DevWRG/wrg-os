"""Raport 360 — narasi penilaian kinerja (Fase 3).

Input = `signals` (dict metrik+konteks raport 1 karyawan/periode dari apps/api).
Output = struktur JSON: verdict, headline, pantas_puas[], penahan[], bsc{},
akar_masalah, catatan_adil, ringkasan, predikat.

`template_raport` = fallback DETERMINISTIK dari angka (dipakai saat dry-run / LLM
gagal) supaya narasi tetap ada & jujur (tak mengarang). LLM memperkaya prosa.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

RAPORT_KEYS = ["verdict", "headline", "pantas_puas", "penahan", "bsc", "akar_masalah", "catatan_adil", "ringkasan", "predikat"]


def build_raport_system(period_label: str) -> str:
    return (
        "Anda analis SDM WRG. Tulis penilaian kinerja karyawan yang ADIL, ringkas, "
        "berbasis DATA yang diberikan — JANGAN mengarang angka/fakta di luar signals. "
        "Bahasa Indonesia, gaya profesional & lugas. Bedakan kegagalan internal (tanggung "
        "jawab karyawan) vs blokir eksternal (di luar kendali — jangan dihukum). "
        f"Periode: {period_label}. "
        "BALAS HANYA JSON valid (tanpa markdown/code fence) dengan kunci persis: "
        "verdict (ya|bersyarat|tidak), headline (1 kalimat), pantas_puas (array kalimat), "
        "penahan (array kalimat), bsc (objek {fin,cust,proc,learn} tiap nilai 1 kalimat), "
        "akar_masalah (1-2 kalimat), catatan_adil (1-2 kalimat), ringkasan (2-3 kalimat), "
        "predikat (mis. 'Baik & Solid')."
    )


def build_raport_user(sig: Dict[str, Any]) -> str:
    return "Data raport (JSON):\n" + json.dumps(sig, ensure_ascii=False, default=str)


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def template_raport(sig: Dict[str, Any]) -> Dict[str, Any]:
    """Fallback terstruktur dari angka (tanpa LLM)."""
    nama = str(sig.get("nama") or sig.get("panggilan") or "Karyawan")
    period = str(sig.get("period_label") or "")
    score = sig.get("score") or {}
    overall = score.get("overall")
    rating = str(score.get("rating") or "—")
    parts: List[Dict[str, Any]] = sig.get("parts") or []
    workload = sig.get("workload") or {}
    total = int(_num(workload.get("total")))
    success = int(_num(workload.get("success")))
    pending = int(_num(workload.get("pending")))
    failures: List[Dict[str, Any]] = sig.get("failures") or []
    blockers: List[Dict[str, Any]] = sig.get("blockers") or []
    compliance = sig.get("compliance")

    ov = _num(overall) if overall is not None else None
    verdict = "ya" if (ov is not None and ov >= 83) else ("bersyarat" if (ov is not None and ov >= 70) else "tidak")

    pantas: List[str] = []
    penahan: List[str] = []
    for p in parts:
        sc = p.get("score")
        if sc is None:
            continue
        lbl = str(p.get("label"))
        if _num(sc) >= 90:
            pantas.append(f"{lbl} kuat (skor {int(_num(sc))}).")
        elif _num(sc) < 80:
            penahan.append(f"{lbl} perlu perbaikan (skor {int(_num(sc))}).")
    if total:
        pct = round(success / total * 100)
        pantas.insert(0, f"{total} item dilaporkan, {pct}% berhasil langsung.")
    if compliance is not None:
        pantas.append(f"Kepatuhan pelaporan {int(_num(compliance))}%.")
    if not pantas:
        pantas.append("Belum ada capaian menonjol pada periode ini.")
    if pending:
        penahan.append(f"{pending} item masih tertunda.")
    if not penahan:
        penahan.append("Tidak ada catatan perbaikan signifikan.")

    bsc_in = (sig.get("bsc") or {}).get("persp") or {}
    persp_label = {"fin": "Keuangan", "cust": "Pelanggan internal", "proc": "Proses internal", "learn": "Pembelajaran"}
    bsc_out: Dict[str, str] = {}
    for k, lbl in persp_label.items():
        if k in bsc_in and bsc_in[k] is not None:
            bsc_out[k] = f"{lbl}: skor {int(_num(bsc_in[k]))}."
        else:
            bsc_out[k] = "Belum ada data."

    akar = (
        f"Dominasi kegagalan pada {failures[0].get('label')} dan sejenis ({len(failures)} item internal belum tuntas)."
        if failures else "Tidak ada kegagalan internal berulang yang menonjol."
    )
    catatan = (
        f"{len(blockers)} item menunggu pihak lain (blokir eksternal) — di luar kendali & tidak mengurangi nilai."
        if blockers else "Tidak ada blokir eksternal berarti pada periode ini."
    )
    ringkasan = (
        f"Kinerja {nama} periode {period} berada di zona {rating}"
        + (f" (indeks {int(ov)}/100)" if ov is not None else "")
        + f". Total {total} item ditangani"
        + (f", {round(success / total * 100)}% berhasil langsung" if total else "")
        + ". "
        + ("Fokus perbaikan: " + penahan[0] if penahan else "Pertahankan konsistensi.")
    )
    return {
        "verdict": verdict,
        "headline": f"Kinerja {nama} periode {period}: {rating}"
        + (f" (indeks {int(ov)}/100)" if ov is not None else "") + ".",
        "pantas_puas": pantas[:6],
        "penahan": penahan[:6],
        "bsc": bsc_out,
        "akar_masalah": akar,
        "catatan_adil": catatan,
        "ringkasan": ringkasan,
        "predikat": rating,
    }


def parse_raport(text: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
    """Parse JSON dari output LLM; jika gagal/kunci kurang → fallback."""
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        nl = raw.find("\n")
        if nl != -1 and raw[:nl].strip().lower() in ("json", ""):
            raw = raw[nl + 1 :]
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return fallback
    if not isinstance(data, dict):
        return fallback
    out = dict(fallback)
    for k in RAPORT_KEYS:
        if k in data and data[k]:
            out[k] = data[k]
    # normalisasi: pastikan list untuk pantas_puas/penahan, dict untuk bsc
    for lk in ("pantas_puas", "penahan"):
        if not isinstance(out.get(lk), list):
            out[lk] = fallback[lk]
    if not isinstance(out.get("bsc"), dict):
        out["bsc"] = fallback["bsc"]
    return out
