import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import { isAdmin } from "@/utils/constants/roles";
import { isService } from "@/utils/constants/product-types";
import { NumberInput, Textarea, TextInput, Checkbox, createTheme, MantineProvider } from "@mantine/core";
import { useProduct } from "../../context";

const theme = createTheme({
  cursorType: "pointer",
});

const doubleInputDivClasses = "flex flex-col gap-3 sm:flex-row md:flex-col xl:flex-row";

export default function GeneralInformation() {
  const { translate } = useLanguage();

  const { user: loggedInUser } = useUser();

  const {
    isAvailable,
    setIsAvailable,
    titleEn,
    setTitleEn,
    titleAr,
    setTitleAr,
    descriptionEn,
    setDescriptionEn,
    descriptionAr,
    setDescriptionAr,
    cost,
    setCost,
    price,
    setPrice,
    priceAfterDiscount,
    setPriceAfterDiscount,
    currentProduct,
    readOnly,
    type,
  } = useProduct();

  return (
    <div className="product-details-box">
      <h3>{translate("General Information", "المعلومات العامة")}</h3>

      {/* Title */}
      <div className={doubleInputDivClasses}>
        <TextInput
          label={translate("Product Title in English", "عنوان المنتج بالإنجليزية")}
          placeholder={translate("Product Title in English", "عنوان المنتج بالإنجليزية")}
          withAsterisk
          value={titleEn}
          onChange={(e) => setTitleEn(e.currentTarget.value)}
          className="flex-1"
          readOnly={readOnly}
        />
        <TextInput
          label={translate("Product Title in Arabic", "عنوان المنتج بالعربية")}
          placeholder={translate("Product Title in Arabic", "عنوان المنتج بالعربية")}
          withAsterisk
          value={titleAr}
          onChange={(e) => setTitleAr(e.currentTarget.value)}
          className="flex-1"
          readOnly={readOnly}
        />
      </div>

      {/* Description */}
      <div className={doubleInputDivClasses}>
        <Textarea
          label={translate("Product Description in English", "وصف المنتج بالإنجليزية")}
          placeholder={translate("Product Description in English", "وصف المنتج بالإنجليزية")}
          autosize
          minRows={3}
          withAsterisk
          value={descriptionEn}
          onChange={(e) => setDescriptionEn(e.currentTarget.value)}
          className="flex-1"
          readOnly={readOnly}
        />
        <Textarea
          label={translate("Product Description in Arabic", "وصف المنتج بالعربية")}
          placeholder={translate("Product Description in Arabic", "وصف المنتج بالعربية")}
          autosize
          minRows={3}
          withAsterisk
          value={descriptionAr}
          onChange={(e) => setDescriptionAr(e.currentTarget.value)}
          className="flex-1"
          readOnly={readOnly}
        />
      </div>
      {/* Cost - a service has no inventory cost (see docs/entities/products.md). Otherwise available
          for admins when creating and updating, and available for others only when creating */}
      {!isService(type) && ((!!loggedInUser && isAdmin(loggedInUser.role)) || !currentProduct) && (
        <NumberInput
          label={translate("Cost", "التكلفة")}
          placeholder={translate("Cost in EGP", "التكلفة بالجنيه")}
          withAsterisk
          min={0}
          clampBehavior="strict"
          allowNegative={false}
          decimalScale={2}
          value={cost}
          onChange={setCost}
          className="flex-1"
          // readOnly={readOnly || (!!currentProduct && !!loggedInUser && !isAdmin(loggedInUser.role))} // In case of updating, only admins can edit the cost
        />
      )}
      {/* Price and Price After Discount */}
      <div className={doubleInputDivClasses}>
        <NumberInput
          label={translate("Price", "السعر")}
          placeholder={translate("Price in EGP", "السعر بالجنيه")}
          withAsterisk
          min={0}
          clampBehavior="strict"
          allowNegative={false}
          decimalScale={2}
          value={price}
          onChange={setPrice}
          className="flex-1"
          readOnly={readOnly}
        />
        <NumberInput
          label={translate("Price After Discount (Optional)", "السعر بعد الخصم (اختياري)")}
          placeholder={translate("Price in EGP", "السعر بالجنيه")}
          min={0}
          clampBehavior="strict"
          allowNegative={false}
          decimalScale={2}
          value={priceAfterDiscount}
          onChange={setPriceAfterDiscount}
          className="flex-1"
          readOnly={readOnly}
        />
      </div>

      {/* Is Available */}
      <MantineProvider theme={theme}>
        <Checkbox
          mt={4}
          label={translate("Available for Sale", "متاح للبيع")}
          title={translate(
            "Choose whether the product is available for sale or not.",
            "اختر ما إذا كان المنتج متاحًا للبيع أم لا.",
          )}
          checked={isAvailable}
          onChange={(e) => setIsAvailable(e.currentTarget.checked)}
          disabled={readOnly}
        />
      </MantineProvider>
    </div>
  );
}
