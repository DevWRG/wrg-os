import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  CreditCard,
  DollarSign,
  Download,
  Edit,
  Eye,
  Factory,
  Filter,
  HeartPulse,
  Home,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MoreHorizontal,
  Package,
  PieChart,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  Stethoscope,
  Trash2,
  TrendingUp,
  Truck,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";

const icons = [
  { name: "Activity", Icon: Activity },
  { name: "AlertTriangle", Icon: AlertTriangle },
  { name: "ArrowRight", Icon: ArrowRight },
  { name: "BarChart3", Icon: BarChart3 },
  { name: "Bell", Icon: Bell },
  { name: "Boxes", Icon: Boxes },
  { name: "Building2", Icon: Building2 },
  { name: "Calendar", Icon: Calendar },
  { name: "Check", Icon: Check },
  { name: "CheckCircle2", Icon: CheckCircle2 },
  { name: "ChevronDown", Icon: ChevronDown },
  { name: "ChevronRight", Icon: ChevronRight },
  { name: "ClipboardList", Icon: ClipboardList },
  { name: "Copy", Icon: Copy },
  { name: "CreditCard", Icon: CreditCard },
  { name: "DollarSign", Icon: DollarSign },
  { name: "Download", Icon: Download },
  { name: "Edit", Icon: Edit },
  { name: "Eye", Icon: Eye },
  { name: "Factory", Icon: Factory },
  { name: "Filter", Icon: Filter },
  { name: "HeartPulse", Icon: HeartPulse },
  { name: "Home", Icon: Home },
  { name: "Inbox", Icon: Inbox },
  { name: "LayoutDashboard", Icon: LayoutDashboard },
  { name: "LogOut", Icon: LogOut },
  { name: "Mail", Icon: Mail },
  { name: "MapPin", Icon: MapPin },
  { name: "Menu", Icon: Menu },
  { name: "MoreHorizontal", Icon: MoreHorizontal },
  { name: "Package", Icon: Package },
  { name: "PieChart", Icon: PieChart },
  { name: "Plus", Icon: Plus },
  { name: "Search", Icon: Search },
  { name: "Settings", Icon: Settings },
  { name: "ShoppingCart", Icon: ShoppingCart },
  { name: "Stethoscope", Icon: Stethoscope },
  { name: "Trash2", Icon: Trash2 },
  { name: "TrendingUp", Icon: TrendingUp },
  { name: "Truck", Icon: Truck },
  { name: "Upload", Icon: Upload },
  { name: "User", Icon: User },
  { name: "Users", Icon: Users },
  { name: "X", Icon: X },
];

export default function IconsShowcasePage() {
  return (
    <>
      <p className="text-muted-foreground text-sm">
        {icons.length} icon dari <code className="text-foreground rounded bg-muted px-1 py-0.5">lucide-react</code>.
        Full set: <a href="https://lucide.dev" className="text-foreground underline" target="_blank" rel="noreferrer">lucide.dev</a>.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {icons.map(({ name, Icon }) => (
          <div
            key={name}
            className="hover:bg-accent flex flex-col items-center justify-center gap-2 rounded-md border p-3 text-center transition-colors"
          >
            <Icon className="size-5" />
            <code className="text-muted-foreground text-[10px] leading-tight">
              {name}
            </code>
          </div>
        ))}
      </div>
    </>
  );
}
