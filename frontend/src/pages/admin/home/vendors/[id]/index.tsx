import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import { Vendor as VendorType } from "@/types/vendor";
import { PurchaseOrder } from "@/types/orders";
import { Payment } from "@/types/payment";
import handleRequest from "@/utils/helpers/handle-request";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { getVendorTypeLabel } from "@/utils/constants/vendor-types";
import { outlineIcons } from "@/components/icons";
import { Button } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import VendorModal from "@/components/global/vendor-modal";
import BusinessDocumentsSection from "@/components/global/business-documents-section";
import DeleteVendorModal from "./_components/delete-vendor-modal";
import UpdateBalanceModal from "./_components/update-balance-modal";
import VendorOrdersHistory from "./_components/vendor-orders-history";
import VendorPaymentsHistory from "./_components/vendor-payments-history";
import AdminGaurd from "@/components/ui/admin-gaurd";

export default function Vendor() {
  const { language, translate, translations } = useLanguage();

  const { id } = useParams<{ id: string }>();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: vendor,
    setData: setVendor,
  } = useDataHandler<VendorType | null>({ initialData: null, initialLoading: true });

  const [vendorPurchaseOrders, setVendorPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [vendorPayments, setVendorPayments] = useState<Payment[]>([]);

  useDocumentTitle(`${vendor?.name ?? translate("Vendor Data", "بيانات البائع")} | ${translations.pages.vendors}`);

  function handleLoadVendor() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const [vendorResponse, ordersResponse, paymentsResponse] = await Promise.all([
        privateRequest({ url: `vendors/${id}`, signal: controller.signal, language }),
        canIReadPurchaseOrders &&
          privateRequest({
            url: `purchaseOrder`,
            params: { vendorId: id || "", limit: Infinity },
            signal: controller.signal,
            language,
          }),
        canIReadPayments &&
          privateRequest({
            url: `payment`,
            params: { vendorId: id || "", limit: Infinity },
            signal: controller.signal,
            language,
          }),
      ]);
      if (vendorResponse.data.isDeleted) setError(translate("This vendor does not exist.", "هذا البائع غير موجود."));
      else {
        setVendor(vendorResponse.data);
        setVendorPurchaseOrders(ordersResponse.data);
        setVendorPayments(paymentsResponse.data);
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
    const cancelRequest = handleLoadVendor(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, []);

  const canIUpdateVendors = useHasPermission(resources.vendors, actions.update);
  const canIDeleteVendors = useHasPermission(resources.vendors, actions.delete);

  const canIReadPurchaseOrders = useHasPermission(resources.purchaseOrders, actions.read);
  const canIReadPayments = useHasPermission(resources.cash, actions.read);

  // ========== Handle Modals ==========

  const [updateModalOpened, { open: openUpdateModal, close: closeUpdateModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  const [balanceModalOpened, { open: openBalanceModal, close: closeBalanceModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Vendor Data", "بيانات البائع"),
        backLink: true,
        sideElements: vendor && (
          <div className="flex gap-2">
            {canIUpdateVendors && (
              <Button onClick={openUpdateModal} variant="light" radius="md" title={translate("Update", "تحديث")}>
                <outlineIcons.Edit size={18} />
              </Button>
            )}
            {/* Remove `false` to enable deleting */}
            {false && canIDeleteVendors && (
              <Button onClick={openDeleteModal} variant="light" color="red" radius="md" title={translate("Delete", "حذف")}>
                <outlineIcons.Trash size={18} />
              </Button>
            )}
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading vendor data", "جاري تحميل بيانات البائع")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("An error occurred while loading vendor data", "حدث خطأ أثناء تحميل بيانات البائع")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadVendor }}
        />
      ) : (
        vendor && (
          <section className="flex flex-1 flex-col gap-4 rounded-xl">
            {/* Vendor Header */}
            <header className="flex flex-col gap-3 rounded-md bg-gray-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="text-xs sm:text-sm">
                  {translate("Vendor ID", "معرف البائع")}: {vendor._id}
                </p>
                <span className="rounded-lg bg-indigo-500 px-2.5 py-1 text-xs font-medium text-indigo-50">
                  {getVendorTypeLabel(vendor.type, language)}
                </span>
              </div>

              <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">{vendor.name}</h2>

              <AdminGaurd>
                <div className="flex flex-wrap items-center gap-1 font-medium">
                  <p>{translate("Balance Due", "الرصيد المستحق")}:</p>
                  <p className="text-gray-800">
                    {vendor.balance.toFixed(2)} {translations.currency}
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
                {translate("Phone", "الهاتف")}: {vendor.contact.phone}
              </p>
              {vendor.contact.email && (
                <p>
                  {translate("Email", "البريد الإلكتروني")}: {vendor.contact.email}
                </p>
              )}
            </section>

            {/* Address */}
            {vendor.address && (
              <section className="flex flex-col gap-[6px] rounded-md bg-gray-100 p-4">
                <h4>{translate("Address", "العنوان")}</h4>
                {vendor.address.street && <p>{vendor.address.street}</p>}
                <p>
                  {vendor.address.city && vendor.address.city} {vendor.address.postalCode && vendor.address.postalCode}
                </p>
                {vendor.address.country && <p>{vendor.address.country}</p>}
              </section>
            )}

            {/* Tax Info */}
            {(vendor.taxInfo?.taxRegistrationNumber || vendor.taxInfo?.commercialRegistrationNumber) && (
              <section className="flex flex-col gap-[6px] rounded-md bg-gray-100 p-4">
                <h4>{translate("Tax Info", "البيانات الضريبية")}</h4>
                {vendor.taxInfo?.taxRegistrationNumber && (
                  <p>
                    {translate("Tax Registration Number", "الرقم الضريبي")}: {vendor.taxInfo.taxRegistrationNumber}
                  </p>
                )}
                {vendor.taxInfo?.commercialRegistrationNumber && (
                  <p>
                    {translate("Commercial Registration Number", "رقم السجل التجاري")}:{" "}
                    {vendor.taxInfo.commercialRegistrationNumber}
                  </p>
                )}
              </section>
            )}

            {/* Bank Info */}
            {(vendor.bankInfo?.bankName || vendor.bankInfo?.branch || vendor.bankInfo?.accountNumber || vendor.bankInfo?.iban || vendor.bankInfo?.swiftCode) && (
              <section className="flex flex-col gap-[6px] rounded-md bg-gray-100 p-4">
                <h4>{translate("Bank Info", "البيانات البنكية")}</h4>
                {vendor.bankInfo?.bankName && (
                  <p>
                    {translate("Bank Name", "إسم البنك")}: {vendor.bankInfo.bankName}
                  </p>
                )}
                {vendor.bankInfo?.branch && (
                  <p>
                    {translate("Branch", "الفرع")}: {vendor.bankInfo.branch}
                  </p>
                )}
                {vendor.bankInfo?.accountNumber && (
                  <p>
                    {translate("Account Number", "رقم الحساب")}: {vendor.bankInfo.accountNumber}
                  </p>
                )}
                {vendor.bankInfo?.iban && (
                  <p>
                    {translate("IBAN", "رقم الآيبان (IBAN)")}: {vendor.bankInfo.iban}
                  </p>
                )}
                {vendor.bankInfo?.swiftCode && (
                  <p>
                    {translate("SWIFT Code", "رمز السويفت (SWIFT)")}: {vendor.bankInfo.swiftCode}
                  </p>
                )}
              </section>
            )}

            {/* Documents - manageable directly from here, not only from the edit modal */}
            <div className="rounded-md bg-gray-100 p-4">
              <BusinessDocumentsSection
                entityType="vendors"
                entityId={vendor._id}
                documents={vendor.documents}
                onChange={(documents) => setVendor({ ...vendor, documents })}
              />
            </div>

            {/* Order History */}
            {canIReadPurchaseOrders && vendorPurchaseOrders.length > 0 && (
              <div className="rounded-md bg-gray-100 p-4">
                <VendorOrdersHistory orders={vendorPurchaseOrders} />
              </div>
            )}

            {/* Payments */}
            {canIReadPayments && vendorPayments.length > 0 && (
              <div className="rounded-md bg-gray-100 p-4">
                <VendorPaymentsHistory payments={vendorPayments} />
              </div>
            )}
          </section>
        )
      )}

      {/* Modals */}
      {vendor && (
        <>
          <VendorModal
            opened={updateModalOpened}
            close={closeUpdateModal}
            vendorToUpdate={vendor}
            callback={(response) => setVendor(response)}
          />
          <DeleteVendorModal opened={deleteModalOpened} close={closeDeleteModal} vendor={vendor} />
          <UpdateBalanceModal opened={balanceModalOpened} close={closeBalanceModal} vendor={vendor} setVendor={setVendor} />
        </>
      )}
    </AdminLayoutBox>
  );
}
