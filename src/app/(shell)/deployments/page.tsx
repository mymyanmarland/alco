"use client";

import { Rocket } from "lucide-react";
import { PageStub } from "@/components/page-stub";
import { useLocale } from "@/i18n/locale-provider";

export default function DeploymentsPage() {
  const { t } = useLocale();
  return (
    <PageStub
      icon={Rocket}
      title={t.pages.deployments.title}
      description={t.pages.deployments.desc}
    />
  );
}
