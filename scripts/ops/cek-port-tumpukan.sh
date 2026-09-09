#!/usr/bin/env bash
# Preflight port untuk tumpukan pm2 — jalankan SEBELUM `pm2 start`.
#
# Kenapa ada: penjaga di ecosystem.config.cjs memvalidasi checkout, DATABASE_URL,
# dan nama database — TAPI TIDAK port. Tanpa cek ini, tumpukan yang port-nya
# bentrok tetap terdaftar, pm2 melaporkan "online", lalu prosesnya gagal bind dan
# berhenti di `errored` — sementara URL yang kamu buka menampilkan tumpukan LAIN
# yang memegang port itu. Gagal sambil terlihat berhasil.
#
# Cek ini TIDAK ditaruh di ecosystem.config.cjs dengan sengaja: di sana ia akan
# melihat port yang dipegang proses itu sendiri saat `pm2 restart` lalu menghapus
# entrinya — restart biasa berubah jadi mati total.
#
# Pakai:
#   scripts/ops/cek-port-tumpukan.sh           # semua tumpukan
#   scripts/ops/cek-port-tumpukan.sh dev       # hanya port tumpukan dev
#
# Keluar 0 = semua port yang diminta bebas (atau dipegang proses pm2 tumpukan itu
# sendiri, yang berarti sudah jalan). Keluar 1 = ada bentrok nyata, ATAU tak ada
# satu pun port yang bisa diperiksa — keduanya sama-sama bukan lampu hijau.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILTER="${1:-semua}"

# Port dibaca DARI ecosystem, bukan ditulis ulang di sini — supaya skrip ini tak
# bisa menyimpang dari konfigurasi yang sebenarnya dipakai pm2.
PETA="$(node -e '
const c = require(process.argv[1] + "/ecosystem.config.cjs");
for (const a of c.apps) {
  const p = a.env?.PORT || (a.args || "").match(/(?:-p|--port)\s+(\d+)/)?.[1];
  if (p) console.log(`${a.name}\t${p}`);
}
' "$ROOT" 2>/dev/null)"

if [ -z "$PETA" ]; then
  echo "GAGAL: tak bisa membaca ecosystem.config.cjs di $ROOT" >&2
  exit 1
fi

# Tumpukan demo hidup di checkout terpisah, di luar repo ini. Ia tidak akan
# muncul di peta di atas, jadi kita tambahkan supaya laporannya jujur.
DEMO_CFG="$(dirname "$ROOT")/wrg-os-demo/ecosystem.demo.config.cjs"
if [ -f "$DEMO_CFG" ]; then
  PETA="$PETA
$(node -e '
const c = require(process.argv[1]);
for (const a of c.apps) {
  const p = a.env?.PORT || (a.args || "").match(/(?:-p|--port)\s+(\d+)/)?.[1];
  if (p) console.log(`${a.name}\t${p}`);
}
' "$DEMO_CFG" 2>/dev/null)"
fi

printf '%-18s %-6s %s\n' "PROSES" "PORT" "PEMEGANG SEKARANG"
printf '%-18s %-6s %s\n' "------------------" "------" "-----------------------------"

bentrok=0
diperiksa=0
while IFS=$'\t' read -r nama port; do
  [ -z "${port:-}" ] && continue
  case "$FILTER" in
    semua) ;;
    *) [[ "$nama" == *"-$FILTER-"* ]] || continue ;;
  esac
  diperiksa=$((diperiksa + 1))

  pid="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | head -1)"
  if [ -z "$pid" ]; then
    printf '%-18s %-6s %s\n' "$nama" "$port" "kosong"
    continue
  fi

  # Siapa pemegangnya? Kalau pm2 mencatat pid itu sebagai proses dengan nama yang
  # sama, berarti tumpukannya memang sudah jalan — bukan bentrok.
  milik="$(pm2 jlist 2>/dev/null | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const pid = Number(process.argv[1]);
  try {
    const p = JSON.parse(s).find((x) => x.pid === pid);
    console.log(p ? p.name : "");
  } catch { console.log(""); }
});
' "$pid" 2>/dev/null)"

  if [ "$milik" = "$nama" ]; then
    printf '%-18s %-6s %s\n' "$nama" "$port" "$nama (sudah jalan, pid $pid)"
  else
    cmd="$(ps -p "$pid" -o comm= 2>/dev/null | xargs -0 basename 2>/dev/null || echo "?")"
    printf '%-18s %-6s %s\n' "$nama" "$port" "BENTROK ← ${milik:-$cmd} (pid $pid)"
    bentrok=$((bentrok + 1))
  fi
done <<< "$PETA"

echo

# ⚠️ Nol port diperiksa BUKAN kabar baik. Kalau entri dev tak terdaftar (mis.
# .env.dev belum ada), filter "dev" tak menemukan apa pun — dan tanpa cek ini
# skrip akan mencetak "aman" setelah memeriksa nol port. Persis kegagalan-senyap
# yang jadi alasan skrip ini ada.
if [ "$diperiksa" -eq 0 ]; then
  echo "TIDAK ADA port yang diperiksa untuk filter '$FILTER'." >&2
  if [ "$FILTER" = "dev" ]; then
    echo "Artinya entri dev belum terdaftar di ecosystem — bukan berarti port-nya bebas." >&2
    echo "Jalankan ini untuk melihat sebabnya:" >&2
    echo "  node -e \"require('$ROOT/ecosystem.config.cjs')\" 2>&1 | grep ecosystem" >&2
  fi
  exit 1
fi

if [ "$bentrok" -gt 0 ]; then
  echo "$bentrok port BENTROK. Jangan pm2 start dulu — prosesnya akan terdaftar," >&2
  echo "lapor 'online', lalu mati diam-diam sementara port itu menyajikan tumpukan lain." >&2
  exit 1
fi

echo "Semua port bebas (atau dipegang tumpukannya sendiri). Aman untuk pm2 start."
