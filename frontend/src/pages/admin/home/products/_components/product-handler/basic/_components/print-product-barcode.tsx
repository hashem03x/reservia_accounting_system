import { useLanguage } from "@/context/LanguageContext";
import { useAbout } from "@/context/AboutContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { BARCODE_HEIGHT, BARCODE_WIDTH } from "@/utils/constants";
import { outlineIcons } from "@/components/icons";
import PrintDocument from "@/components/ui/print-document";
import { Product } from "@/types/product";
import Barcode from "react-barcode";

// A Product carries its own barcode directly now - there is no separate Variant to print a
// barcode for (see docs/entities/products.md).
export default function PrintProductBarcode({ product, buttonType }: { product: Product; buttonType: "Menu" | "Button" | "Icon" }) {
  const { translate } = useLanguage();
  const { data: aboutData } = useAbout();
  const { data: subcategories } = useSubcategories();

  const subcategory = subcategories.find((sub) => sub._id === product.subcategory);

  const infoParts: string[] = [];
  if (aboutData?.barcodeSittings?.subcategory && subcategory) {
    infoParts.push(subcategory.name.en);
  }
  const info = infoParts.join(" - ");

  if (!product.barcode) return null;

  return (
    <PrintDocument
      title={translate("Print Barcode", "طباعة الباركود")}
      icon={<outlineIcons.Print size={16.5} />}
      paperWidth={BARCODE_WIDTH}
      paperHeight={BARCODE_HEIGHT}
      paperMarginX={0}
      paperMarginY={0}
      buttonType={buttonType}
    >
      <div
        style={{
          width: `${BARCODE_WIDTH}mm`,
          height: `${BARCODE_HEIGHT}mm`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "1.5mm",
        }}
      >
        {/* Product Title */}
        <div
          style={{
            width: "100%",
            textAlign: "center",
            fontSize: "2.21mm",
            fontWeight: 600,
            textWrap: "nowrap",
            overflow: "hidden",
          }}
        >
          {product.title.en}
        </div>
        {/* Info - Price */}
        <div
          style={{
            width: "100%",
            textAlign: "center",
            fontSize: "2.1mm",
          }}
        >
          {info ? `${info} - ` : ""}
          {product.price} EGP
        </div>
        {/* Barcode */}
        <Barcode value={product.barcode} margin={0} width={1.65} height={32} fontSize={12.5} />
      </div>
    </PrintDocument>
  );
}
