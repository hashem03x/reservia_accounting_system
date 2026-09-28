import { useState } from "react";
import { Product } from "@/types/product";
import { LocalizedEntity } from "@/types/global";
import NavigationTabs from "@/components/ui/navigation-tabs";
import ProductFormProvider from "./context";
import ProductBasicInfo from "./basic";
import Variants from "./variants";

type ProductTab = "basic" | "variants";

const TABS: LocalizedEntity<ProductTab> = {
  basic: {
    value: "basic",
    label: { en: "Basic Information", ar: "المعلومات الاساسية" },
  },
  variants: {
    value: "variants",
    label: { en: "Variants", ar: "الأصناف" },
  },
};

export type NavMethods = Record<ProductTab, () => void>;

export default function ProductHandler({ product }: { product?: Product }) {
  const [activeTab, setActiveTab] = useState<ProductTab>(TABS.basic.value);

  const navMethods: NavMethods = Object.keys(TABS).reduce(
    (methods, key) => ({ ...methods, [key]: () => setActiveTab(TABS[key as ProductTab].value) }),
    {} as NavMethods,
  );

  return (
    <div className="root-flex-1 flex min-h-full flex-col gap-4">
      <NavigationTabs tabs={TABS} activeTab={activeTab} setActiveTab={setActiveTab} />

      <ProductFormProvider product={product}>
        {activeTab === TABS.basic.value && <ProductBasicInfo navMethods={navMethods} />}
        {activeTab === TABS.variants.value && <Variants navMethods={navMethods} />}
      </ProductFormProvider>
    </div>
  );
}
