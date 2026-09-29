import { useDebounce } from "use-debounce";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import useHasPermission from "@/hooks/useHasPermission";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { getVendorTypeLabel } from "@/utils/constants/vendor-types";
import { PaginatedData } from "@/types/global";
import { Vendor } from "@/types/vendor";
import { Button, Table, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import VendorModal from "@/components/global/vendor-modal";
import NoResultsSection from "@/components/ui/sections/no-results";
import ImportButton from "@/components/global/import-button";
import AdminGaurd from "@/components/ui/admin-gaurd";

const VENDORS_PER_PAGE = import.meta.env.VITE_VENDORS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Vendors() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.vendors} | ${translations.adminPanel}`);

  const navigate = useNavigate();

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [keyword, setKeyword] = useState(searchParams.get("keyword") || "");
  const [debouncedKeyword] = useDebounce(keyword, 350);

  const params = {
    page: activePage.toString(),
    ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
  };

  // Track the previous filters and check if they have changed to reset the active page to 1.
  const { filtersChanged, updatePreviousFilters } = useHandlePreviousFilters({ debouncedKeyword });

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedVendors,
    setData: setPaginatedVendors,
  } = useDataHandler<PaginatedData<Vendor>>({ initialData: null, initialLoading: true });

  function handleLoadVendors() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "vendors",
        params: { isDeleted: false, limit: VENDORS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedVendors(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    // If the filters have changed, reset the active page to 1.
    const newFilters = { debouncedKeyword };
    if (filtersChanged(newFilters)) {
      updatePreviousFilters(newFilters);
      if (activePage !== 1) {
        setActivePage(1);
        return;
      }
    }

    window.scrollTo({ top: 0, behavior: "instant" });

    const cancelRequest = handleLoadVendors(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage, debouncedKeyword]);

  const canICreateVendors = useHasPermission(resources.vendors, actions.create);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.admin}/${paths.home}`,
        title: translations.pages.vendors,
        sideElements: canICreateVendors && (
          <div className="flex items-center gap-2">
            <ImportButton url="import/vendors" callback={handleLoadVendors} />
            <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
              {translate("Add New Vendor", "إضافة بائع جديد")}
            </Button>
          </div>
        ),
      }}
    >
      {/* Filters */}
      <TextInput
        value={keyword}
        onChange={(e) => setKeyword(e.currentTarget.value)}
        placeholder={translate("Search for a vendor...", "ابحث عن بائع...")}
        leftSection={<solidIcons.Search />}
        rightSection={
          keyword && (
            <button onClick={() => setKeyword("")}>
              <solidIcons.XMark />
            </button>
          )
        }
      />

      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading vendors...", "جاري تحميل البائعين...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading vendors", "خطأ في تحميل البائعين")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadVendors }}
        />
      ) : (
        paginatedVendors &&
        (paginatedVendors.data.length === 0 ? (
          debouncedKeyword ? (
            <NoResultsSection
              keyword={debouncedKeyword}
              button={{ text: translate("View All", "عرض الكل"), onClick: () => setKeyword("") }}
            />
          ) : (
            <EmptySection useDefaultImg message={translate("No vendors found", "لا يوجد بائعون")} />
          )
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th>{translate("Phone", "الهاتف")}</Table.Th>
                    <Table.Th>{translate("Email", "البريد الإلكتروني")}</Table.Th>
                    <Table.Th>{translate("Type", "النوع")}</Table.Th>
                    <Table.Th>{translate("Tax Info", "البيانات الضريبية")}</Table.Th>
                    <AdminGaurd>
                      <Table.Th>{translate("Balance", "الرصيد")}</Table.Th>
                    </AdminGaurd>
                    <Table.Th>{translate("Address", "العنوان")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedVendors.data.map((vendor) => (
                    <Table.Tr
                      key={vendor._id}
                      className="cursor-pointer text-gray-600"
                      onClick={() => navigate(`${vendor._id}`)}
                    >
                      <Table.Td className="font-semibold text-gray-800">{vendor.name}</Table.Td>
                      <Table.Td>{vendor.contact?.phone || ""}</Table.Td>
                      <Table.Td>{vendor.contact?.email || ""}</Table.Td>
                      <Table.Td>{getVendorTypeLabel(vendor.type, language)}</Table.Td>
                      <Table.Td>{vendor.taxInfo?.taxRegistrationNumber || "-"}</Table.Td>
                      <AdminGaurd>
                        <Table.Td className="font-semibold text-gray-800">
                          {vendor.balance.toFixed(2)} {translations.currency}
                        </Table.Td>
                      </AdminGaurd>
                      <Table.Td>{stringifyAddress(vendor)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<Vendor>
              paginatedData={paginatedVendors}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}

      {/* Modals */}
      <VendorModal
        opened={modalOpened}
        close={closeModal}
        callback={(response) => {
          setPaginatedVendors((prev) => {
            if (!prev) return null;
            // Upsert, not always-prepend: this modal now stays open after creating a vendor (so
            // documents can be attached), so `callback` can fire again for the SAME vendor -
            // a naive prepend would insert a duplicate row for every subsequent save/document change.
            const existingIndex = prev.data.findIndex((vendor) => vendor._id === response._id);
            if (existingIndex >= 0) {
              const updated = [...prev.data];
              updated[existingIndex] = response;
              return { ...prev, data: updated };
            }
            return { ...prev, data: [response, ...prev.data] };
          });
        }}
      />
    </AdminLayoutBox>
  );
}

function stringifyAddress(vendor: Vendor) {
  let address = "";
  if (vendor.address?.country) address += `${vendor.address.country}`;
  if (vendor.address?.city) address += `, ${vendor.address.city}`;
  if (vendor.address?.street) address += `, ${vendor.address.street}`;
  return address;
}
