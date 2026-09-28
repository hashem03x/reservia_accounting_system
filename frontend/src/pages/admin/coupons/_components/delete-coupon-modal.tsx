import { Coupon } from "@/types/coupon";
import { PaginatedData } from "@/types/global";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";

export default function DeleteCouponModal({
  opened,
  close,
  couponToDelete,
  setCouponToDelete,
  setPaginatedCoupons,
}: {
  opened: boolean;
  close: () => void;
  couponToDelete: Coupon | null;
  setCouponToDelete: React.Dispatch<React.SetStateAction<Coupon | null>>;
  setPaginatedCoupons: React.Dispatch<React.SetStateAction<PaginatedData<Coupon>>>;
}) {
  const { language, translate } = useLanguage();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteCoupon() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `coupons/${couponToDelete?._id}`, language });
      setPaginatedCoupons((data) => {
        if (!data) return null;
        const filteredCoupons = data.data.filter((coupon) => coupon._id !== couponToDelete?._id);
        return { ...data, results: data.results - 1, data: filteredCoupons };
      });
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setCouponToDelete(null);
      setError("");
    }, 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(`Delete Coupon "${couponToDelete?.name}"`, `حذف الكوبون "${couponToDelete?.name}"`)}
      subTitle={translate(`Are you sure you want to delete this coupon?`, `هل أنت متأكد أنك تريد حذف هذا الكوبون؟`)}
      action={deleteCoupon}
      loading={loading}
      error={error}
    />
  );
}
