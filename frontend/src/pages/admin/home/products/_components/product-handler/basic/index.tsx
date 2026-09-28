import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifySuccess } from "@/utils/helpers/notifiers";
import { Button, Tooltip } from "@mantine/core";
import { outlineIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import GeneralInformation from "./_components/general-information";
import CategoriesInformation from "./_components/categoreies-information";
import ColorsInformation from "./_components/colors-information";
import TagsInformation from "./_components/tags-information";
import DeleteProductModal from "./_components/delete-product-modal";
import validation from "./_utils/validation";
import { useProduct } from "../context";
import { NavMethods } from "..";

export default function ProductBasicInfo({ navMethods }: { navMethods: NavMethods }) {
  const { language, translate } = useLanguage();

  const {
    titleEn,
    titleAr,
    descriptionEn,
    descriptionAr,
    cost,
    price,
    priceAfterDiscount,
    isAvailable,
    season,
    category,
    subcategory,
    colors,
    setColors,
    tags,
    setTags,
    currentProduct,
    setCurrentProduct,
    canIUpdateProducts,
  } = useProduct();

  const updatingStatus = currentProduct ? true : false;

  const [moreOptionsOpened, setMoreOptionsOpened] = useState(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const vaildationError = validation(
        { titleEn, titleAr, descriptionEn, descriptionAr, cost, price, priceAfterDiscount, category, subcategory, colors, tags },
        language,
      );

      if (vaildationError) {
        setError(vaildationError);
        return;
      }

      const formData = new FormData();
      formData.append("title[en]", titleEn);
      formData.append("title[ar]", titleAr);
      formData.append("description[en]", descriptionEn);
      formData.append("description[ar]", descriptionAr);
      formData.append("cost", cost.toString());
      formData.append("price", price.toString());
      priceAfterDiscount !== "" && formData.append("priceAfterDiscount", priceAfterDiscount.toString());
      formData.append("isAvailable", isAvailable.toString());
      formData.append("season", season);
      formData.append("category", category as string);
      formData.append("subcategory", subcategory as string);
      formData.append(
        "colors",
        JSON.stringify(
          colors.map((color) => {
            return { name: color.name, code: color.code, deleteImages: color.deleteImages?.join(",") }; // In case of updating, "deleteImages" field is to delete old images.
          }),
        ),
      );
      // Append new images of each color (File objects)
      colors.forEach((color, index) => {
        color.images.forEach((image) => {
          if (image instanceof File) formData.append(`colorImages${index}`, image);
        });
      });
      formData.append("tags", JSON.stringify(tags));

      const response = await privateRequest({
        url: updatingStatus ? `products/${currentProduct?._id}` : "products",
        method: updatingStatus ? "PUT" : "POST",
        params: { colors: colors.length },
        data: formData,
        language,
      });

      setCurrentProduct(response.data);
      setColors(JSON.parse(JSON.stringify(response.data.colors))); // To replace File objects with UploadedImage objects
      setTags(response.data.tags || []); // Reflects the server's normalized (trimmed/deduped) tags

      notifySuccess({
        language,
        title: translate("Success", "نجاح"),
        message: updatingStatus
          ? translate("Product updated successfully", "تم تحديث المنتج بنجاح")
          : translate("Product added successfully", "تم اضافة المنتج بنجاح"),
      });

      !updatingStatus && canIUpdateProducts && navMethods.variants();
    });
  }

  // PriceAfterDiscount condition works a little bit different. (See form data and validation)
  const priceAfterDiscountChanged: boolean = currentProduct
    ? typeof priceAfterDiscount === "number"
      ? priceAfterDiscount !== currentProduct.priceAfterDiscount
      : priceAfterDiscount === "" && currentProduct.priceAfterDiscount !== null
    : false;

  // To disable the save button if no data changed in case of updating
  const dataChanged = currentProduct
    ? titleEn !== currentProduct.title.en ||
      titleAr !== currentProduct.title.ar ||
      descriptionEn !== currentProduct.description.en ||
      descriptionAr !== currentProduct.description.ar ||
      cost !== currentProduct.cost ||
      price !== currentProduct.price ||
      priceAfterDiscountChanged ||
      isAvailable !== currentProduct.isAvailable ||
      season !== currentProduct.season ||
      category !== currentProduct.category ||
      subcategory !== currentProduct.subcategory ||
      colors.length !== currentProduct.colors.length ||
      colors.some((color, index) => color.name !== currentProduct.colors[index].name) ||
      colors.some((color, index) => color.code !== currentProduct.colors[index].code) ||
      colors.some((color, index) => color.images.length !== currentProduct.colors[index].images.length) ||
      colors.some((color, index) =>
        color.images.some((image, imageIndex) => {
          if (image instanceof File) return true;
          if (image._id !== currentProduct.colors[index].images[imageIndex]._id) return true;
        }),
      ) ||
      tags.length !== currentProduct.tags.length ||
      tags.some((tag, index) => tag !== currentProduct.tags[index])
    : false;

  const dataChanedText = translate("Unsaved changes detected", "توجد تغييرات لم يتم حفظها");

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-4 shadow">
          <div className="flex flex-col">
            <h2>{translate("Basic Information", "المعلومات الاساسية")}</h2>
            <p className="text-xs sm:text-sm">
              {translate(
                "Here you can specify the basic information of the product.",
                "هنا يمكنك تحديد المعلومات الاساسية للمنتج.",
              )}
            </p>
          </div>

          {updatingStatus && !canIUpdateProducts ? null : (
            <div className="flex items-center gap-3">
              {updatingStatus && dataChanged && (
                <Tooltip label={dataChanedText} withArrow position="left" offset={12}>
                  <div className="rounded-full bg-orange-100 p-1">
                    <outlineIcons.ExclamationCircle size={25} className="animate-pulse text-orange-500" />
                  </div>
                </Tooltip>
              )}
              <Button
                type="submit"
                px="xl"
                size="md"
                radius="md"
                loading={loading}
                disabled={updatingStatus && !dataChanged}
              >
                {translate("Save", "حفظ")}
              </Button>
            </div>
          )}
        </header>

        {error && <ErrorAlert error={error} fade />}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          <div className="lg:col-span-4">
            <GeneralInformation />
          </div>
          <div className="lg:col-span-2">
            <CategoriesInformation />
          </div>
        </div>

        <TagsInformation />

        <ColorsInformation />
      </form>

      {/* Temporary Hide the deleting option */}
      {false && (
        <>
          {/* Deleting Product -  As the Modal is another form, it should be outside the main form */}
          {updatingStatus && (
            <div className="flex justify-end">
              {moreOptionsOpened ? (
                canIUpdateProducts && (
                  <div className="animate-fade-in">
                    <Button onClick={openDeleteModal} color="red">
                      {translate("Delete Product Completely", "حذف المنتج كلياً")}
                    </Button>

                    <DeleteProductModal opened={deleteModalOpened} close={closeDeleteModal} />
                  </div>
                )
              ) : (
                <button
                  className="text-xs text-gray-600 hover:underline sm:text-sm"
                  onClick={() => setMoreOptionsOpened(true)}
                >
                  {translate("Show More Options", "عرض المزيد من الخيارات")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
