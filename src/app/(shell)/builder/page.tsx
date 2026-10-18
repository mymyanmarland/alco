"use client";

import { Hammer } from "lucide-react";
import { PageStub } from "@/components/page-stub";
import { useLocale } from "@/i18n/locale-provider";

export default function BuilderPage() {
  const { t } = useLocale();
  return (
    <PageStub
      icon={Hammer}
      title={t.pages.builder.title}
      description={t.pages.builder.desc}
    />
  );
}
