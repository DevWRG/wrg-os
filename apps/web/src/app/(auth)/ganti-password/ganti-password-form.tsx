"use client";

import { useRouter } from "next/navigation";

import { ChangeOwnPassword } from "@/components/crm/change-own-password";

export function GantiPasswordForm() {
  const router = useRouter();
  return <ChangeOwnPassword onSuccess={() => { router.replace("/"); router.refresh(); }} />;
}
