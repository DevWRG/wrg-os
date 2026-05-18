import { TrendingUp, Users, Package, AlertTriangle } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function CardsShowcasePage() {
  return (
    <>
      <div>
        <h2 className="mb-3 text-sm font-medium">Stat Cards</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Revenue" value="Rp 2.84M" delta="+12.4%" deltaTone="positive" icon={TrendingUp} />
          <StatCard title="Customers" value="142" delta="+8 new" deltaTone="positive" icon={Users} />
          <StatCard title="SKUs" value="1,284" delta="24 added" icon={Package} />
          <StatCard title="Alerts" value="17" delta="6 critical" deltaTone="negative" icon={AlertTriangle} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium">Content Card with Header, Footer, Action</h2>
        <Card>
          <CardHeader>
            <CardTitle>Approve new supplier</CardTitle>
            <CardDescription>
              Dräger Indonesia mengirim aplikasi distributor pada 2026-05-15.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p>
              Status review legal: <Badge variant="outline">In progress</Badge>
            </p>
            <p className="text-muted-foreground mt-2">
              Sertifikat CDAKB sudah diterima, menunggu validasi tim QA.
            </p>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline">Hold</Button>
            <Button>Approve</Button>
          </CardFooter>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium">Plain Card</h2>
        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            Card tanpa header & footer — pakai buat content arbitrer.
          </CardContent>
        </Card>
      </div>
    </>
  );
}
