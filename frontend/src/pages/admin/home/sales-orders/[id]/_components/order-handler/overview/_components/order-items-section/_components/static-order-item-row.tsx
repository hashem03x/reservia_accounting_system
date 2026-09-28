import { useLanguage } from "@/context/LanguageContext";
import { getColorLabel } from "@/utils/constants/colors";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import { Table, Tooltip, Popover } from "@mantine/core";
import { useOrder } from "../../../../../../context";
import { solidIcons } from "@/components/icons";
import { useState } from "react";
import { UploadedImage } from "@/types/global";
import ratios from "@/utils/constants/ratios";
import Img from "@/components/ui/img";

export default function StaticOrderItemRow({ index }: { index: number }) {
  const { translate, language, translations } = useLanguage();
  const { order: currentOrder } = useOrder();
  if (!currentOrder) return null;
  const currentItem = currentOrder.items[index];
  if (!currentItem) return null; // Important: Prevent errors when switching from "Creating" mode to "Reading" mode.

  const [popoverOpened, setPopoverOpened] = useState(false);

  // Find the color images for the current variant's color
  const colorImages = currentItem.variant.product.colors.find((color) => color.name === currentItem.variant.color)?.images;

  return (
    <Table.Tr className="text-gray-600" h={40}>
      {/* Variant Code */}
      <Table.Td>{currentItem.variant.variantCode}</Table.Td>
      {/* Product Title */}
      <Table.Td className="font-bold text-gray-800">
        <Popover position="top" withArrow shadow="md" radius="md" opened={popoverOpened} onChange={setPopoverOpened}>
          <Popover.Target>
            <Link
              target="_blank"
              to={`/${paths.admin}/${paths.home}/${paths.products}/${currentItem.variant.product._id}`}
              className="hover:underline"
              onMouseEnter={() => setPopoverOpened(true)}
              onMouseLeave={() => setPopoverOpened(false)}
            >
              {translate(currentItem.variant.product.title.en, currentItem.variant.product.title.ar)}
            </Link>
          </Popover.Target>
          <Popover.Dropdown>
            {colorImages && colorImages.length > 0 ? (
              <ImagesViewer
                images={colorImages}
                titleEn={currentItem.variant.product.title.en}
                titleAr={currentItem.variant.product.title.ar}
              />
            ) : (
              <p className="text-sm">{translate("No images available", "لا توجد صور متاحة")}</p>
            )}
          </Popover.Dropdown>
        </Popover>
      </Table.Td>
      {/* Color */}
      <Table.Td>{getColorLabel(currentItem.variant.color, language)}</Table.Td>
      {/* Size */}
      <Table.Td>{currentItem.variant.size}</Table.Td>
      {/* Quantity */}
      <Table.Td>{currentItem.starterQuantity}</Table.Td>
      {/* Returned */}
      <Table.Td>{currentItem.returnedQuantity}</Table.Td>
      {/* Unit Price */}
      <Table.Td>
        {currentItem.unitPrice.toFixed(2)} {translations.currency}
      </Table.Td>
      {/* Discount */}
      <Table.Td>
        {currentItem.itemDiscount.value > 0 ? (
          <div className="flex items-center gap-1">
            {currentItem.itemDiscount.type === "percentage" ? (
              <span>{currentItem.itemDiscount.value}%</span>
            ) : (
              <span>
                {currentItem.itemDiscount.value.toFixed(2)} {translations.currency}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs sm:text-sm">{translate("No Discount", "لا يوجد خصم")}</p>
        )}
      </Table.Td>
      {/* Unit Price After Discount */}
      <Table.Td>
        {currentItem.unitPriceAfterDiscount.toFixed(2)} {translations.currency}
      </Table.Td>
      {/* Subtotal */}
      <Table.Td className="font-bold text-gray-800">
        {currentItem.subtotal.toFixed(2)} {translations.currency}
      </Table.Td>
      {currentItem.quantityToBeReturned > 0 && (
        <Table.Td>
          <Tooltip
            withArrow
            label={translate(
              `Customer requested to return ${currentItem.quantityToBeReturned} of this item`,
              `طلب العميل إرجاع ${currentItem.quantityToBeReturned} من هذا العنصر`,
            )}
          >
            <div className="animate-pulse">
              <solidIcons.ExclamationCircle className="text-red-500" />
            </div>
          </Tooltip>
        </Table.Td>
      )}
    </Table.Tr>
  );
}

// =============================================================

function ImagesViewer({ images, titleEn, titleAr }: { images: UploadedImage[]; titleEn: string; titleAr: string }) {
  const { translate } = useLanguage();

  return (
    <div className="flex gap-2">
      {images.map((image) => (
        <Img
          key={image._id}
          src={image.url}
          alt={translate(titleEn, titleAr)}
          aspectRatio={ratios.product}
          width="100px"
          className="rounded-lg"
        />
      ))}
    </div>
  );
}
