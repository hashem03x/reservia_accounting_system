import { useEffect, useState } from "react";
import { Product } from "@/types/product";
import { LocalizedEntity } from "@/types/global";
import { isService } from "@/utils/constants/product-types";
import NavigationTabs from "@/components/ui/navigation-tabs";
import ProductFormProvider, { useProduct } from "./context";
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
  return (
    <ProductFormProvider product={product}>
      <ProductHandlerBody />
    </ProductFormProvider>
  );
}

// A service has no inventory, so it has no Variants tab (see docs/entities/products.md) - this
// needs to live INSIDE the provider (not in ProductHandler above it) so the tab list can react to
// the live `type` value as the user toggles Product/Service, not just the initial prop.
function ProductHandlerBody() {
  const { type } = useProduct();
  const [activeTab, setActiveTab] = useState<ProductTab>(TABS.basic.value);

  // NavigationTabs only ever reads this via Object.values(), so a "partial" LocalizedEntity cast
  // to the full type is safe here - it never assumes every key of ProductTab is present.
  const visibleTabs: LocalizedEntity<ProductTab> = isService(type)
    ? (Object.fromEntries(Object.entries(TABS).filter(([key]) => key === "basic")) as LocalizedEntity<ProductTab>)
    : TABS;

  // If the user switches an unsaved product to "service" while the Variants tab is active,
  // fall back to Basic rather than showing a now-hidden tab as "active".
  useEffect(() => {
    if (isService(type) && activeTab === TABS.variants.value) setActiveTab(TABS.basic.value);
  }, [type, activeTab]);

  const navMethods: NavMethods = Object.keys(TABS).reduce(
    (methods, key) => ({ ...methods, [key]: () => setActiveTab(TABS[key as ProductTab].value) }),
    {} as NavMethods,
  );

  return (
    <div className="root-flex-1 flex min-h-full flex-col gap-4">
      <NavigationTabs tabs={visibleTabs} activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === TABS.basic.value && <ProductBasicInfo navMethods={navMethods} />}
      {activeTab === TABS.variants.value && !isService(type) && <Variants navMethods={navMethods} />}
    </div>
  );
}
