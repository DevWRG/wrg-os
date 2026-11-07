#!/usr/bin/env python3
"""Kirim ulang balasan WA yang gagal, dan CATAT ke tempat yang dibaca audit.

Menggantikan dua skrip sekali-pakai (extract + resend) yang dipakai saat
insiden 21 Sep 2026. Alasan disatukan: log kiriman ulang dulu ditulis ke
direktori sesi, lalu harus disalin tangan ke ~/DevWRG/ops/logs/ supaya
audit-plan-harian.sh bisa membacanya. Langkah manual itu pasti terlupakan,
dan begitu terlupakan audit melaporkan "belum dibalas" untuk pesan yang
sebenarnya sudah — persis kesalahan yang mahal ditelusuri.

Sumber teks balasan: log wa-bridge. processed_result di DB TIDAK cukup karena
memangkas galat (lihat ringkasGalat di wasend.ts), sehingga teks pesannya
terpotong di tengah.

Default DRY-RUN. Kirim beneran butuh --live.
Aman diulang: yang sukses tercatat dan dilewati pada jalan berikutnya.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import subprocess
import sys
import time

BRIDGE_LOG = os.path.expanduser("~/.pm2/logs/wrg-prod-wabridge-out.log")
LOG_KIRIM = os.path.expanduser("~/DevWRG/ops/logs/resend-log.jsonl")  # dibaca audit-plan-harian.sh

# Kategori yang TIDAK pernah ikut --scope semua. Masing-masing punya alasan:
TERKUNCI = {
    "alarm",      # alarm "gateway WA mati" yang dikirim lewat WA — sirkular
    "pengingat",  # "belum submit plan" — basi beberapa jam kemudian
    "broadcast",  # broadcast outage yang isinya sering keliru soal data hilang
    "snapshot",   # progres "koran belum lengkap (n/10)" — dilampaui keadaan akhir
}

POLA = re.compile(
    r"^(?P<ts>\S+) \[send\] ERROR → (?P<to>[^:]+): Command failed: "
    r"\S*openclaw\S* message send --channel \S+ --target (?P<tgt>\S+) "
    r"--message (?P<msg>.*?) --json\s*$",
    re.S,
)


def kategori(msg: str) -> str:
    kepala = msg[:200]
    if "Gateway WhatsApp BERMASALAH" in kepala:
        return "alarm"
    if "Gateway WhatsApp sempat mati" in kepala:
        return "broadcast"
    if "Pengingat #PLAN" in kepala:
        return "pengingat"
    if "koran belum lengkap" in msg:
        return "snapshot"
    if "#KORAN" in kepala or "UANG MASUK" in kepala or "dicatat NIHIL" in kepala:
        return "koran"
    if "Plan tercatat" in kepala:
        return "plan"
    return "lain"


def muat(sejak: str) -> list[dict]:
    """Ekstrak percobaan gagal dari log bridge, dedup, urut kronologis."""
    raw = open(BRIDGE_LOG, encoding="utf-8", errors="replace").read()
    bagian = re.split(r"(?m)^(?=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z )", raw)
    uniq: dict[tuple[str, str], list[str]] = collections.OrderedDict()
    for b in bagian:
        m = POLA.match(b.strip("\n"))
        if not m or m.group("ts") < sejak:
            continue
        uniq.setdefault((m.group("tgt"), m.group("msg")), []).append(m.group("ts"))
    keluar = [
        {"to": to, "msg": msg, "percobaan": len(ts), "pertama": min(ts), "kat": kategori(msg)}
        for (to, msg), ts in uniq.items()
    ]
    keluar.sort(key=lambda r: r["pertama"])  # balasan cashin = state machine, urutan penting
    return keluar


def sudah_terkirim() -> set[tuple[str, str]]:
    if not os.path.exists(LOG_KIRIM):
        return set()
    out = set()
    for baris in open(LOG_KIRIM, encoding="utf-8"):
        try:
            o = json.loads(baris)
        except ValueError:
            continue
        if o.get("sent"):
            out.add((o["to"], o["msg"]))
    return out


def gateway_sehat() -> bool:
    try:
        p = subprocess.run(["openclaw", "health"], capture_output=True, text=True, timeout=40)
    except subprocess.TimeoutExpired:
        return False
    keluaran = p.stdout + p.stderr
    return p.returncode == 0 and "Failed to start CLI" not in keluaran and "not reachable" not in keluaran


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", default="semua",
                    choices=["koran", "plan", "lain", "pengingat", "broadcast", "snapshot", "alarm", "semua"])
    ap.add_argument("--sejak", default=time.strftime("%Y-%m-%dT00:00"),
                    help="stempel ISO UTC paling awal (default: hari ini)")
    ap.add_argument("--lewati", default="", help="lewati pesan yang memuat teks ini")
    ap.add_argument("--hanya-grup", action="store_true", dest="hanya_grup",
                    help="hanya tujuan grup (@g.us); berguna untuk melewati notifikasi & pesan tes ke DM")
    ap.add_argument("--prefix", default="", help="teks pembuka, mis. alasan keterlambatan")
    ap.add_argument("--delay", type=float, default=4.0)
    ap.add_argument("--live", action="store_true", help="kirim beneran (tanpa ini: dry-run)")
    a = ap.parse_args()

    if not os.path.exists(BRIDGE_LOG):
        print(f"FATAL: {BRIDGE_LOG} tidak ada", file=sys.stderr)
        return 1

    antrean = [r for r in muat(a.sejak) if r["kat"] not in TERKUNCI or r["kat"] == a.scope]
    if a.scope != "semua":
        antrean = [r for r in antrean if r["kat"] == a.scope]
    if a.lewati:
        antrean = [r for r in antrean if a.lewati not in r["msg"]]
    if a.hanya_grup:
        antrean = [r for r in antrean if r["to"].endswith("@g.us")]
    done = sudah_terkirim()
    antrean = [r for r in antrean if (r["to"], r["msg"]) not in done]

    if not antrean:
        print("Tidak ada balasan tertunda yang perlu dikirim.")
        return 0

    print(f"{'KIRIM LIVE' if a.live else 'DRY-RUN'} · scope={a.scope} · sejak={a.sejak} · {len(antrean)} pesan\n")
    for tujuan, jumlah in collections.Counter(r["to"] for r in antrean).most_common():
        print(f"  {jumlah:3}  {tujuan}")
    print()
    for i, r in enumerate(antrean, 1):
        print(f"[{i}/{len(antrean)}] → {r['to']}: {r['msg'][:70].replace(chr(10), ' ⏎ ')}")

    if not a.live:
        return 0

    if not gateway_sehat():
        print("BATAL: gateway tidak menjawab.", file=sys.stderr)
        return 2
    print("\nMulai kirim dalam 5 detik — Ctrl-C untuk batal.")
    time.sleep(5)

    os.makedirs(os.path.dirname(LOG_KIRIM), exist_ok=True)
    ok = gagal = 0
    for i, r in enumerate(antrean, 1):
        teks = f"{a.prefix}\n\n{r['msg']}" if a.prefix else r["msg"]
        p = subprocess.run(
            ["openclaw", "message", "send", "--channel", "whatsapp",
             "--target", r["to"], "--message", teks, "--json"],
            capture_output=True, text=True, timeout=180,
        )
        sukses = p.returncode == 0
        ok, gagal = ok + sukses, gagal + (not sukses)
        with open(LOG_KIRIM, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"to": r["to"], "msg": r["msg"], "sent": sukses,
                                 "rc": p.returncode, "err": (p.stderr or "")[:300],
                                 "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, ensure_ascii=False) + "\n")
        print(f"[{i}/{len(antrean)}] {'OK  ' if sukses else 'GAGAL'} → {r['to']}")
        if not sukses and gagal >= 3 and ok == 0:
            print("BATAL: 3 gagal beruntun tanpa satu pun sukses — gateway kemungkinan putus.",
                  file=sys.stderr)
            return 3
        time.sleep(a.delay)

    print(f"\nSelesai — {ok} terkirim, {gagal} gagal. Tercatat di {LOG_KIRIM}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
