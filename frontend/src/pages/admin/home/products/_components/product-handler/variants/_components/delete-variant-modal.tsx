import { Variant } from "@/types/product";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";
import { useProduct } from "../../context";

export default function DeleteVariantModal({
  opened,
  close,
  variantToDelete,
  setVariantToDelete,
}: {
  opened: boolean;
  close: () => void;
  variantToDelete: Variant | null;
  setVariantToDelete: React.Dispatch<React.SetStateAction<Variant | null>>;
}) {
  const { language, translate } = useLanguage();

  const { currentProduct, setVariants } = useProduct();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteVariant() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        method: "DELETE",
        url: `products/${currentProduct?._id}/variants/${variantToDelete?._id}`,
        language,
      });
      setVariants((prev) => prev.filter((variant) => variant._id !== variantToDelete?._id));
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setVariantToDelete(null);
      setError("");
    }, 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(`Delete Variant`, `حذف الصنف`)}
      subTitle={translate(`Are you sure you want to delete this variant?`, `هل أنت متأكد أنك تريد حذف هذا الصنف؟`)}
      action={deleteVariant}
      loading={loading}
      error={error}
    />
  );
}
