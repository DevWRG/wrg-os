import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Konfigurasi profil perusahaan, perizinan, dan preferensi sistem."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company Profile</CardTitle>
            <CardDescription>
              Identitas legal yang muncul di invoice dan surat jalan.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="company-name">Legal Name</Label>
              <Input
                id="company-name"
                defaultValue="PT Wahana Lifeline"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="npwp">NPWP</Label>
              <Input id="npwp" placeholder="00.000.000.0-000.000" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address">Alamat</Label>
              <Input id="address" placeholder="Jl. ..." />
            </div>
            <div className="flex justify-end">
              <Button>Save changes</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Distribution License</CardTitle>
            <CardDescription>
              Izin Penyalur Alat Kesehatan (IPAK) dan CDAKB.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ipak">Nomor IPAK</Label>
              <Input id="ipak" placeholder="FK.01.04/..." />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ipak-expiry">Masa Berlaku IPAK</Label>
              <Input id="ipak-expiry" type="date" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cdakb">Sertifikat CDAKB</Label>
              <Input id="cdakb" placeholder="No. sertifikat" />
            </div>
            <div className="flex justify-end">
              <Button>Save changes</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
