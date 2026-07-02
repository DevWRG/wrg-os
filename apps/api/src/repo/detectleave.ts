import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { normalizeWa } from "./master.js";
import { sendViaWaGateway } from "../wasend.js";

// detect_leave — port wrg-crm/scripts/detect_leave.sh.
// Scan pesan baru grup HRD (wa_message), 2 fase:
//   A. keyword gate → services/ai /detect-leave (LLM) → resolve user wajib (fuzzy)
//      → dedup overlap user_leave/pending → INSERT leave_pending + post approval ke grup.
//   B. balasan "ya L<id>"/"tidak L<id>" dari ADMIN → user_leave (approve) atau batal.
// Idempotent via leave_scan_seen. Skema wrg-os: am_id (bukan user_id).

// Bisa multi-grup HRD (comma-separated). Default: Pengumuman HR WGI.
const hrdGroups = (): string[] =>
  (process.env.LEAVE_HRD_GROUP_JID || "120363048384809457@g.us")
    .split(",").map((s) => s.trim()).filter(Boolean);
// Nomor admin yg boleh approve (comma-separated). Kosong → cek nomor di-skip.
const approverList = (): string[] =>
  (process.env.LEAVE_APPROVER_WA || "").split(",").map((s) => normalizeWa(s.trim())).filter(Boolean);
// Nama display WA admin yg boleh approve (comma-sep, case-insensitive). Dipakai
// karena di grup sender_jid = group_jid (nomor individual tak ke-capture) →
// approver dikenali by pushname. Approver balas dari HP-nya sendiri (bukan bot).
const approverNames = (): string[] =>
  (process.env.LEAVE_APPROVER_NAME || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const KEYWORD = /izin|ijin|sakit|cuti|tidak masuk|tdk masuk|ndak masuk|tidak bisa masuk|tidak dapat masuk|pengajuan/i;
const APPROVAL = /^\s*(ya|iya|ok|setuju|tidak|tdk|gak|batal|no)\s*#?L?(\d+)/i;
// Buang format WhatsApp (*bold* _italic_ ~strike~ `mono`) sebelum match — balasan
// approval sering ke-bold ("*ya L3*") yg bikin anchor ^ gagal.
const stripWaFmt = (s: string) => s.replace(/[*_~`]/g, "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wibDate = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function markSeen(messageId: string, status: string): Promise<void> {
  await db()`
    INSERT INTO leave_scan_seen (message_id, status) VALUES (${messageId}, ${status})
    ON CONFLICT (message_id) DO NOTHING
  `;
}

// Resolve nama → karyawan aktif (fuzzy, port resolve_user). null bila tak ketemu.
// HRD ngumumin cuti utk SEMUA karyawan, bukan cuma tim wajib plan/report → resolve
// ke seluruh roster aktif. wajib_plan_report TIDAK lagi jadi filter (dulu bikin Nopa
// Andriawan dkk yg flag-nya false ke-drop diam2), tapi tetap diprioritaskan di
// ORDER BY pas nama ambigu biar behavior tim plan/report stabil.
async function resolveWajib(raw: string): Promise<{ am_id: string; nama: string } | null> {
  const [row] = await db()`
    SELECT am_id, nama FROM master_user
    WHERE aktif AND (
        lower(panggilan) = lower(${raw})
     OR lower(nama) = lower(${raw})
     OR lower(nama) LIKE lower(${raw}) || ' %'
     OR lower(panggilan) = lower(split_part(${raw}, ' ', 1))
     OR (length(regexp_replace(lower(${raw}), '[^a-z]', '', 'g')) >= 4
         AND regexp_replace(lower(nama), '[^a-z]', '', 'g') LIKE regexp_replace(lower(${raw}), '[^a-z]', '', 'g') || '%')
    )
    ORDER BY CASE WHEN lower(panggilan) = lower(${raw}) THEN 1 WHEN lower(nama) = lower(${raw}) THEN 2 ELSE 3 END, wajib_plan_report DESC, length(nama)
    LIMIT 1
  `;
  return row ? { am_id: String(row.am_id), nama: String(row.nama) } : null;
}

async function handleApproval(decision: string, pid: number, senderWa: string, senderName: string, grp: string): Promise<string> {
  const sql = db();
  const approvers = approverList();
  const names = approverNames();
  const okPhone = approvers.length > 0 && approvers.includes(normalizeWa(senderWa));
  const okName = names.length > 0 && names.includes(String(senderName ?? "").trim().toLowerCase());
  if (!okPhone && !okName) {
    return "approval-ignored-not-admin";
  }
  const decidedBy = okName ? `name:${senderName}` : normalizeWa(senderWa);
  const [p] = await sql`SELECT * FROM leave_pending WHERE id = ${pid} AND status = 'pending'`;
  if (!p) return "approval-not-found";
  const rt = p.start_date === p.end_date ? String(p.start_date) : `${p.start_date} s/d ${p.end_date}`;
  if (/^(ya|iya|ok|setuju)$/i.test(decision)) {
    // Idempoten: hanya insert bila tak ada overlap user_leave.
    await sql`
      INSERT INTO user_leave (am_id, start_date, end_date, jenis, keterangan, source)
      SELECT ${p.am_id}, ${p.start_date}::date, ${p.end_date}::date, ${p.jenis}, 'Auto-detect HRD group, approved via WA', 'detect_leave'
      WHERE NOT EXISTS (
        SELECT 1 FROM user_leave WHERE am_id = ${p.am_id}
          AND daterange(start_date, end_date, '[]') && daterange(${p.start_date}::date, ${p.end_date}::date, '[]')
      )
    `;
    await sql`UPDATE leave_pending SET status='approved', decided_at=now(), decided_by=${decidedBy} WHERE id=${pid}`;
    await sendViaWaGateway(grp, `✅ Tercatat: *${p.nama}* ${p.jenis} ${rt}. Tidak akan kena reminder/summary.`);
    return "approved";
  }
  await sql`UPDATE leave_pending SET status='rejected', decided_at=now(), decided_by=${decidedBy} WHERE id=${pid}`;
  await sendViaWaGateway(grp, `❌ Dibatalkan — *${p.nama}* tidak direkam (L${pid}).`);
  return "rejected";
}

export interface DetectLeaveResult {
  scanned: number; pending_created: number; approved: number; rejected: number;
  skipped: Record<string, number>;
}

export async function runDetectLeaveScan(opts: { dryRun?: boolean } = {}): Promise<DetectLeaveResult> {
  const sql = db();
  const groups = hrdGroups();
  const res: DetectLeaveResult = { scanned: 0, pending_created: 0, approved: 0, rejected: 0, skipped: {} };
  const skip = (k: string) => { res.skipped[k] = (res.skipped[k] ?? 0) + 1; };

  const msgs = await sql`
    SELECT message_id, sender_name, sender_jid, group_jid, body, received_at
    FROM wa_message
    WHERE group_jid = ANY(${groups}) AND body IS NOT NULL AND body <> ''
      AND received_at >= now() - interval '2 days'
      AND message_id NOT IN (SELECT message_id FROM leave_scan_seen)
    ORDER BY received_at
  `;

  for (const m of msgs) {
    res.scanned += 1;
    const mid = String(m.message_id);
    const body = String(m.body);
    const senderWa = String(m.sender_jid ?? "");
    const grp = String(m.group_jid ?? "");
    const msgDate = m.received_at ? new Date(m.received_at).toISOString().slice(0, 10) : wibDate();

    // ── PHASE B: balasan approval ──
    const am = stripWaFmt(body).match(APPROVAL);
    if (am) {
      const decision = am[1].toLowerCase();
      const pid = Number(am[2]);
      if (opts.dryRun) { skip("approval-dryrun"); continue; }
      const out = await handleApproval(decision, pid, senderWa, String(m.sender_name ?? ""), grp);
      if (out === "approved") res.approved += 1;
      else if (out === "rejected") res.rejected += 1;
      else skip(out);
      await markSeen(mid, `reply-${out}`);
      await sleep(300);
      continue;
    }

    // ── PHASE A: deteksi ──
    if (!KEYWORD.test(body)) { await markSeen(mid, "no-keyword"); skip("no-keyword"); continue; }

    const { status, data } = await callAi("/detect-leave", {
      sender: String(m.sender_name ?? ""), body, msgdate: msgDate, dry_run: aiDryRun(),
    });
    if (status !== 200) { skip(`ai-${status}`); continue; } // jangan mark — coba lagi nanti
    if (!data.is_leave || Number(data.confidence ?? 0) < 0.6) {
      await markSeen(mid, "not-leave"); skip("not-leave"); continue;
    }
    const namaRaw = data.nama ? String(data.nama) : "";
    if (!namaRaw) { await markSeen(mid, "no-name"); skip("no-name"); continue; }
    const resolved = await resolveWajib(namaRaw);
    if (!resolved) { await markSeen(mid, "name-unresolved"); skip("name-unresolved"); continue; }

    let jenis = (data.jenis ? String(data.jenis) : "ijin").toLowerCase();
    if (!["ijin", "sakit", "cuti"].includes(jenis)) jenis = "ijin";
    const sd = data.start_date ? String(data.start_date) : msgDate;
    const ed = data.end_date ? String(data.end_date) : sd;

    // Dedup: overlap user_leave?
    const [ovl] = await sql`
      SELECT 1 FROM user_leave WHERE am_id = ${resolved.am_id}
        AND daterange(start_date, end_date, '[]') && daterange(${sd}, ${ed}, '[]') LIMIT 1
    `;
    if (ovl) { await markSeen(mid, "already-leave"); skip("already-leave"); continue; }
    // Dedup: pending serupa?
    const [pend] = await sql`
      SELECT id FROM leave_pending WHERE status='pending' AND am_id=${resolved.am_id} AND start_date=${sd} LIMIT 1
    `;
    if (pend) { await markSeen(mid, "already-pending"); skip("already-pending"); continue; }

    if (opts.dryRun) { skip("would-create-pending"); continue; }

    const [ins] = await sql`
      INSERT INTO leave_pending (am_id, nama, jenis, start_date, end_date, source_message_id)
      VALUES (${resolved.am_id}, ${resolved.nama}, ${jenis}, ${sd}, ${ed}, ${mid})
      RETURNING id
    `;
    const pid = Number(ins.id);
    const rt = sd === ed ? sd : `${sd} s/d ${ed}`;
    await sendViaWaGateway(grp, `📋 *Konfirmasi cuti* — rekam ke sistem?\n\n• Nama: *${resolved.nama}*\n• Jenis: *${jenis}*\n• Tanggal: *${rt}*\n\nAdmin balas *ya L${pid}* untuk rekam, atau *tidak L${pid}* untuk batal.`);
    await markSeen(mid, `pending-L${pid}`);
    res.pending_created += 1;
    await sleep(300);
  }

  // Housekeeping: expire pending >24 jam.
  await sql`UPDATE leave_pending SET status='expired' WHERE status='pending' AND created_at < now() - interval '24 hours'`;
  return res;
}
