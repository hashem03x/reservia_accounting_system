import { useState } from "react";
import { LocalizedEntity } from "@/types/global";
import NavigationTabs from "@/components/ui/navigation-tabs";
import Overview from "./overview";
import Payment from "./payment";
import Returns from "./returns";

type OrderTab = "overview" | "payments" | "retrun";

const TABS: LocalizedEntity<OrderTab> = {
  overview: {
    value: "overview",
    label: { en: "Overview", ar: "نظرة عامة" },
  },
  payments: {
    value: "payments",
    label: { en: "Payments", ar: "الدفعات" },
  },
  retrun: {
    value: "retrun",
    label: { en: "Returns", ar: "المرتجعات" },
  },
};

// export type NavMethods = Record<OrderTab, () => void>;

export default function OrderHandler() {
  const [activeTab, setActiveTab] = useState<OrderTab>(TABS.overview.value);

  // navMethods = Object.keys(TABS).reduce(
  //   (methods, key) => ({ ...methods, [key]: () => setActiveTab(TABS[key as OrderTab].value) }),
  //   {} as NavMethods,
  // );

  return (
    <div className="root-flex-1 flex min-h-full flex-col gap-4">
      <NavigationTabs tabs={TABS} activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === TABS.overview.value && <Overview />}
      {activeTab === TABS.payments.value && <Payment />}
      {activeTab === TABS.retrun.value && <Returns />}
    </div>
  );
}
