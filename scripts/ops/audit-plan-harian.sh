#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# audit-plan-harian.sh — cek #PLAN hari ini: mana yang belum dibalas.
#
# Latar: 21 Sep 2026, balasan WA mati ~15 jam tanpa satu pun error. Puluhan
# #PLAN tercatat tapi pengirimnya tak pernah dapat ack, dan itu baru ketahuan
# karena orang membuka grup satu per satu. Skrip ini menjawab pertanyaan itu
# tiap pagi, otomatis.
#
# Sebuah #PLAN dianggap SUDAH dibalas bila salah satu benar:
#   - processed_result.reply.sent = true          (balasan otomatis berhasil)
#   - teks balasannya ada di log kiriman ulang     (dipulihkan manual)
#
# CATATAN PENCOCOKAN (mahal dipelajari, jangan disederhanakan):
#   1. processed_result memangkas galat, jadi penanda ' --json' sering hilang —
#      ekstraksi harus punya cabang tanpa penanda itu.
#   2. Galatnya JSON BERLAPIS: baris baru tersimpan sebagai literal \n,
#      sedangkan log kiriman menyimpan baris baru sungguhan. Tanpa normalisasi,
#      pencocokan gagal total dan skrip melaporkan puluhan "belum dibalas"
#      palsu. Ini persis yang terjadi pada dua percobaan audit pertama.
#   3. wa_message memuat baris duplikat (satu pesan bisa 3-7 baris identik),
#      jadi hitungan mentah melebihkan. Laporan memisahkan baris vs pesan unik.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

LOG_DIR="$HOME/DevWRG/ops/logs"
LOG="$LOG_DIR/audit-plan-harian.log"
# Default HARUS lokasi tetap, bukan kosong. Kalau kosong, skrip tak membaca
# riwayat kiriman ulang sama sekali dan melaporkan "belum dibalas" untuk
# pesan yang sebenarnya sudah — kesalahan yang persis ingin dicegah skrip ini.
KIRIM_LOG="${AUDIT_KIRIM_LOG:-$HOME/DevWRG/ops/logs/resend-log.jsonl}"
BRIDGE_SEND="http://127.0.0.1:18080/send"
ALERT_WA="+6285733048855"
mkdir -p "$LOG_DIR"

RINGKAS=$(python3 - "$KIRIM_LOG" <<'PY'
import json, os, re, subprocess, sys

kirim_log = sys.argv[1] if len(sys.argv) > 1 else ""

q = """SELECT to_char(received_at AT TIME ZONE 'Asia/Jakarta','HH24:MI'),
              coalesce(group_name, group_jid), coalesce(sender_name,'?'),
              coalesce(processed_kind,'(blm)'), coalesce(processed_result::text,''),
              left(replace(coalesce(body,''), chr(10), ' '), 60)
       FROM wa_message
       WHERE received_at::date = current_date AND body ~* '#\\s*plan'
       ORDER BY received_at"""
p = subprocess.run(["psql","-U","wrg_readonly","-d","wrg_os_prod","-At","-F","\t","-c",q],
                   capture_output=True, text=True, timeout=120)
if p.returncode != 0:
    print("GAGAL: psql tak menjawab — " + p.stderr.strip()[:120]); raise SystemExit

def norm(s):
    s = s.replace("\\n", " ").replace("\\t", " ").replace('\\"', '"')
    return re.sub(r"\s+", "", s).lower()

terkirim = []
if kirim_log and os.path.exists(kirim_log):
    for baris in open(kirim_log, encoding="utf-8"):
        try:
            o = json.loads(baris)
        except ValueError:
            continue
        if o.get("sent"):
            terkirim.append(norm(o["msg"]))

def ekstrak(err):
    m = re.search(r"--message (.*?) --json", err, re.S) or re.search(r"--message (.*)$", err, re.S)
    return m.group(1) if m else None

baris_total = 0
unik = set()
otomatis = ulang = 0
belum = []
for r in p.stdout.strip().split("\n"):
    if not r:
        continue
    baris_total += 1
    jam, grup, pengirim, kind, pr, cuplik = (r.split("\t") + [""]*6)[:6]
    unik.add((grup, cuplik))
    rep = {}
    if pr:
        try:
            rep = (json.loads(pr).get("reply") or {})
        except ValueError:
            pass
    if rep.get("sent") is True:
        otomatis += 1; continue
    teks = ekstrak(rep.get("error") or "")
    if teks:
        pre = norm(teks)[:45]
        if pre and any(t.startswith(pre) for t in terkirim):
            ulang += 1; continue
    belum.append((jam, grup, pengirim,
                  "balasan dibuat, TIDAK terkirim" if teks else "sistem tak membuat balasan"))

# dedup laporan "belum" per (grup, pengirim) — baris duplikat tak perlu diulang
ringkas, lihat = [], set()
for jam, grup, pengirim, sebab in belum:
    k = (grup, pengirim, sebab)
    if k in lihat: continue
    lihat.add(k); ringkas.append((jam, grup, pengirim, sebab))

print(f"baris #PLAN {baris_total} · pesan unik {len(unik)} · otomatis {otomatis} · kiriman-ulang {ulang} · BELUM {len(ringkas)}")
for jam, grup, pengirim, sebab in ringkas:
    print(f"  {jam} {grup[:26]} · {pengirim[:20]} · {sebab}")
PY
)

printf '%s === audit #PLAN ===\n%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$RINGKAS" >> "$LOG"

JUM=$(printf '%s' "$RINGKAS" | head -1 | sed -n 's/.*BELUM \([0-9]*\).*/\1/p')
[ -z "$JUM" ] && JUM=0

# Diam kalau bersih. Alarm yang berbunyi saat tak ada apa-apa akan diabaikan.
if [ "$JUM" -gt 0 ]; then
  osascript -e "display notification \"$JUM #PLAN belum dibalas\" with title \"WRG OS — audit pagi\" sound name \"Basso\"" >/dev/null 2>&1
  SEC=""
  [ -f "$HOME/DevWRG/wrg-os/.env.prod" ] && SEC=$(grep -E '^WA_SEND_SECRET=' "$HOME/DevWRG/wrg-os/.env.prod" | head -1 | cut -d= -f2-)
  if [ -n "$SEC" ]; then
    PESAN="📋 *Audit #PLAN pagi*

$RINGKAS"
    curl -sS -m 150 -X POST "$BRIDGE_SEND" -H 'content-type: application/json' -H "x-wa-secret: $SEC" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"to": sys.argv[1], "message": sys.argv[2]}))' "$ALERT_WA" "$PESAN")" \
      >> "$LOG" 2>&1
    printf '\n' >> "$LOG"
  fi
fi
exit 0
