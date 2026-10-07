import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { PaginatedData } from "@/types/global";
import { Coupon } from "@/types/coupon";
import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import CouponCard from "./_components/coupon-card";
import CouponModal from "./_components/coupon-modal";
import DeleteCouponModal from "./_components/delete-coupon-modal";

const COUPONS_PER_PAGE = import.meta.env.VITE_COUPONS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Coupons() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.coupons} | ${translations.adminPanel}`);

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));

  const params = { page: activePage.toString() };

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedCoupons,
    setData: setPaginatedCoupons,
  } = useDataHandler<PaginatedData<Coupon>>({ initialData: null, initialLoading: true });

  function handleLoadCoupons() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "coupons",
        params: { limit: COUPONS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedCoupons(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  const canICreateCoupons = useHasPermission(resources.coupons, actions.create);
  const canIUpdateCoupons = useHasPermission(resources.coupons, actions.update);
  const canIDeleteCoupons = useHasPermission(resources.coupons, actions.delete);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);

  const [couponToUpdate, setCouponToUpdate] = useState<Coupon | null>(null);
  const [couponToDelete, setCouponToDelete] = useState<Coupon | null>(null);

  function handleOpenUpdateModal(coupon: Coupon) {
    setCouponToUpdate(coupon);
    openModal();
  }

  function handleOpenDeleteModal(coupon: Coupon) {
    setCouponToDelete(coupon);
    openDeleteModal();
  }

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    window.scrollTo({ top: 0, behavior: "instant" });

    const cancelRequest = handleLoadCoupons(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage]);

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.coupons,
        sideElements: canICreateCoupons && (
          <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
            {translate("Add Coupon", "إضافة كوبون")}
          </Button>
        ),
      }}
    >
      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading coupons...", "جاري تحميل الكوبونات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading coupons", "خطأ في تحميل الكوبونات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadCoupons }}
        />
      ) : (
        paginatedCoupons &&
        (paginatedCoupons.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No coupons found", "لا توجد كوبونات")} />
        ) : (
          <>
            <div className="grid animate-fade-in grid-cols-1 gap-4 md:grid-cols-2">
              {paginatedCoupons.data.map((coupon) => (
                <CouponCard
                  key={coupon._id}
                  coupon={coupon}
                  openUpdateModal={canIUpdateCoupons ? () => handleOpenUpdateModal(coupon) : null}
                  openDeleteModal={canIDeleteCoupons ? () => handleOpenDeleteModal(coupon) : null}
                />
              ))}
            </div>

            {/* Pagination */}
            <PaginationHandler<Coupon>
              paginatedData={paginatedCoupons}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}

      {/* Modals */}
      <CouponModal
        opened={modalOpened}
        close={closeModal}
        setPaginatedCoupons={setPaginatedCoupons}
        couponToUpdate={couponToUpdate}
        setCouponToUpdate={setCouponToUpdate}
      />
      <DeleteCouponModal
        opened={deleteModalOpened}
        close={closeDeleteModal}
        setPaginatedCoupons={setPaginatedCoupons}
        couponToDelete={couponToDelete}
        setCouponToDelete={setCouponToDelete}
      />
    </AdminLayoutBox>
  );
}