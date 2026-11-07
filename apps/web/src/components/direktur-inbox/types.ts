// Cermin apps/api/src/repo/direktur-inbox.ts (InboxItem / InboxHasil).
export type JenisInbox = "approval" | "po" | "fund" | "insentif" | "lembur";

export interface InboxItem {
  jenis: JenisInbox;
  id: string;
  kode: string;
  judul: string;
  pengaju: string | null;
  nominal: number | null;
  menunggu_sejak: string;
  umur_hari: number;
  link: string;
  aksi_wa: string | null;
}

export interface InboxHasil {
  generated_at: string;
  total: number;
  per_jenis: Record<JenisInbox, number>;
  items: InboxItem[];
  gagal: { jenis: JenisInbox; error: string }[];
}
