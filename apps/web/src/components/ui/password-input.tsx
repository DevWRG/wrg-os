"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** kelas untuk pembungkus relatif (jarang dipakai; atur lebar/margin di sini) */
  wrapperClassName?: string;
};

/**
 * Input password + tombol mata untuk tampilkan/sembunyikan isinya.
 * `className` tetap diteruskan ke <Input>, jadi pemanggil bisa mengatur
 * tinggi/radius seperti biasa. Tombolnya di luar urutan Tab supaya alur
 * ketik → submit tidak terganggu, tapi tetap bisa diklik.
 */
function PasswordInput({ className, wrapperClassName, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className={cn("relative", wrapperClassName)}>
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Sembunyikan password" : "Tampilkan password"}
        aria-pressed={visible}
        tabIndex={-1}
        disabled={props.disabled}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-primary-soft absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-md transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export { PasswordInput };
