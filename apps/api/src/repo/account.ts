import { db } from "../db.js";

// F62 Account & Contact 360 (Fase 1). Account = accurate_customer (master faskes)
// + ekstensi CRM (crm_account) + multi-contact (crm_contact). Data komersial
// (revenue/AR) diturunkan dari accurate_invoice — CRM tak menduplikasi keuangan.

export const CONTACT_ROLES = ["economic_buyer", "user", "technical", "champion"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

const nameExpr = `COALESCE(NULLIF(ac.name,''), NULLIF(max(ai.raw->'customer'->>'name'),''), NULLIF(max(ai.raw->>'retailWpName'),''), 'Customer #' || ai.customer_id::text)`;

// Daftar account = customer yg punya faktur, + ekstensi CRM + ringkasan komersial + jml kontak.
export async function listAccounts() {
  const sql = db();
  const rows = await sql`
    WITH inv AS (
      SELECT ai.customer_id AS id,
        ${sql.unsafe(nameExpr)} AS name,
        NULLIF(mode() WITHIN GROUP (ORDER BY NULLIF(mu.cabang,'')), '') AS cabang_inv,
        sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS revenue,
        count(*)::int AS invoices,
        max(ai.tanggal)::text AS last_date,
        (CURRENT_DATE - max(ai.tanggal))::int AS days_since,
        COALESCE(sum(ai.outstanding),0)::float8 AS outstanding
      FROM accurate_invoice ai
      LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      LEFT JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE ai.customer_id IS NOT NULL
      GROUP BY ai.customer_id, ac.name
    )
    SELECT i.id::text AS id, i.name, COALESCE(a.cabang, i.cabang_inv) AS cabang,
      a.tipe, a.kelas_rs, a.wilayah, a.status_bayar,
      i.revenue, i.invoices, i.last_date, i.days_since, i.outstanding,
      (SELECT count(*) FROM crm_contact c WHERE c.account_id = i.id)::int AS contacts
    FROM inv i LEFT JOIN crm_account a ON a.account_id = i.id
    ORDER BY i.revenue DESC NULLS LAST`;
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), cabang: r.cabang ? String(r.cabang) : null,
    tipe: r.tipe ? String(r.tipe) : null, kelas_rs: r.kelas_rs ? String(r.kelas_rs) : null,
    wilayah: r.wilayah ? String(r.wilayah) : null, status_bayar: r.status_bayar ? String(r.status_bayar) : null,
    revenue: Number(r.revenue), invoices: Number(r.invoices),
    last_date: r.last_date ? String(r.last_date) : null,
    days_since: r.days_since == null ? null : Number(r.days_since),
    outstanding: Number(r.outstanding), contacts: Number(r.contacts),
    dormant: r.days_since != null && Number(r.days_since) > 60,
  }));
}

// Detail 1 account: master + ekstensi CRM + ringkasan komersial + daftar kontak.
export async function getAccount(id: string) {
  const sql = db();
  const cid = Number(id);
  if (!Number.isInteger(cid)) return null;
  const [master] = await sql`
    SELECT ac.id::text AS id,
      COALESCE(NULLIF(ac.name,''), NULLIF(ai2.raw_name,''), 'Customer #' || ac.id::text) AS name,
      ac.no, a.tipe, a.kelas_rs, a.wilayah, a.cabang, a.npwp, a.status_bayar, a.notes,
      COALESCE(s.revenue,0)::float8 AS revenue, COALESCE(s.invoices,0)::int AS invoices,
      s.last_date, s.days_since, COALESCE(s.outstanding,0)::float8 AS outstanding
    FROM accurate_customer ac
    LEFT JOIN crm_account a ON a.account_id = ac.id
    LEFT JOIN LATERAL (
      SELECT sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS revenue, count(*)::int AS invoices,
        max(ai.tanggal)::text AS last_date, (CURRENT_DATE - max(ai.tanggal))::int AS days_since,
        COALESCE(sum(ai.outstanding),0)::float8 AS outstanding
      FROM accurate_invoice ai WHERE ai.customer_id = ac.id
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT NULLIF(max(ai.raw->'customer'->>'name'),'') AS raw_name FROM accurate_invoice ai WHERE ai.customer_id = ac.id
    ) ai2 ON true
    WHERE ac.id = ${cid}
    LIMIT 1`;
  if (!master) return null;
  const contacts = await sql`
    SELECT id::text, nama, jabatan, role_deal, hp_wa, email, is_primary, notes, seq
    FROM crm_contact WHERE account_id = ${cid} ORDER BY is_primary DESC, seq, id`;
  return {
    id: String(master.id), name: String(master.name), no: master.no ? String(master.no) : null,
    tipe: master.tipe ? String(master.tipe) : null, kelas_rs: master.kelas_rs ? String(master.kelas_rs) : null,
    wilayah: master.wilayah ? String(master.wilayah) : null, cabang: master.cabang ? String(master.cabang) : null,
    npwp: master.npwp ? String(master.npwp) : null, status_bayar: master.status_bayar ? String(master.status_bayar) : null,
    notes: master.notes ? String(master.notes) : null,
    revenue: Number(master.revenue), invoices: Number(master.invoices),
    last_date: master.last_date ? String(master.last_date) : null,
    days_since: master.days_since == null ? null : Number(master.days_since),
    outstanding: Number(master.outstanding),
    contacts: contacts.map((c) => ({
      id: String(c.id), nama: String(c.nama), jabatan: c.jabatan ? String(c.jabatan) : null,
      role_deal: c.role_deal ? String(c.role_deal) : null, hp_wa: c.hp_wa ? String(c.hp_wa) : null,
      email: c.email ? String(c.email) : null, is_primary: Boolean(c.is_primary),
      notes: c.notes ? String(c.notes) : null, seq: Number(c.seq),
    })),
  };
}

export interface AccountFields { tipe?: string | null; kelas_rs?: string | null; wilayah?: string | null; cabang?: string | null; npwp?: string | null; status_bayar?: string | null; notes?: string | null }
export async function upsertAccountFields(id: string, f: AccountFields) {
  const sql = db();
  const cid = Number(id);
  if (!Number.isInteger(cid)) throw new Error("account id invalid");
  const [exist] = await sql`SELECT 1 FROM accurate_customer WHERE id = ${cid}`;
  if (!exist) throw new Error("account tak ditemukan");
  await sql`
    INSERT INTO crm_account (account_id, tipe, kelas_rs, wilayah, cabang, npwp, status_bayar, notes, updated_at)
    VALUES (${cid}, ${f.tipe ?? null}, ${f.kelas_rs ?? null}, ${f.wilayah ?? null}, ${f.cabang ?? null}, ${f.npwp ?? null}, ${f.status_bayar ?? null}, ${f.notes ?? null}, now())
    ON CONFLICT (account_id) DO UPDATE SET
      tipe = EXCLUDED.tipe, kelas_rs = EXCLUDED.kelas_rs, wilayah = EXCLUDED.wilayah, cabang = EXCLUDED.cabang,
      npwp = EXCLUDED.npwp, status_bayar = EXCLUDED.status_bayar, notes = EXCLUDED.notes, updated_at = now()`;
  return getAccount(id);
}

export interface ContactInput { nama: string; jabatan?: string | null; role_deal?: string | null; hp_wa?: string | null; email?: string | null; is_primary?: boolean; notes?: string | null; seq?: number }
const cleanRole = (r?: string | null) => (r && (CONTACT_ROLES as readonly string[]).includes(r) ? r : null);

export async function createContact(accountId: string, c: ContactInput) {
  const sql = db();
  const cid = Number(accountId);
  if (!Number.isInteger(cid)) throw new Error("account id invalid");
  if (!c.nama?.trim()) throw new Error("nama kontak wajib");
  const [exist] = await sql`SELECT 1 FROM accurate_customer WHERE id = ${cid}`;
  if (!exist) throw new Error("account tak ditemukan");
  const [row] = await sql`
    INSERT INTO crm_contact (account_id, nama, jabatan, role_deal, hp_wa, email, is_primary, notes, seq)
    VALUES (${cid}, ${c.nama.trim()}, ${c.jabatan ?? null}, ${cleanRole(c.role_deal)}, ${c.hp_wa ?? null}, ${c.email ?? null}, ${c.is_primary ?? false}, ${c.notes ?? null}, ${c.seq ?? 0})
    RETURNING id`;
  return { id: String(row.id) };
}
export async function updateContact(contactId: string, c: ContactInput) {
  const sql = db();
  const id = Number(contactId);
  if (!Number.isInteger(id)) throw new Error("contact id invalid");
  if (!c.nama?.trim()) throw new Error("nama kontak wajib");
  const rows = await sql`
    UPDATE crm_contact SET nama = ${c.nama.trim()}, jabatan = ${c.jabatan ?? null}, role_deal = ${cleanRole(c.role_deal)},
      hp_wa = ${c.hp_wa ?? null}, email = ${c.email ?? null}, is_primary = ${c.is_primary ?? false},
      notes = ${c.notes ?? null}, seq = ${c.seq ?? 0}, updated_at = now()
    WHERE id = ${id} RETURNING id`;
  return { updated: rows.length };
}
export async function deleteContact(contactId: string) {
  const sql = db();
  const id = Number(contactId);
  if (!Number.isInteger(id)) throw new Error("contact id invalid");
  const rows = await sql`DELETE FROM crm_contact WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
