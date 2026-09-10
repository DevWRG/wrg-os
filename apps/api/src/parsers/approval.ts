// Parser hashtag WA #APPROVE/#REJECT (F11) — format:
//   #APPROVE <kode>
//   #REJECT <kode> [alasan bebas]
// Pure function (tanpa DB).

export interface ParsedApprovalMessage {
  kode: string;
  note: string | null;
}

export function parseApprovalMessage(line: string, action: "approve" | "reject"): ParsedApprovalMessage | { error: string } | null {
  const prefix = new RegExp(`^\\s*#\\s*${action}\\b`, "i");
  const rest = line.replace(prefix, "").trim();
  if (!rest) return null;
  const parts = rest.split(/\s+/);
  const kode = parts[0].toUpperCase();
  if (!/^APR-\d+$/.test(kode)) {
    return { error: `kode "${parts[0]}" tidak valid, format: APR-0001` };
  }
  const note = parts.slice(1).join(" ").trim() || null;
  return { kode, note };
}
