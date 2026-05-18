import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export default function FormsShowcasePage() {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Text Inputs</CardTitle>
          <CardDescription>Input, Textarea, dengan Label.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="demo-name">Customer Name</Label>
            <Input id="demo-name" placeholder="RS Premier Bintaro" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="demo-email">Email</Label>
            <Input id="demo-email" type="email" placeholder="admin@rsp.co.id" />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="demo-notes">Notes</Label>
            <Textarea
              id="demo-notes"
              placeholder="Catatan tambahan untuk order…"
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Select</CardTitle>
          <CardDescription>Dropdown pilihan tunggal.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="demo-category">Product Category</Label>
            <Select>
              <SelectTrigger id="demo-category">
                <SelectValue placeholder="Pilih kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monitoring">Patient Monitoring</SelectItem>
                <SelectItem value="emergency">Emergency</SelectItem>
                <SelectItem value="diagnostic">Diagnostic</SelectItem>
                <SelectItem value="therapy">Therapy</SelectItem>
                <SelectItem value="imaging">Imaging</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="demo-warehouse">Warehouse</Label>
            <Select>
              <SelectTrigger id="demo-warehouse">
                <SelectValue placeholder="Pilih gudang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pusat">Gudang Pusat - Cengkareng</SelectItem>
                <SelectItem value="sby">Gudang Surabaya</SelectItem>
                <SelectItem value="bdg">Gudang Bandung</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Choice Controls</CardTitle>
          <CardDescription>Checkbox, RadioGroup, Switch.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          <div className="space-y-3">
            <Label>Checkbox</Label>
            <div className="flex items-center gap-2">
              <Checkbox id="cb1" defaultChecked />
              <Label htmlFor="cb1" className="font-normal">
                Include shipping cost
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="cb2" />
              <Label htmlFor="cb2" className="font-normal">
                Apply distributor discount
              </Label>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Payment Terms</Label>
            <RadioGroup defaultValue="net30">
              <div className="flex items-center gap-2">
                <RadioGroupItem id="r1" value="cod" />
                <Label htmlFor="r1" className="font-normal">
                  Cash on Delivery
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="r2" value="net30" />
                <Label htmlFor="r2" className="font-normal">
                  Net 30
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="r3" value="net60" />
                <Label htmlFor="r3" className="font-normal">
                  Net 60
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <Label>Switch</Label>
            <div className="flex items-center gap-2">
              <Switch id="sw1" defaultChecked />
              <Label htmlFor="sw1" className="font-normal">
                Notifikasi email saat status berubah
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="sw2" />
              <Label htmlFor="sw2" className="font-normal">
                Auto-generate surat jalan
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </div>
    </>
  );
}
