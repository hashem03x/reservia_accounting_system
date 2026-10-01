import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifySuccess } from "@/utils/helpers/notifiers";
import { isService } from "@/utils/constants/product-types";
import { Button, Tooltip } from "@mantine/core";
import { outlineIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";
import TypeSelection from "./_components/type-selection";
import GeneralInformation from "./_components/general-information";
import ServiceInformation from "./_components/service-information";
import CategoriesInformation from "./_components/categoreies-information";
import CapacityInformation from "./_components/capacity-information";
import InventoryInformation from "./_components/inventory-information";
import DeleteProductModal from "./_components/delete-product-modal";
import validation from "./_utils/validation";
import { useProduct } from "../context";

export default function ProductBasicInfo() {
  const { language, translate } = useLanguage();

  const {
    type,
    durationValue,
    durationUnit,
    titleEn,
    titleAr,
    descriptionEn,
    descriptionAr,
    cost,
    price,
    priceAfterDiscount,
    isAvailable,
    category,
    subcategory,
    capacity,
    setCapacity,
    sku,
    setSku,
    barcode,
    setBarcode,
    stock,
    setStock,
    currentProduct,
    setCurrentProduct,
    canIUpdateProducts,
  } = useProduct();

  const productIsService = isService(type);

  const updatingStatus = currentProduct ? true : false;

  const [moreOptionsOpened, setMoreOptionsOpened] = useState(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const vaildationError = validation(
        {
          type,
          titleEn,
          titleAr,
          descriptionEn,
          descriptionAr,
          cost,
          price,
          priceAfterDiscount,
          category,
          subcategory,
          capacity,
          durationValue,
          durationUnit,
        },
        language,
      );

      if (vaildationError) {
        setError(vaildationError);
        return;
      }

      const formData = new FormData();
      formData.append("type", type);
      formData.append("title[en]", titleEn);
      formData.append("title[ar]", titleAr);
      formData.append("description[en]", descriptionEn);
      formData.append("description[ar]", descriptionAr);
      formData.append("price", price.toString());
      priceAfterDiscount !== "" && formData.append("priceAfterDiscount", priceAfterDiscount.toString());
      formData.append("isAvailable", isAvailable.toString());

      if (productIsService) {
        // A service has no cost/category/subcategory/stock - see docs/entities/products.md.
        formData.append("durationValue", durationValue.toString());
        formData.append("durationUnit", durationUnit);
      } else {
        formData.append("cost", cost.toString());
        formData.append("category", category as string);
        formData.append("subcategory", subcategory as string);

        if (sku) formData.append("sku", sku);
        if (barcode) formData.append("barcode", barcode);
        formData.append("stock", JSON.stringify(stock.map((item) => ({ warehouse: item.warehouse, quantity: item.quantity || 0 }))));
      }
      if (capacity.value !== "" || capacity.unit) {
        formData.append("capacity", JSON.stringify({ value: capacity.value === "" ? undefined : +capacity.value, unit: capacity.unit || undefined }));
      }

      const response = await privateRequest({
        url: updatingStatus ? `products/${currentProduct?._id}` : "products",
        method: updatingStatus ? "PUT" : "POST",
        data: formData,
        language,
      });

      setCurrentProduct(response.data);
      setSku(response.data.sku || "");
      setBarcode(response.data.barcode || ""); // Reflects the server-generated default when left empty
      setStock(response.data.stock ? JSON.parse(JSON.stringify(response.data.stock)) : []);
      setCapacity({ value: response.data.capacity?.value ?? "", unit: response.data.capacity?.unit || "" });

      notifySuccess({
        language,
        title: translate("Success", "نجاح"),
        message: updatingStatus
          ? translate("Product updated successfully", "تم تحديث المنتج بنجاح")
          : translate("Product added successfully", "تم اضافة المنتج بنجاح"),
      });
    });
  }

  // PriceAfterDiscount condition works a little bit different. (See form data and validation)
  const priceAfterDiscountChanged: boolean = currentProduct
    ? typeof priceAfterDiscount === "number"
      ? priceAfterDiscount !== currentProduct.priceAfterDiscount
      : priceAfterDiscount === "" && currentProduct.priceAfterDiscount !== null
    : false;

  // To disable the save button if no data changed in case of updating. Product-only and
  // service-only fields are each only compared when relevant - `type` is read-only after
  // creation, so this never has to reconcile a product's diff against a service's fields.
  const dataChanged = currentProduct
    ? titleEn !== currentProduct.title.en ||
      titleAr !== currentProduct.title.ar ||
      descriptionEn !== currentProduct.description.en ||
      descriptionAr !== currentProduct.description.ar ||
      price !== currentProduct.price ||
      priceAfterDiscountChanged ||
      isAvailable !== currentProduct.isAvailable ||
      (capacity.value?.toString() || "") !== (currentProduct.capacity?.value?.toString() || "") ||
      capacity.unit !== (currentProduct.capacity?.unit || "") ||
      (productIsService
        ? durationValue !== currentProduct.durationValue || durationUnit !== currentProduct.durationUnit
        : cost !== currentProduct.cost ||
          category !== currentProduct.category ||
          subcategory !== currentProduct.subcategory ||
          sku !== (currentProduct.sku || "") ||
          barcode !== (currentProduct.barcode || "") ||
          stock.some((stockItem) => {
            const existing = (currentProduct.stock || []).find((item) => item.warehouse === stockItem.warehouse);
            return (existing?.quantity || 0) !== (Number(stockItem.quantity) || 0);
          }))
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

        <TypeSelection />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          <div className="lg:col-span-4">
            <GeneralInformation />
          </div>
          {!productIsService && (
            <div className="lg:col-span-2">
              <CategoriesInformation />
            </div>
          )}
        </div>

        {productIsService ? <ServiceInformation /> : <InventoryInformation />}
        <CapacityInformation />
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
