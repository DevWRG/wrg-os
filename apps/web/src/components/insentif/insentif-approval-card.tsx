"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, RotateCcw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { httpErrorMessage } from "@/lib/http-error";

import { statusTone, type StatusApproval } from "./insentif-format";

// Rantai persetujuan satu rekap bulanan (F67 §VI, migrasi 183).
//
// Tombolnya digambar dari `boleh_maju` / `boleh_tolak` / `boleh_buka` yang dihitung
// SERVER — komponen ini tidak pernah menyimpulkan wewenang dari role di sesi. Alasannya
// bukan kerapian: wewenang tiap langkah tinggal di tabel insentif_approval_step dan bisa
// diubah tanpa deploy, jadi salinan aturannya di klien pasti basi cepat atau lambat.
//
// `alasan` selalu ditampilkan saat tombolnya mati. Rantai persetujuan yang menolak diam
// membuat orang mengira aplikasinya rusak, lalu meminta admin "tekan saja" — persis
// jalan pintas yang ingin dicegah pemisahan kewenangan.

export function InsentifApprovalCard({
  amId,
  periode,
  data,
  onSelesai,
}: {
  amId: string;
  periode: string;
  data: StatusApproval;
  /** Dipanggil setelah aksi berhasil. Perlu untuk pemanggil yang mengambil datanya
   *  sendiri di klien (Insentif Saya) — router.refresh() hanya menyegarkan RSC. */
  onSelesai?: () => void;
}) {
  const router = useRouter();
  const [catatan, setCatatan] = useState("");
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function kirim(aksi: "maju" | "tolak" | "buka") {
    setSibuk(aksi);
    setErr(null);
    try {
      const res = await fetch(
        `/api/insentif/${encodeURIComponent(amId)}/approval?periode=${encodeURIComponent(periode)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ aksi, catatan: catatan.trim() || null }),
        },
      );
      if (!res.ok) {
        setErr(await httpErrorMessage(res, "gagal memproses langkah"));
        return;
      }
      setCatatan("");
      onSelesai?.();
      router.refresh();
    } catch {
      setErr("jaringan gagal");
    } finally {
      setSibuk(null);
    }
  }

  const { label: statusLabel } = statusTone(data.status);
  const adaTombol = data.boleh_maju || data.boleh_tolak || data.boleh_buka;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Rantai persetujuan</CardTitle>
        <div className="flex items-center gap-2">
          {data.siklus > 1 ? (
            <Badge variant="outline" title="Rekap ini pernah ditolak lalu dibuka kembali">
              Putaran {data.siklus}
            </Badge>
          ) : null}
          <Badge variant="outline">{statusLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="text-sm">
          {data.berikutnya ? (
            <span>
              Langkah berikutnya:{" "}
              <span className="font-medium">
                {data.berikutnya.step}. {data.berikutnya.label}
              </span>
              {data.berikutnya.keterangan ? (
                <span className="text-muted-foreground"> — {data.berikutnya.keterangan}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Tidak ada langkah lanjutan.</span>
          )}
        </div>

        {data.alasan ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{data.alasan}</p>
        ) : null}

        {adaTombol ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Catatan (wajib diisi kalau menolak — ikut tercatat di jejak)"
              rows={2}
            />
            <div className="flex flex-wrap gap-2">
              {data.boleh_maju ? (
                <Button size="sm" disabled={sibuk !== null} onClick={() => void kirim("maju")}>
                  <CheckCircle2 className="size-4" />
                  {data.berikutnya?.group_key == null ? "Ajukan" : "Setujui & teruskan"}
                </Button>
              ) : null}
              {data.boleh_tolak ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sibuk !== null || catatan.trim().length === 0}
                  title={catatan.trim() ? undefined : "Isi catatan dulu — penolakan tanpa alasan tak bisa ditindaklanjuti"}
                  onClick={() => void kirim("tolak")}
                >
                  <XCircle className="size-4" /> Tolak
                </Button>
              ) : null}
              {data.boleh_buka ? (
                <Button size="sm" variant="outline" disabled={sibuk !== null} onClick={() => void kirim("buka")}>
                  <RotateCcw className="size-4" /> Buka kembali
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {err ? <p className="text-destructive text-sm">{err}</p> : null}

        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Jejak</p>
          {data.riwayat.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada langkah yang dijalankan.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {data.riwayat.map((j, i) => (
                <li key={`${j.acted_at}-${i}`} className="flex items-start gap-2 text-sm">
                  {j.status_to === "rejected" ? (
                    <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
                  ) : j.status_to === "draft" ? (
                    <RotateCcw className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  )}
                  <span>
                    <span className="font-medium">{statusTone(j.status_to).label}</span>{" "}
                    <span className="text-muted-foreground">
                      oleh {j.actor_nama ?? j.actor_user_id}
                      {j.siklus > 1 ? ` · putaran ${j.siklus}` : ""} ·{" "}
                      {new Date(j.acted_at).toLocaleString("id-ID", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    {j.catatan ? <span className="block text-xs italic">“{j.catatan}”</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <p className="text-muted-foreground flex items-start gap-1.5 text-xs leading-relaxed">
          <Circle className="mt-0.5 size-3 shrink-0" />
          <span>
            Satu akun hanya boleh menandatangani <strong>satu</strong> langkah per putaran, dan
            yang insentifnya dihitung tidak boleh menyetujui berkasnya sendiri. Aturan ini
            ditegakkan di basis data, bukan hanya di layar ini.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
