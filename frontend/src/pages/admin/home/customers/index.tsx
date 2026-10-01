import { Customer } from "@/types/customer";
import { PaginatedData } from "@/types/global";
import { useDebounce } from "use-debounce";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import roles from "@/utils/constants/roles";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Button, Table, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import CustomerModal from "@/components/global/customer-modal";
import NoResultsSection from "@/components/ui/sections/no-results";
import { getCustomerTypeLabel } from "@/utils/constants/customer-types";
import ImportButton from "@/components/global/import-button";
import UnauthorizedSection from "@/components/ui/sections/unauthorized";
import AdminGaurd from "@/components/ui/admin-gaurd";

const CUSTOMERS_PER_PAGE = import.meta.env.VITE_CUSTOMERS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Customers() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.customers} | ${translations.adminPanel}`);

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
    data: paginatedCustomers,
    setData: setPaginatedCustomers,
  } = useDataHandler<PaginatedData<Customer>>({ initialData: null, initialLoading: true });

  function handleLoadCustomers() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "customers",
        params: { role: roles.user.value, isDeleted: false, limit: CUSTOMERS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedCustomers(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  const canICreateCustomers = useHasPermission(resources.customers, actions.create);
  const canIReadCustomers = useHasPermission(resources.customers, actions.read);

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    if (!canIReadCustomers) return; // If the user doesn't have permission to read customers, don't fetch data.

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

    const cancelRequest = handleLoadCustomers(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage, debouncedKeyword, canIReadCustomers]);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.admin}/${paths.home}`,
        title: translations.pages.customers,
        sideElements: canICreateCustomers && (
          <div className="flex items-center gap-2">
            <ImportButton url="import/customers" callback={handleLoadCustomers} />
            <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
              {translate("Add New Customer", "إضافة عميل جديد")}
            </Button>
          </div>
        ),
      }}
    >
      {/* Filters */}
      {canIReadCustomers && (
        <TextInput
          value={keyword}
          onChange={(e) => setKeyword(e.currentTarget.value)}
          placeholder={translate("Search for a customer...", "ابحث عن عميل...")}
          leftSection={<solidIcons.Search />}
          rightSection={
            keyword && (
              <button onClick={() => setKeyword("")}>
                <solidIcons.XMark />
              </button>
            )
          }
        />
      )}

      {/* Content */}
      {!canIReadCustomers ? (
        <UnauthorizedSection
          message={translate("You don't have permission to view customers", "ليس لديك إذن لعرض العملاء")}
        />
      ) : loading ? (
        <LoadingSection message={translate("Loading customers...", "جاري تحميل العملاء...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading customers", "خطأ في تحميل العملاء")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadCustomers }}
        />
      ) : (
        paginatedCustomers &&
        (paginatedCustomers.data.length === 0 ? (
          debouncedKeyword ? (
            <NoResultsSection
              keyword={debouncedKeyword}
              button={{ text: translate("View All", "عرض الكل"), onClick: () => setKeyword("") }}
            />
          ) : (
            <EmptySection useDefaultImg message={translate("No customers found", "لا يوجد عملاء")} />
          )
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Customer Number", "رقم العميل")}</Table.Th>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th>{translate("Phone", "الهاتف")}</Table.Th>
                    <Table.Th>{translate("Additionl Phone", "هاتف اضافي")}</Table.Th>
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
                  {paginatedCustomers.data.map((customer) => (
                    <Table.Tr
                      key={customer._id}
                      className="cursor-pointer text-gray-600"
                      onClick={() => navigate(`${customer._id}`)}
                    >
                      <Table.Td>{customer.customerNumber ?? "-"}</Table.Td>
                      <Table.Td className="font-semibold text-gray-800">{customer.name}</Table.Td>
                      <Table.Td>{customer.phone || ""}</Table.Td>
                      <Table.Td>{customer.additionalPhone || ""}</Table.Td>
                      <Table.Td>{customer.email || ""}</Table.Td>
                      <Table.Td>{getCustomerTypeLabel(customer.type, language)}</Table.Td>
                      <Table.Td>{customer.taxInfo?.taxRegistrationNumber || "-"}</Table.Td>
                      <AdminGaurd>
                        <Table.Td className="font-semibold text-gray-800">
                          {customer.balance.toFixed(2)} {translations.currency}
                        </Table.Td>
                      </AdminGaurd>
                      <Table.Td>{stringifyAddress(customer)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<Customer>
              paginatedData={paginatedCustomers}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}

      <div className="flex items-center gap-2">
        <solidIcons.ExclamationCircle className="text-yellow-500" size={15} />
        <p className="text-xs md:text-sm">
          {translate(
            "You can also view online customers in the",
            "يمكنك أيضًا عرض عملاء الإنترنت في",
          )}
          {` `}
          <Link to={`/${paths.admin}/${paths.users}?role=user`} className="text-blue-500 underline">
            {translate("Users Page", "صفحة المستخدمين")}
          </Link>
        </p>
      </div>

      {/* Modals */}
      <CustomerModal
        opened={modalOpened}
        close={closeModal}
        callback={(response) => {
          setPaginatedCustomers((prev) => {
            if (!prev) return null;
            // Upsert, not always-prepend: this modal now stays open after creating a customer (so
            // documents can be attached), so `callback` can fire again for the SAME customer -
            // a naive prepend would insert a duplicate row for every subsequent save/document change.
            const existingIndex = prev.data.findIndex((customer) => customer._id === response._id);
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

function stringifyAddress(customer: Customer) {
  let address = "";
  if (customer.offlineAddress?.country) address += `${customer.offlineAddress.country}`;
  if (customer.offlineAddress?.city) address += `, ${customer.offlineAddress.city}`;
  if (customer.offlineAddress?.street) address += `, ${customer.offlineAddress.street}`;
  return address;
}
