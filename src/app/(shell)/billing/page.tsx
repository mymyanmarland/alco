"use client";

import { CreditCard } from "lucide-react";
import { PageStub } from "@/components/page-stub";
import { useLocale } from "@/i18n/locale-provider";

export default function BillingPage() {
  const { t } = useLocale();
  return (
    <PageStub
      icon={CreditCard}
      title={t.pages.billing.title}
      description={t.pages.billing.desc}
    />
  );
}
