import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";
import paths from "@/utils/constants/paths";
import { Alert } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import { useProduct } from "../../context";

export default function DeleteProductModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate } = useLanguage();

  const navigate = useNavigate();

  const { currentProduct } = useProduct();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteProduct() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `products/${currentProduct?._id}`, language });
      navigate(`/${paths.admin}/${paths.home}/${paths.products}`);
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setError("");
    }, 250);
  }

  if (!currentProduct) return null;

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(`Delete Product "${currentProduct.title.en}"`, `حذف المنتج "${currentProduct.title.ar}"`)}
      subTitle={translate(`Are you sure you want to delete this product?`, `هل أنت متأكد أنك تريد حذف هذا المنتج؟`)}
      children={
        <Alert color="yellow" icon={<solidIcons.ExclamationCircle />}>
          {translate("This action is irreversible.", "هذا الإجراء لا يمكن التراجع عنه.")}
        </Alert>
      }
      action={deleteProduct}
      loading={loading}
      error={error}
    />
  );
}
