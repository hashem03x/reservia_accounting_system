import { useCallback, useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { Color } from "@/types/product";
import { UploadedImage } from "@/types/global";
import ratios, { getRatioLabel } from "@/utils/constants/ratios";
import { colorsArray } from "@/utils/constants/colors";
import { Button, ColorInput, Select } from "@mantine/core";
import { solidIcons, outlineIcons } from "@/components/icons";
import MultiImgsController from "@/components/ui/img-controller-multi";
import Img from "@/components/ui/img";
import { useProduct } from "../../context";

const IMAGE_WIDTH = "120px";

const MAX_IMAGES = 5;

export default function ColorsInformation() {
  const { translate } = useLanguage();

  const { colors, setColors, readOnly, currentProduct } = useProduct();

  function addColor() {
    setColors([...colors, { name: "black", code: "", images: [] }]);
  }

  function removeColor(index: number) {
    setColors(colors.filter((_, i) => i !== index));
  }

  function handleChangeColorName(colorIndex: number, value: Color) {
    const newColors = [...colors];
    newColors[colorIndex].name = value;
    setColors(newColors);
  }

  function handleChangeColorCode(colorIndex: number, value: string) {
    const newColors = [...colors];
    newColors[colorIndex].code = value;
    setColors(newColors);
  }

  return (
    <div className="product-details-box">
      <h3>{translate("Available Colors", "الألوان المتوفرة")}</h3>

      {colors.map((colorData, colorIndex) => (
        <div key={colorIndex} className="border-b pb-4">
          <header className="flex items-center justify-between py-2">
            <h4>
              {translate("Color", "اللون")} {colorIndex + 1}
            </h4>
            {!currentProduct?.colors.find((c) => c.name === colorData.name) && (
              <Button
                onClick={() => removeColor(colorIndex)}
                leftSection={<outlineIcons.Trash />}
                variant="light"
                color="red"
                disabled={colors.length === 1}
                title={colors.length === 1 ? translate("At least one color is required", "مطلوب على الأقل لون واحد") : ""}
              >
                {translate("Remove Color", "إزالة اللون")}
              </Button>
            )}
          </header>

          {/* Color Name and Code */}
          <div className="flex gap-3">
            <Select
              className="flex-1"
              withAsterisk
              searchable
              allowDeselect={false}
              placeholder={translate("Color Name", "اسم اللون")}
              value={colorData.name}
              onChange={(value) => handleChangeColorName(colorIndex, value as Color)}
              data={colorsArray.map((color) => ({
                label: translate(color.label.en, color.label.ar),
                value: color.value,
              }))}
              // readOnly={!!currentProduct?.colors.find((c) => c.name === colorData.name)}
              readOnly={readOnly}
            />
            <ColorInput
              className="flex-1"
              withAsterisk
              placeholder={translate("Color Code", "درجة اللون")}
              value={colorData.code}
              onChange={(value) => handleChangeColorCode(colorIndex, value)}
              readOnly={readOnly}
            />
          </div>

          {/* Images */}
          {readOnly ? (
            <ImagesViewer images={colorData.images as UploadedImage[]} />
          ) : (
            <ImagesHandler colorIndex={colorIndex} />
          )}
        </div>
      ))}

      {!readOnly && (
        <div>
          <Button onClick={addColor} variant="light" leftSection={<solidIcons.Plus />}>
            {colors.length === 0 ? translate("Add Color", "إضافة لون") : translate("Add Another Color", "إضافة لون آخر")}
          </Button>
        </div>
      )}
    </div>
  );
}

// =============================================================

function ImagesViewer({ images }: { images: UploadedImage[] }) {
  const { translate } = useLanguage();
  const { titleEn, titleAr } = useProduct();

  return (
    <div className="mt-4 flex gap-2">
      {images.map((image) => (
        <Img
          key={image._id}
          src={image.url}
          alt={translate(titleEn, titleAr)}
          aspectRatio={ratios.product}
          width={IMAGE_WIDTH}
          className="rounded-lg"
        />
      ))}
    </div>
  );
}

// =============================================================

function ImagesHandler({ colorIndex }: { colorIndex: number }) {
  const { translate } = useLanguage();
  const { colors, setColors } = useProduct();

  // Derived state for managing images for the specific color
  const initialImages = useMemo(() => colors[colorIndex]?.images || [], [colors, colorIndex]);
  const [images, setImages] = useState(initialImages);

  // Handle image deletion
  const handleImageDelete = useCallback(
    (imageIndex: number) => {
      setImages((prevImages) => {
        const updatedImages = prevImages.filter((_, i) => i !== imageIndex);

        // Update deleted images if the removed item is not a File
        const deletedImage = prevImages[imageIndex];
        if (deletedImage && !(deletedImage instanceof File)) {
          setColors((prevColors) => {
            const updatedColors = [...prevColors];
            const currentColor = updatedColors[colorIndex];
            if (currentColor) {
              currentColor.deleteImages = currentColor.deleteImages || [];
              currentColor.deleteImages.push(deletedImage._id);
            }
            return updatedColors;
          });
        }

        return updatedImages;
      });
    },
    [colorIndex, setColors],
  );

  // Sync images with the parent state
  useEffect(() => {
    const newColors = [...colors];
    newColors[colorIndex].images = images;
    setColors(newColors);
  }, [images]);

  return (
    <div className="mt-4">
      <div className="my-2">
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800 sm:text-base">
          {translate("Upload images for this color", "تحميل صور لهذا اللون")}
        </span>
        <p className="text-xs sm:text-sm">
          {translate(
            `Upload up to a maximum of ${MAX_IMAGES} images. Upload portrait images (${getRatioLabel(ratios.product)} ratio) for a better display.`,
            `قم بتحميل ما يصل إلى ${MAX_IMAGES} صور. قم بتحميل صور طولية (نسبة ${getRatioLabel(ratios.product)}) لكي تظهر بشكل أفضل.`,
          )}
        </p>
      </div>

      <MultiImgsController
        mini
        images={images}
        setImages={setImages}
        onClickOnImage={handleImageDelete}
        style={{ aspectRatio: ratios.product, width: IMAGE_WIDTH }}
      />
    </div>
  );
}
