import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import ProductSearchModal from "@/components/global/variant-search-modal";
import { outlineIcons, solidIcons } from "@/components/icons";

export interface BoqLineInput {
  product: string;
  productLabel?: string;
  quantity: number | string;
  unit: string;
  unitPrice: number | string;
  currency: string;
}

export const boqLineIsComplete = (l: BoqLineInput) => !!l.product && Number(l.quantity) > 0 && l.unitPrice !== "" && Number(l.unitPrice) >= 0;
export const boqPayload = (lines: BoqLineInput[]) =>
  lines.map((l) => ({ product: l.product, quantity: Number(l.quantity), unit: l.unit.trim() || undefined, unitPrice: Number(l.unitPrice), currency: l.currency || "EGP" }));

/**
 * The project's BOQ (Bill of Quantities): per catalog product its contract quantity, unit and BOQ
 * unit price - the revenue-side price of the item (client requirement "Projects - Raw Materials
 * Breakdown, BOQ Price, and PO Cost"). One line per product. A BOQ price in another currency is
 * converted to EGP by the backend with the rate in effect on the project start date. Analysis only:
 * nothing is posted.
 */
export default function BoqEditor({ lines, setLines }: { lines: BoqLineInput[]; setLines: React.Dispatch<React.SetStateAction<BoqLineInput[]>> }) {
  const { translate, language } = useLanguage();
  const request = usePrivateRequest();
  const [searchOpened, { open: openSearch, close: closeSearch }] = useDisclosure();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [currencies, setCurrencies] = useState<string[]>(["EGP"]);

  useEffect(() => {
    request({ url: "currencies", params: { status: "active", limit: 200 }, language })
      .then((res) => setCurrencies(Array.isArray(res?.data) && res.data.length ? res.data.map((c: { code: string }) => c.code) : ["EGP"]))
      .catch(() => setCurrencies(["EGP"]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (i: number, patch: Partial<BoqLineInput>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function selected(barcode: string) {
    if (activeIndex === null) return;
    const index = activeIndex;
    try {
      const res = await request({ url: `products/code/${barcode}`, language });
      const product = res.data;
      if (lines.some((l, i) => i !== index && l.product === product._id)) {
        // One line per product - the existing line is the one to edit.
        return;
      }
      update(index, { product: product._id, productLabel: [translate(product.title.en, product.title.ar), product.model].filter(Boolean).join(" - ") });
    } catch {
      // The search only lists real products.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4>{translate("BOQ (Bill of Quantities)", "جدول الكميات")}</h4>
        <Button size="xs" variant="light" onClick={() => setLines((prev) => [...prev, { product: "", quantity: 1, unit: "", unitPrice: "", currency: "EGP" }])} leftSection={<outlineIcons.Squares size={14} />}>
          {translate("Add BOQ line", "إضافة بند")}
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        {translate(
          "The BOQ unit price is the item's revenue-side price; its cost comes from the project's purchases. Each product can appear once.",
          "سعر الوحدة في جدول الكميات هو سعر البيع للبند؛ وتكلفته من مشتريات المشروع. يظهر كل منتج مرة واحدة.",
        )}
      </p>
      {lines.map((line, i) => (
        <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700 sm:grid-cols-12">
          <div className="flex flex-col gap-1 sm:col-span-4">
            <span className="text-sm font-medium">
              {translate("Product", "المنتج")} <span className="text-red-500">*</span>
            </span>
            <Button
              variant={line.product ? "light" : "outline"}
              color={line.product ? "blue" : "red"}
              justify="space-between"
              rightSection={<solidIcons.Search size={14} />}
              onClick={() => {
                setActiveIndex(i);
                openSearch();
              }}
            >
              <span className="truncate">{line.product ? line.productLabel || translate("Selected product", "منتج محدد") : translate("Select from catalog", "اختر من الكتالوج")}</span>
            </Button>
          </div>
          <NumberInput className="sm:col-span-2" label={translate("BOQ quantity", "الكمية")} value={line.quantity} onChange={(v) => update(i, { quantity: v })} min={0.0001} decimalScale={4} required />
          <TextInput className="sm:col-span-1" label={translate("Unit", "الوحدة")} value={line.unit} onChange={(e) => update(i, { unit: e.currentTarget.value })} maxLength={30} />
          <NumberInput className="sm:col-span-2" label={translate("BOQ unit price", "سعر الوحدة")} value={line.unitPrice} onChange={(v) => update(i, { unitPrice: v })} min={0} decimalScale={2} thousandSeparator="," required />
          <Select className="sm:col-span-2" label={translate("Currency", "العملة")} value={line.currency} onChange={(v) => update(i, { currency: v || "EGP" })} data={[...new Set(["EGP", ...currencies, line.currency])]} allowDeselect={false} />
          <div className="flex justify-end sm:col-span-1">
            <button type="button" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} className="mb-2" title={translate("Remove", "حذف")}>
              <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
            </button>
          </div>
        </div>
      ))}
      <ProductSearchModal
        opened={searchOpened}
        close={closeSearch}
        mode="purchase"
        onSelect={(barcode) => {
          selected(barcode);
          closeSearch();
        }}
      />
    </div>
  );
}
