import Barcode from "react-barcode";
import { useLanguage } from "@/context/LanguageContext";
import { useAbout } from "@/context/AboutContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { BARCODE_HEIGHT, BARCODE_WIDTH } from "@/utils/constants";
import { useOrder } from "../../../../../../context";
import { solidIcons } from "@/components/icons";
import PrintDocument from "@/components/ui/print-document";

export function PrintBarcodesVertical() {
  const { translate } = useLanguage();
  const { order } = useOrder();

  // Expand items array based on quantity
  const items = order.items;
  const expandedItems = items.map((item) => Array(item.starterQuantity - item.returnedQuantity).fill(item)).flat();
  // const expandedItems = items.flatMap((item) => Array(item.quantity).fill(item)); // Alternative to the above line.

  return (
    <PrintDocument
      title={translate("Barcodes Vertical", "الباركود عمودياً")}
      icon={<solidIcons.Barcode />}
      paperWidth={BARCODE_WIDTH}
      paperHeight={BARCODE_HEIGHT}
      paperMarginX={0}
      paperMarginY={0}
    >
      <div>
        {expandedItems.map((item, index) => (
          <div
            key={index}
            style={{
              width: `${BARCODE_WIDTH}mm`,
              height: `${BARCODE_HEIGHT}mm`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "2.5mm",
            }}
          >
            {/* Product Data */}
            <div
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 2.5mm",
              }}
            >
              <span style={{ fontSize: "2.5mm" }}>
                {item.product.title.en} - {item.product.price} EGP
              </span>
            </div>
            {/* Barcode */}
            <Barcode value={item.product.barcode || ""} margin={0} width={1.68} height={38} fontSize={14} />
          </div>
        ))}
      </div>
    </PrintDocument>
  );
}

export function PrintBarcodesHorizontal() {
  const { translate } = useLanguage();
  const { order } = useOrder();

  const swappedWidth = BARCODE_HEIGHT;
  const swappedHeight = BARCODE_WIDTH;

  // Expand items array based on quantity
  const items = order.items;
  const expandedItems = items.map((item) => Array(item.starterQuantity - item.returnedQuantity).fill(item)).flat();
  // const expandedItems = items.flatMap((item) => Array(item.quantity).fill(item)); // Alternative to the above line.

  return (
    <PrintDocument
      title={translate("Barcodes Horizontal", "الباركود أفقياً")}
      icon={<solidIcons.Barcode />}
      paperWidth={swappedWidth}
      paperHeight={swappedHeight}
      paperMarginX={0}
      paperMarginY={0}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: `${swappedWidth}mm`,
          height: `${swappedHeight * expandedItems.length}mm`,
        }}
      >
        {expandedItems.map((item, index) => (
          <div
            key={index}
            style={{
              width: `${swappedWidth}mm`,
              height: `${swappedHeight}mm`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: `${50}mm`,
                height: `${25}mm`,
                rotate: "90deg",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "2.5mm",
              }}
            >
              {/* Product Data */}
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: "2.5mm" }}>
                  {item.product.title.en} - {item.product.price} EGP
                </span>
              </div>
              {/* Barcode */}
              <Barcode value={item.product.barcode || ""} margin={0} width={1.68} height={38} fontSize={14} />
            </div>
          </div>
        ))}
      </div>
    </PrintDocument>
  );
}

// ========================= NEW =========================

export function PrintBarcodes() {
  const { translate } = useLanguage();
  const { order } = useOrder();
  const { data: aboutData } = useAbout();
  const { data: subcategories } = useSubcategories();

  console.log(subcategories);

  // Expand items array based on quantity
  const items = order.items;
  const expandedItems = items.map((item) => Array(item.starterQuantity - item.returnedQuantity).fill(item)).flat();
  // const expandedItems = items.flatMap((item) => Array(item.quantity).fill(item)); // Alternative to the above line.

  return (
    <PrintDocument
      title={translate("Barcodes", "الباركود")}
      icon={<solidIcons.Barcode />}
      paperWidth={BARCODE_WIDTH}
      paperHeight={BARCODE_HEIGHT}
      paperMarginX={0}
      paperMarginY={0}
    >
      <div
        style={{
          width: `${BARCODE_WIDTH}mm`,
          height: `${BARCODE_HEIGHT * expandedItems.length}mm`,
        }}
      >
        {expandedItems.map((item, index) => {
          const subcategory = subcategories.find((sub) => sub._id === item.product.subcategory);

          // Build barcode label info based on barcode settings - color/size no longer exist on a
          // product's order item (see docs/entities/products.md), only subcategory remains.
          const variantInfoParts: string[] = [];
          if (aboutData?.barcodeSittings?.subcategory && subcategory) {
            variantInfoParts.push(subcategory.name.en);
          }
          const variantInfo = variantInfoParts.join(" - ");

          return (
            <div
              key={index}
              style={{
                width: `${BARCODE_WIDTH}mm`,
                height: `${BARCODE_HEIGHT + 0.1375}mm`, // 0.1375mm is added to solve the issue of shifting (In case of 25mm => 25.1375mm)
                // height: `${BARCODE_HEIGHT + 0.0075}mm`, // 0.0075mm is added to solve the issue of shifting (In case of 50mm => 50.0075mm)
                // In fact, I don't know why this issue happens, but it's solved by adding this small value.
                // backgroundColor: `rgb(${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)}, ${Math.floor(Math.random() * 256)})`, // For testing
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${BARCODE_WIDTH}mm`,
                  height: `${BARCODE_HEIGHT}mm`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
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
                  {item.product.title.en}
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
                    {variantInfo} - {item.product.price} EGP
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
                    {item.product.price} EGP
                  </div>
                )}
                {/* Barcode */}
                <Barcode value={item.product.barcode || ""} margin={0} width={1.65} height={32} fontSize={12.5} />
              </div>
            </div>
          );
        })}
      </div>
    </PrintDocument>
  );
}
