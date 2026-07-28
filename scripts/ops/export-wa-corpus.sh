#!/usr/bin/env bash
# export-wa-corpus.sh — export korpus komunikasi grup WhatsApp + agregat siap-analisis
# untuk pemetaan jobdesk, SOP, dan relasi komunikasi antar posisi/karyawan.
#
# READ-ONLY terhadap DB (hanya SELECT + TEMP TABLE). Tidak menyentuh pm2 / wa-bridge /
# layanan legacy. Aman dijalankan kapan saja, termasuk di produksi.
#
# Pemakaian (di Mac mini prod, dari root repo):
#   bash scripts/ops/export-wa-corpus.sh                      # semua grup, all-time
#   bash scripts/ops/export-wa-corpus.sh --since 2026-01-01
#   bash scripts/ops/export-wa-corpus.sh --group '%koord%'     # filter nama/JID grup (ILIKE)
#   bash scripts/ops/export-wa-corpus.sh --out ~/wa-corpus --zip
#
# Flag:
#   --out DIR         folder tujuan (default ./export-wa-corpus-<timestamp>)
#   --since YYYY-MM-DD  batas awal (default 2000-01-01 = all-time)
#   --until YYYY-MM-DD  batas akhir inklusif (default hari ini)
#   --group PATTERN   filter grup, pola ILIKE atas nama grup / JID (default '%')
#   --adj-min N       window menit edge "siapa-respons-siapa" (default 15)
#   --gap-min N       jeda menit pemisah sesi percakapan (default 30)
#   --include-dm      ikutkan chat 1-on-1 (default: hanya grup @g.us)
#   --no-name-mentions  matikan deteksi mention berbasis nama panggilan (lebih cepat)
#   --mention-min-len N  panjang minimum panggilan utk dihitung mention nama (default 3)
#   --db URL          override koneksi (default: DATABASE_URL / .env.prod / socket lokal)
#   --sessions FILE   sessions.json openclaw (default ~/.openclaw/agents/main/sessions/sessions.json)
#   --excel           tambahkan baris "sep=," (Excel locale koma-titik) selain BOM
#   --plain           tanpa BOM UTF-8 (murni untuk pandas/awk)
#   --form FILE       setelah export, isi template Form Input PIC Divisi (xlsx) →
#                     <out>/form-pic/ (butuh python3 + openpyxl)
#   --zip             bungkus hasil jadi <out>.zip
set -euo pipefail

OUT=""; SINCE="2000-01-01"; UNTIL="$(date +%F)"; GROUP='%'
ADJ_MIN=15; GAP_MIN=30; INCLUDE_DM=false; NAME_MENTIONS=true; MENTION_MIN_LEN=3
DB=""; SESSIONS=""; EXCEL=0; BOM=1; ZIP=0; FORM=""

while [ $# -gt 0 ]; do case "$1" in
  --out) OUT="$2"; shift 2 ;;
  --since) SINCE="$2"; shift 2 ;;
  --until) UNTIL="$2"; shift 2 ;;
  --group) GROUP="$2"; shift 2 ;;
  --adj-min) ADJ_MIN="$2"; shift 2 ;;
  --gap-min) GAP_MIN="$2"; shift 2 ;;
  --include-dm) INCLUDE_DM=true; shift ;;
  --no-name-mentions) NAME_MENTIONS=false; shift ;;
  --mention-min-len) MENTION_MIN_LEN="$2"; shift 2 ;;
  --db) DB="$2"; shift 2 ;;
  --sessions) SESSIONS="$2"; shift 2 ;;
  --excel) EXCEL=1; shift ;;
  --plain) BOM=0; shift ;;
  --form) FORM="$2"; shift 2 ;;
  --zip) ZIP=1; shift ;;
  -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
  *) echo "arg tak dikenal: $1 (lihat --help)" >&2; exit 2 ;;
esac; done

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

say(){ printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m! %s\033[0m\n' "$*" >&2; }
die(){ printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v psql >/dev/null || die "psql tak ada di PATH."

# ── koneksi DB ────────────────────────────────────────────────────
if [ -z "$DB" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then
    DB="$DATABASE_URL"
  elif [ -f "$ROOT/.env.prod" ]; then
    DB="$(grep -E '^DATABASE_URL=' "$ROOT/.env.prod" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  fi
fi
[ -n "$DB" ] || DB="postgres:///wrg_os_prod"
# tampilkan tanpa kredensial
SAFE_DB="$(printf '%s' "$DB" | sed -E 's#(//)[^@/]*@#\1***@#')"

# ── folder tujuan ─────────────────────────────────────────────────
[ -n "$OUT" ] || OUT="$ROOT/export-wa-corpus-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

say "Export korpus WA"
printf '  db        : %s\n' "$SAFE_DB"
printf '  periode   : %s .. %s\n' "$SINCE" "$UNTIL"
printf '  grup      : %s%s\n' "$GROUP" "$([ "$INCLUDE_DM" = true ] && echo ' (+chat pribadi)' || echo ' (hanya grup)')"
printf '  window    : adjacency %s mnt · sesi %s mnt\n' "$ADJ_MIN" "$GAP_MIN"
printf '  keluaran  : %s\n' "$OUT"

# ── nama grup dari sessions.json openclaw ─────────────────────────
# wa_message.group_name SELALU kosong (openclaw tak mengirim subject) — subject
# grup cuma ada di state openclaw. Tanpa langkah ini, semua grup cuma JID.
[ -n "$SESSIONS" ] || SESSIONS="${OPENCLAW_SESSIONS_FILE:-$HOME/.openclaw/agents/main/sessions/sessions.json}"
SUBJ="$OUT/_group_subjects.csv"
say "Nama grup dari openclaw sessions.json"
if [ -f "$SESSIONS" ]; then
  python3 - "$SESSIONS" "$SUBJ" <<'PY'
import csv, json, re, sys
src, dst = sys.argv[1], sys.argv[2]
out = {}
def walk(o, key):
    if not isinstance(o, dict):
        if isinstance(o, list):
            for it in o: walk(it, key)
        return
    subj = o.get("subject")
    if isinstance(subj, str) and subj.strip():
        m = re.search(r"group:(\S+@g\.us)", key or "")
        jid = m.group(1) if m else (o.get("jid") if isinstance(o.get("jid"), str) else "")
        if jid.endswith("@g.us"): out[jid] = subj.strip()
    for k, v in o.items(): walk(v, k)
try:
    walk(json.load(open(src, encoding="utf-8")), "")
except Exception as e:
    print(f"  ! gagal baca sessions.json: {e}", file=sys.stderr)
with open(dst, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["group_jid", "subject"])
    for jid, subj in sorted(out.items()): w.writerow([jid, subj])
print(f"  subject grup terbaca: {len(out)}")
PY
  ok "$(($(wc -l < "$SUBJ") - 1)) nama grup dipetakan"
else
  printf 'group_jid,subject\n' > "$SUBJ"
  warn "sessions.json tak ditemukan ($SESSIONS) → grup akan tampil sebagai JID saja."
fi

# ── jalankan SQL ──────────────────────────────────────────────────
say "Query & tulis CSV"
# psql dijalankan DARI dalam $OUT: \copy tak melakukan interpolasi variabel
# (perilaku psql yang terdokumentasi), jadi nama berkas di SQL relatif ke cwd.
( cd "$OUT" && psql "$DB" \
    --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    -v since="$SINCE" -v until="$UNTIL" \
    -v adj_min="$ADJ_MIN" -v gap_min="$GAP_MIN" -v include_dm="$INCLUDE_DM" \
    -v name_mentions="$NAME_MENTIONS" -v mention_min_len="$MENTION_MIN_LEN" \
    -v group_pattern="$GROUP" \
    -f "$ROOT/scripts/ops/export-wa-corpus.sql" ) \
  || die "query gagal — tidak ada perubahan pada DB (read-only)."

rm -f "$SUBJ"

# ── pasca-proses: BOM / sep= untuk Excel ──────────────────────────
if [ "$BOM" = 1 ]; then
  say "Ramah-Excel (BOM UTF-8$([ "$EXCEL" = 1 ] && echo ' + sep=,'))"
  for f in "$OUT"/*.csv; do
    tmp="$f.tmp"
    { printf '\xEF\xBB\xBF'; [ "$EXCEL" = 1 ] && printf 'sep=,\n'; cat "$f"; } > "$tmp"
    mv "$tmp" "$f"
  done
  ok "$(ls -1 "$OUT"/*.csv | wc -l | tr -d ' ') berkas"
fi

# ── panduan baca ──────────────────────────────────────────────────
cat > "$OUT/README.md" <<EOF
# Korpus komunikasi WhatsApp — $SINCE .. $UNTIL

Dihasilkan \`scripts/ops/export-wa-corpus.sh\` pada $(date '+%F %T %Z').
Filter grup: \`$GROUP\` · chat pribadi: $INCLUDE_DM · window adjacency ${ADJ_MIN}m · sesi ${GAP_MIN}m.

## Alur pakai

1. **Relasi antar posisi** → \`06_matriks_posisi.csv\` (+ \`06b_matriks_dept.csv\`).
   Format long; pivot \`dari_posisi\` × \`ke_posisi\` × \`bobot\` di spreadsheet.
   \`resiprositas\` mendekati 1 = dialog dua arah; mendekati 0 = satu arah (lapor/perintah).
2. **Jobdesk de-facto vs formal** → \`09_sinyal_topik.csv\` / \`09b_topik_posisi.csv\`
   dibandingkan \`10_jobdesk_formal.csv\` (tugas, RACI, KPI, PDCA dari employee spine).
   Selisih di sini = jobdesk yang tak terpakai atau kerja tak tercatat.
3. **SOP de-facto** → \`11b_pola_alur.csv\` (urutan posisi yang berulang) lalu telusuri
   contohnya di \`11_sesi_percakapan.csv\` → \`01_messages.csv\`.
4. **Beban & ritme** → \`02_roster.csv\`, \`04_participation.csv\`, \`08_ritme_waktu.csv\`.

## Kunci join

\`person_key\` konsisten di semua berkas (\`<am_id>\` bila ter-resolve, atau
\`unknown:<pushname>\`). \`position_key\` = \`master_user.posisi\` → \`employee.role\`
→ \`master_user.role\`, fallback \`TIDAK DIKENAL\`.

## Batasan yang WAJIB dibaca sebelum menyimpulkan

- **Pesan keluar bot tidak ada.** Ingest melewati \`fromMe\` (repo/wa.ts \`mapOpenclaw\`),
  jadi reminder/rekap yang dikirim sistem tidak muncul. Alur SOP yang dipicu bot akan
  tampak "tanpa pemicu".
- **Identitas pengirim bertumpu pushname.** Untuk pesan grup, \`wa_message.sender_jid\`
  = JID grup (bukan peserta), jadi tier nomor telepon hampir tak pernah kena.
  Cek \`persen_ter_resolve\` di \`03_groups.csv\`; kalau rendah, isi \`sender_alias\`
  pakai SQL siap-tempel di \`12_pengirim_tak_dikenal.csv\` lalu jalankan ulang export.
- **Satu HP dipakai bersama** (grup gudang dll) membuat beberapa orang tampak sebagai
  satu aktor sampai alias-nya diisi.
- **Edge \`05\`/\`06\` adalah proksi.** WA quoted-reply tidak tersimpan; edge dibangun
  dari pesan berurutan (<= ${ADJ_MIN} menit, pengirim beda). Di grup ramai ini
  menghasilkan sebagian pasangan palsu — silang-cek dengan \`07_mentions.csv\`
  (penyebutan eksplisit, sinyal jauh lebih kuat).
- **Mention \`jenis=nama\`** dicocokkan sebagai kata utuh dari panggilan/nama depan
  (minimum ${MENTION_MIN_LEN} huruf) → panggilan pendek atau yang juga kata umum bisa
  false-positive. \`jenis=nomor\` (@62xxx) selalu akurat. Naikkan \`--mention-min-len\`
  atau pakai \`--no-name-mentions\` kalau terlalu bising.
- **Bucket topik berbasis kata kunci**, bukan pemahaman makna. Daftar pola ada di
  \`scripts/ops/export-wa-corpus.sql\` (tabel \`topik\`) — edit sesuai kosakata tim.
- **Isi pesan mentah** ada di \`01_messages.csv\`. Berkas ini memuat komunikasi internal
  karyawan; perlakukan sesuai kebijakan data internal.

## Draf Form Input PIC Divisi

Kalau folder \`form-pic/\` ada, di dalamnya ada template form resmi yang sudah terisi
draf per divisi (\`Form-PIC_<Divisi>_draf-WA.xlsx\`) + versi gabungan \`SEMUA\`:

- **Daftar Posisi** ← roster + aktivitas WA · **A. Tugas & Target** ← \`09b_topik_posisi\`
  (Frekuensi dihitung dari rasio hari-aktif) · **B. Bedah SOP** ← \`11b_pola_alur\`
  (Kondisi Sekarang = Manual, karena prosesnya masih jalan di WhatsApp) ·
  **C. Koordinasi** ← \`06_matriks_posisi\` + \`06c_topik_pasangan_posisi\`.
- **OKR Divisi tidak diisi** — itu wewenang HOD.
- Sel **kuning** wajib diisi manusia (Level, Rules, Target, Target Level).
- Sheet **'Bukti (auto WA)'** memuat dasar tiap baris draf (jumlah pesan, grup, contoh pesan).
- \`form-pic/_pemetaan_divisi.csv\` = pemetaan posisi→divisi yang dipakai. Koreksi berkas itu
  (kolom \`pola,divisi\`) lalu jalankan ulang \`wa-corpus-to-form.py --divisi-map <berkas>\`.
  Posisi yang tak cocok aturan masuk ke workbook \`BELUM-DIPETAKAN\`.

Isi form itu **draf untuk diverifikasi PIC**, bukan jobdesk/SOP resmi.

Daftar berkas + jumlah baris: \`00_MANIFEST.csv\`.
EOF
ok "README.md"

if [ -n "$FORM" ]; then
  say "Isi template Form Input PIC Divisi"
  if [ ! -f "$FORM" ]; then
    warn "template tak ditemukan: $FORM → langkah form dilewati."
  elif ! python3 "$ROOT/scripts/ops/wa-corpus-to-form.py" --export "$OUT" --template "$FORM"; then
    warn "generator form gagal — CSV tetap lengkap di $OUT."
  fi
fi

if [ "$ZIP" = 1 ]; then
  say "Bungkus zip"
  ( cd "$(dirname "$OUT")" && zip -qr "$(basename "$OUT").zip" "$(basename "$OUT")" )
  ok "$OUT.zip"
fi

say "Selesai"
printf '  %s\n' "$OUT"
du -sh "$OUT" | awk '{print "  ukuran: "$1}'
