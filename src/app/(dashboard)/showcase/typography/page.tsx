import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function TypographyShowcasePage() {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Heading Scale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight">Heading 1</h1>
          <h2 className="text-3xl font-semibold tracking-tight">Heading 2</h2>
          <h3 className="text-2xl font-semibold tracking-tight">Heading 3</h3>
          <h4 className="text-xl font-semibold tracking-tight">Heading 4</h4>
          <h5 className="text-lg font-semibold">Heading 5</h5>
          <h6 className="text-base font-semibold">Heading 6</h6>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paragraph + Muted</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="leading-7">
            Distribusi alat kesehatan di Indonesia diatur oleh Kementerian
            Kesehatan melalui mekanisme IPAK (Izin Penyalur Alat Kesehatan)
            dan CDAKB (Cara Distribusi Alat Kesehatan yang Baik).
          </p>
          <p className="text-muted-foreground text-sm">
            Teks muted untuk caption, helper text, atau metadata sekunder.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="mb-2 text-sm font-medium">Unordered</p>
            <ul className="list-inside list-disc space-y-1 text-sm">
              <li>Patient Monitor</li>
              <li>Defibrillator</li>
              <li>Infusion Pump</li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Ordered</p>
            <ol className="list-inside list-decimal space-y-1 text-sm">
              <li>Receive PO</li>
              <li>Check stock & reserve</li>
              <li>Generate surat jalan</li>
              <li>Ship</li>
              <li>Confirm delivery</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inline Code & Blockquote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Pakai <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">cn()</code> helper untuk merge className conditionally.
          </p>
          <blockquote className="border-l-2 pl-4 italic text-sm text-muted-foreground">
            &ldquo;Stok harus selalu match dengan surat jalan terakhir, kalau ga match itu indikator audit issue.&rdquo;
          </blockquote>
          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
            <code>{`pnpm dev      # start dev server
pnpm build    # production build
pnpm lint     # eslint`}</code>
          </pre>
        </CardContent>
      </Card>
    </>
  );
}
