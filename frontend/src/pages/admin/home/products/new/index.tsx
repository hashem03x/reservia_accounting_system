import useDocumentTitle from "@/hooks/useDocumentTitle";
import { useLanguage } from "@/context/LanguageContext";
import ProductHandler from "../_components/product-handler";

export default function NewProduct() {
  const { translate, translations } = useLanguage();

  useDocumentTitle(`${translate("Add Product", "إضافة منتج")} | ${translations.adminPanel}`);

  return <ProductHandler />;
}
