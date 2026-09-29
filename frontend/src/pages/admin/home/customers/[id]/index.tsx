import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { Customer as CustomerType } from "@/types/customer";
import { SalesOrder } from "@/types/orders";
import { Payment } from "@/types/payment";
import { isCustomer } from "@/utils/constants/roles";
import { getCustomerTypeLabel, isOffline } from "@/utils/constants/customer-types";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Button } from "@mantine/core";
import { outlineIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import CustomerModal from "@/components/global/customer-modal";
import BusinessDocumentsSection from "@/components/global/business-documents-section";
import DeleteCustomerModal from "./_components/delete-customer-modal";
import UpdateBalanceModal from "./_components/update-balance-modal";
import CustomerOrdersHistory from "./_components/customer-orders-history";
import CustomerPaymentsHistory from "./_components/cusomer-payments-history";
import AdminGaurd from "@/components/ui/admin-gaurd";

export default function Customer() {
  const { language, translate, translations } = useLanguage();

  const { id } = useParams<{ id: string }>();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: customer,
    setData: setCustomer,
  } = useDataHandler<CustomerType | null>({ initialData: null, initialLoading: true });

  const [customerSalesOrders, setCustomerSalesOrders] = useState<SalesOrder[]>([]);
  const [customerPayments, setCustomerPayments] = useState<Payment[]>([]);

  useDocumentTitle(`${customer?.name ?? translate("Customer Data", "بيانات العميل")} | ${translations.pages.customers}`);

  function handleLoadCustomer() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const [customerResponse, ordersResponse, paymentsResponse] = await Promise.all([
        privateRequest({ url: `customers/${id}`, signal: controller.signal, language }),
        canIReadSalesOrders &&
          privateRequest({
            url: `sale-orders`,
            params: { customer: id || "", limit: Infinity },
            signal: controller.signal,
            language,
          }),
        canIReadPayments &&
          privateRequest({
            url: `payment`,
            params: { customerId: id || "", limit: Infinity },
            signal: controller.signal,
            language,
          }),
      ]);
      if (customerResponse.data.isDeleted || !isCustomer(customerResponse.data.role))
        setError(translate("This customer does not exist.", "هذا العميل غير موجود."));
      else {
        setCustomer(customerResponse.data);
        setCustomerSalesOrders(ordersResponse.data);
        setCustomerPayments(paymentsResponse.data);
      }
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadCustomer(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, []);

  const canIUpdateCustomers = useHasPermission(resources.customers, actions.update);
  const canIDeleteCustomers = useHasPermission(resources.customers, actions.delete);

  const canIReadSalesOrders = useHasPermission(resources.salesOrders, actions.read);
  const canIReadPayments = useHasPermission(resources.cash, actions.read);

  // ========== Handle Modals ==========

  const [updateModalOpened, { open: openUpdateModal, close: closeUpdateModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  const [balanceModalOpened, { open: openBalanceModal, close: closeBalanceModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Customer Data", "بيانات العميل"),
        backLink: true,
        sideElements: customer && isOffline(customer.type) && (
          <div className="flex gap-2">
            {canIUpdateCustomers && (
              <Button onClick={openUpdateModal} variant="light" radius="md" title={translate("Update", "تحديث")}>
                <outlineIcons.Edit size={18} />
              </Button>
            )}
            {/* Remove `false` to enable deleting */}
            {false && canIDeleteCustomers && (
              <Button onClick={openDeleteModal} variant="light" color="red" radius="md" title={translate("Delete", "حذف")}>
                <outlineIcons.Trash size={18} />
              </Button>
            )}
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading customer data", "جاري تحميل بيانات العميل")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("An error occurred while loading customer data", "حدث خطأ أثناء تحميل بيانات العميل")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadCustomer }}
        />
      ) : (
        customer && (
          <section className="flex flex-1 flex-col gap-4 rounded-xl">
            {/* Customer Header */}
            <header className="flex flex-col gap-3 rounded-md bg-gray-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="text-xs sm:text-sm">
                  {translate("Customer ID", "معرف العميل")}: {customer._id}
                </p>
                <span className="rounded-lg bg-indigo-500 px-2.5 py-1 text-xs font-medium text-indigo-50">
                  {getCustomerTypeLabel(customer.type, language)}
                </span>
              </div>

              {/* Customer Number - server-generated, see docs/entities/customers.md */}
              <div className="flex items-center gap-1">
                <p className="text-sm">{translate("Customer Number", "رقم العميل")}:</p>
                <p className="text-sm font-semibold text-gray-800">{customer.customerNumber ?? "-"}</p>
              </div>

              <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">{customer.name}</h2>

              <AdminGaurd>
                <div className="flex flex-wrap items-center gap-1 font-medium">
                  <p>{translate("Balance Due", "الرصيد المستحق")}:</p>
                  <p className="text-gray-800">
                    {customer.balance.toFixed(2)} {translations.currency}
                  </p>

                  {/* Temporary: Hide the update balance button */}
                  {false && (
                    <>
                      <span></span>
                      <Button
                        onClick={openBalanceModal}
                        variant="light"
                        color="dark"
                        size="xs"
                        radius="md"
                        leftSection={<outlineIcons.Lock />}
                        title={translate("Only admins can update this field.", "يمكن للمسؤولين فقط تحديث هذا الحقل.")}
                      >
                        {translate("Update", "تحديث")}
                      </Button>
                    </>
                  )}
                </div>
              </AdminGaurd>
            </header>

            {/* Contact Info */}
            <section className="flex flex-col gap-[6px] rounded-md bg-gray-100 p-4">
              <h4>{translate("Contact Information", "معلومات الاتصال")}</h4>
              <p>
                {translate("Phone", "الهاتف")}: {customer.phone}
              </p>
              {customer.additionalPhone && (
                <p>
                  {translate("Additional Phone", "رقم هاتف اضافي")}: {customer.additionalPhone}
                </p>
              )}
              {customer.email && (
                <p>
                  {translate("Email", "البريد الإلكتروني")}: {customer.email}
                </p>
              )}
            </section>

            {/* Address */}
            {customer.offlineAddress && (
              <section className="flex flex-col gap-[6px] rounded-md bg-gray-100 p-4">
                <h4>{translate("Address", "العنوان")}</h4>
                {customer.offlineAddress.street && <p>{customer.offlineAddress.street}</p>}
                <p>
                  {customer.offlineAddress.city && customer.offlineAddress.city}{" "}
                  {customer.offlineAddress.postalCode && customer.offlineAddress.postalCode}
                </p>
                {customer.offlineAddress.country && <p>{customer.offlineAddress.country}</p>}
              </section>
            )}

            {/* Tax Info */}
            {(customer.taxInfo?.taxRegistrationNumber || customer.taxInfo?.commercialRegistrationNumber) && (
              <section className="flex flex-col gap-[6px] rounded-md bg-gray-100 p-4">
                <h4>{translate("Tax Info", "البيانات الضريبية")}</h4>
                {customer.taxInfo?.taxRegistrationNumber && (
                  <p>
                    {translate("Tax Registration Number", "الرقم الضريبي")}: {customer.taxInfo.taxRegistrationNumber}
                  </p>
                )}
                {customer.taxInfo?.commercialRegistrationNumber && (
                  <p>
                    {translate("Commercial Registration Number", "رقم السجل التجاري")}:{" "}
                    {customer.taxInfo.commercialRegistrationNumber}
                  </p>
                )}
              </section>
            )}

            {/* Bank Info */}
            {(customer.bankInfo?.bankName || customer.bankInfo?.branch || customer.bankInfo?.accountNumber || customer.bankInfo?.iban) && (
              <section className="flex flex-col gap-[6px] rounded-md bg-gray-100 p-4">
                <h4>{translate("Bank Info", "البيانات البنكية")}</h4>
                {customer.bankInfo?.bankName && (
                  <p>
                    {translate("Bank Name", "إسم البنك")}: {customer.bankInfo.bankName}
                  </p>
                )}
                {customer.bankInfo?.branch && (
                  <p>
                    {translate("Branch", "الفرع")}: {customer.bankInfo.branch}
                  </p>
                )}
                {customer.bankInfo?.accountNumber && (
                  <p>
                    {translate("Account Number", "رقم الحساب")}: {customer.bankInfo.accountNumber}
                  </p>
                )}
                {customer.bankInfo?.iban && (
                  <p>
                    {translate("IBAN", "رقم ال IBAN")}: {customer.bankInfo.iban}
                  </p>
                )}
              </section>
            )}

            {/* Documents - manageable directly from here, not only from the edit modal */}
            <div className="rounded-md bg-gray-100 p-4">
              <BusinessDocumentsSection
                entityType="customers"
                entityId={customer._id}
                documents={customer.documents}
                onChange={(documents) => setCustomer({ ...customer, documents })}
              />
            </div>

            {/* Order History */}
            {canIReadSalesOrders && customerSalesOrders.length > 0 && (
              <div className="rounded-md bg-gray-100 p-4">
                <CustomerOrdersHistory orders={customerSalesOrders} />
              </div>
            )}

            {/* Payments */}
            {canIReadPayments && customerPayments.length > 0 && (
              <div className="rounded-md bg-gray-100 p-4">
                <CustomerPaymentsHistory payments={customerPayments} />
              </div>
            )}
          </section>
        )
      )}

      {/* Modals */}
      {customer && (
        <>
          <CustomerModal
            opened={updateModalOpened}
            close={closeUpdateModal}
            customerToUpdate={customer}
            callback={(response) => setCustomer(response)}
          />
          <DeleteCustomerModal opened={deleteModalOpened} close={closeDeleteModal} customer={customer} />
          <UpdateBalanceModal
            opened={balanceModalOpened}
            close={closeBalanceModal}
            customer={customer}
            setCustomer={setCustomer}
          />
        </>
      )}
    </AdminLayoutBox>
  );
}
