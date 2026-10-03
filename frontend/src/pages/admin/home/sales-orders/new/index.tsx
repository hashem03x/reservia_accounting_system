import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Customer } from "@/types/customer";
import { Project } from "@/types/project";
import { AdvancedPayment } from "@/types/advanced-payment";
import paths from "@/utils/constants/paths";
import { Alert, Button, NumberInput, Select } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import { OrderItemInput } from "./types";
import validation from "./_utils/validation";
import noProductDetails from "./_utils/no-variant-details";
import CustomerWarehouseSection from "./_components/customer-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";
import InfoItem from "@/components/ui/info-item";
import { useEffect } from "react";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import OrderTaxSection from "@/components/global/order-tax-section";

const emptyOrderItem: OrderItemInput = {
  productCode: "",
  productError: false,
  ...noProductDetails,
};

export default function NewSalesOrder() {
  const { language, translate, translations } = useLanguage();

  const title = translate("New Sales Order", "طلب مبيعات جديد");

  useDocumentTitle(`${title} | ${translations.adminPanel}`);

  const navigate = useNavigate();

  const { data: warehouses } = useWarehouses();
  const defatulWarehouseId = warehouses.find((warehouse) => warehouse.isDefault)?._id || warehouses[0]?._id || "";

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(defatulWarehouseId);
  const [items, setItems] = useState<OrderItemInput[]>([emptyOrderItem]);
  const [shippingCost, setShippingCost] = useState<string | number>("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [project, setProject] = useState("");
  const [vatPercentage, setVatPercentage] = useState<string | number>(0);
  const [withholdingTaxPercentage, setWithholdingTaxPercentage] = useState<string | number>(0);

  const totalAmount = items.reduce((acc, item) => acc + item.starterSubtotal, 0);

  const addNewItem = () => setItems((prevItems) => [...prevItems, emptyOrderItem]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const isAdvancedPayment = paymentMethod === "advanced_payment";

  // Available regardless of payment method (docs section "Sales Orders - Add Project Number") -
  // only scoped to the selected customer's own projects (docs section "One Project = One
  // Customer"). Reloaded any time the customer changes, never carried over from a previous one.
  const { privateRequest: fetchProjectsRequest, data: customerProjects, setData: setCustomerProjects } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    setProject("");
    if (!customer) {
      setCustomerProjects([]);
      return;
    }
    fetchProjectsRequest({ url: "projects", params: { customer: customer._id, limit: 100 }, language })
      .then((res) => setCustomerProjects(res.data))
      .catch(() => setCustomerProjects([]));
  }, [customer?._id]);

  // Re-fetched whenever the project (or payment method) changes - never leaves a stale amount
  // attached after the user picks a different project (docs section "Changing Project").
  const {
    privateRequest: fetchAdvanceRequest,
    data: availableAdvance,
    setData: setAvailableAdvance,
    loading: advanceLoading,
  } = useDataHandler<AdvancedPayment | null>({ initialData: null });
  useEffect(() => {
    if (!isAdvancedPayment || !customer || !project) {
      setAvailableAdvance(null);
      return;
    }
    fetchAdvanceRequest({ url: "advanced-payments/available", params: { customer: customer._id, project }, language })
      .then((res) => setAvailableAdvance(res.data))
      .catch(() => setAvailableAdvance(null));
  }, [isAdvancedPayment, customer?._id, project]);

  async function handleSaveOrder(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const filteredItems = items.filter((item) => item.productData);

      const validationError = validation({ customer, warehouse: warehouseId, items: filteredItems }, language);

      if (validationError) {
        setError(validationError);
        return;
      }

      if (isAdvancedPayment) {
        if (!project) {
          setError(translate("A project must be selected to use Advanced Payment.", "يجب اختيار مشروع لاستخدام الدفعة المقدمة."));
          return;
        }
        if (!availableAdvance || availableAdvance.remainingAmount <= 0) {
          setError(translate("No available advanced payment exists for this project.", "لا توجد دفعة مقدمة متاحة لهذا المشروع."));
          return;
        }
      } else if (paymentMethod === "account" && !paymentAccount) {
        setError(translate("A payment account must be selected.", "يجب اختيار حساب الدفع."));
        return;
      }

      const response = await privateRequest({
        language,
        method: "POST",
        url: `sale-orders`,
        data: {
          isPrepaid: false,
          warehouse: warehouseId,
          paymentMethod: paymentMethod || undefined,
          paymentAccount: paymentMethod === "account" ? paymentAccount : undefined,
          project: project || undefined,
          customer: customer?._id,
          items: filteredItems.map((item) => ({
            product: item.productData?._id,
            unitPrice: item.unitPrice,
            itemDiscount: item.itemDiscount,
            starterQuantity: item.starterQuantity,
          })),
          shippingCost: shippingCost ? Number(shippingCost) : undefined,
          vatPercentage,
          withholdingTaxPercentage,
        },
      });

      navigate(`/${paths.admin}/${paths.home}/${paths.salesOrders}/${response.data._id}`);
    });
  }

  return (
    <AdminLayoutBox
      header={{
        title,
        backLink: true,
        border: true,
        sideElements: (
          <Button
            onClick={handleSaveOrder}
            size="md"
            px="xl"
            radius="md"
            loading={loading}
            disabled={
              (isAdvancedPayment && (!project || !availableAdvance || availableAdvance.remainingAmount <= 0)) ||
              (paymentMethod === "account" && !paymentAccount)
            }
          >
            {translate("Save", "حفظ")}
          </Button>
        ),
      }}
    >
      {error && (
        <>
          <ErrorAlert error={error} />
          <hr />
        </>
      )}

      {/* Total Amount */}
      <div className="flex flex-col gap-2">
        <InfoItem
          label={translate("Order Amount", "سعر الطلب")}
          value={`${totalAmount.toFixed(2)} ${translations.currency}`}
        />
        {+shippingCost > 0 && (
          <InfoItem
            label={translate("Total Amount", "المبلغ الإجمالي")}
            value={`${(totalAmount + +shippingCost).toFixed(2)} ${translations.currency}`}
          />
        )}
        {isAdvancedPayment && availableAdvance && availableAdvance.remainingAmount > 0 && (
          <InfoItem
            label={translate("Paid via Advanced Payment (locked)", "مدفوع عبر الدفعة المقدمة (مثبت)")}
            value={`${availableAdvance.remainingAmount.toLocaleString()} ${availableAdvance.currency || translations.currency}`}
          />
        )}
      </div>

      <hr />

      <CustomerWarehouseSection
        customer={customer}
        setCustomer={setCustomer}
        warehouseId={warehouseId}
        setWarehouseId={setWarehouseId}
      />

      <hr />

      {/* Project (always selectable - docs section "Sales Orders - Add Project Number") */}
      <Select
        label={translate("Project (Optional)", "المشروع (اختياري)")}
        placeholder={!customer ? translate("Select a customer first", "اختر عميلاً أولاً") : translate("Select project", "اختر المشروع")}
        value={project || null}
        onChange={(v) => setProject(v || "")}
        data={customerProjects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
        disabled={!customer}
        searchable
        clearable
        style={{ maxWidth: 300 }}
      />
      {customer && customerProjects.length === 0 && (
        <Alert color="yellow" variant="light">
          {translate("This customer has no projects.", "ليس لدى هذا العميل أي مشاريع.")}
        </Alert>
      )}

      <hr />

      {/* Payment Method: a Cash/Cash-Equivalent Chart of Accounts account, or Advanced Payment -
          never a hardcoded list (docs section "Payment Methods Must Come From Chart of Accounts"). */}
      <div className="flex flex-col gap-3">
        <Select
          label={translate("Payment Method (Optional)", "طريقة الدفع (اختياري)")}
          placeholder={translate("Select payment method", "اختر طريقة الدفع")}
          value={paymentMethod || null}
          onChange={(v) => {
            setPaymentMethod(v || "");
            setPaymentAccount("");
          }}
          data={[
            { value: "account", label: translate("Cash / Cash Equivalent Account", "حساب نقدي / ما يعادله") },
            { value: "advanced_payment", label: translate("Advanced Payment", "دفعة مقدمة") },
          ]}
          clearable
          style={{ maxWidth: 300 }}
        />

        {paymentMethod === "account" && (
          <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} required />
        )}

        {isAdvancedPayment && (
          <>
            {!customer && (
              <Alert color="yellow" variant="light">
                {translate("Select a customer first.", "اختر عميلاً أولاً.")}
              </Alert>
            )}

            {project &&
              (advanceLoading ? (
                <p className="text-sm text-gray-400">{translate("Loading available advance...", "جاري تحميل الدفعة المتاحة...")}</p>
              ) : availableAdvance && availableAdvance.remainingAmount > 0 ? (
                <Alert color="green" variant="light">
                  <div className="flex flex-col gap-1">
                    <span>
                      {translate("Available Advanced Payment", "الدفعة المقدمة المتاحة")}: <b>{availableAdvance.remainingAmount.toLocaleString()} {availableAdvance.currency || translations.currency}</b>
                    </span>
                    <span className="text-sm">
                      {translate("Sales Order paid amount will be locked to this value.", "سيتم تثبيت المبلغ المدفوع لطلب البيع على هذه القيمة.")}
                    </span>
                  </div>
                </Alert>
              ) : (
                <Alert color="red" variant="light">
                  {translate("No available advanced payment exists for this project.", "لا توجد دفعة مقدمة متاحة لهذا المشروع.")}
                </Alert>
              ))}
          </>
        )}
      </div>

      <hr />

      <OrderTaxSection
        amount={totalAmount}
        vatPercentage={vatPercentage}
        setVatPercentage={setVatPercentage}
        withholdingTaxPercentage={withholdingTaxPercentage}
        setWithholdingTaxPercentage={setWithholdingTaxPercentage}
      />

      <hr />

      <OrderItemsSection items={items} setItems={setItems} addNewItem={addNewItem} warehouseId={warehouseId} />

      <hr />

      {/* Total Items */}
      <InfoItem
        label={translate("Total Items", "إجمالي القطع")}
        value={items.reduce((acc, item) => acc + (item.starterQuantity || 0), 0).toString()}
      />

      <hr />

      {/* Shipping Cost (Optional) */}
      <NumberInput
        label={translate("Shipping Cost (Optional)", "تكلفة الشحن (اختياري)")}
        placeholder={translate("Enter Shipping Cost", "ادخل تكلفة الشحن")}
        value={shippingCost}
        onChange={setShippingCost}
        min={0}
        max={10000}
        decimalScale={2}
        hideControls
        style={{ maxWidth: 250 }}
      />
    </AdminLayoutBox>
  );
}
