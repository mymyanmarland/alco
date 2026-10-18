"use client";

import { Store } from "lucide-react";
import { PageStub } from "@/components/page-stub";
import { useLocale } from "@/i18n/locale-provider";

export default function MarketplacePage() {
  const { t } = useLocale();
  return (
    <PageStub
      icon={Store}
      title={t.pages.marketplace.title}
      description={t.pages.marketplace.desc}
    />
  );
}
