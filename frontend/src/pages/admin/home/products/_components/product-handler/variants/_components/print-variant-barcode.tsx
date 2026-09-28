import Barcode from "react-barcode";
import { useLanguage } from "@/context/LanguageContext";
import { useAbout } from "@/context/AboutContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { getColorLabel } from "@/utils/constants/colors";
import { BARCODE_HEIGHT, BARCODE_WIDTH } from "@/utils/constants";
import { outlineIcons } from "@/components/icons";
import PrintDocument from "@/components/ui/print-document";
import { Product, Variant } from "@/types/product";

export default function PrintVariantBarcode({
  product,
  variant,
  buttonType,
}: {
  product: Product;
  variant: Variant;
  buttonType: "Menu" | "Button" | "Icon";
}) {
  const { translate } = useLanguage();
  const { data: aboutData } = useAbout();
  const { data: subcategories } = useSubcategories();

  const subcategory = subcategories.find((sub) => sub._id === product.subcategory);

  // Build variant info based on barcode settings
  const variantInfoParts: string[] = [];
  if (aboutData?.barcodeSittings?.subcategory && subcategory) {
    variantInfoParts.push(subcategory.name.en);
  }
  if (aboutData?.barcodeSittings?.color) {
    variantInfoParts.push(getColorLabel(variant.color, "en-US"));
  }
  if (aboutData?.barcodeSittings?.size) {
    variantInfoParts.push(variant.size);
  }
  const variantInfo = variantInfoParts.join(" - ");

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
        {/* Variant Info - Price */}
        {variantInfo && (
          <div
            style={{
              width: "100%",
              textAlign: "center",
              fontSize: "2.1mm",
            }}
          >
            {variantInfo} - {product.price} EGP
          </div>
        )}
        {!variantInfo && (
          <div
            style={{
              width: "100%",
              textAlign: "center",
              fontSize: "2.1mm",
            }}
          >
            {product.price} EGP
          </div>
        )}
        {/* Barcode */}
        <Barcode value={variant.variantCode} margin={0} width={1.65} height={32} fontSize={12.5} />
      </div>
    </PrintDocument>
  );
}
