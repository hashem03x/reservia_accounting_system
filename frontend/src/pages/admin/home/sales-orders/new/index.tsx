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
import { SalesOrderPaymentMethods } from "@/utils/constants/accounting";

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
  const [project, setProject] = useState("");

  const totalAmount = items.reduce((acc, item) => acc + item.starterSubtotal, 0);

  const addNewItem = () => setItems((prevItems) => [...prevItems, emptyOrderItem]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const isAdvancedPayment = paymentMethod === "advanced_payment";

  // Only Projects belonging to the selected customer are ever offered (docs section "One Project =
  // One Customer") - reloaded any time the customer changes, never carried over from a previous
  // selection.
  const { privateRequest: fetchProjectsRequest, data: customerProjects, setData: setCustomerProjects } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    setProject("");
    if (!isAdvancedPayment || !customer) {
      setCustomerProjects([]);
      return;
    }
    fetchProjectsRequest({ url: "projects", params: { customer: customer._id, limit: 100 }, language })
      .then((res) => setCustomerProjects(res.data))
      .catch(() => setCustomerProjects([]));
  }, [isAdvancedPayment, customer?._id]);

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
      }

      const response = await privateRequest({
        language,
        method: "POST",
        url: `sale-orders`,
        data: {
          isPrepaid: false,
          warehouse: warehouseId,
          paymentMethod: paymentMethod || undefined,
          project: isAdvancedPayment ? project : undefined,
          customer: customer?._id,
          items: filteredItems.map((item) => ({
            product: item.productData?._id,
            unitPrice: item.unitPrice,
            itemDiscount: item.itemDiscount,
            starterQuantity: item.starterQuantity,
          })),
          shippingCost: shippingCost ? Number(shippingCost) : undefined,
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
            disabled={isAdvancedPayment && (!project || !availableAdvance || availableAdvance.remainingAmount <= 0)}
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

      {/* Payment Method / Advanced Payment */}
      <div className="flex flex-col gap-3">
        <Select
          label={translate("Payment Method (Optional)", "طريقة الدفع (اختياري)")}
          placeholder={translate("Select payment method", "اختر طريقة الدفع")}
          value={paymentMethod || null}
          onChange={(v) => setPaymentMethod(v || "")}
          data={SalesOrderPaymentMethods.map((m) => ({ value: m, label: m === "advanced_payment" ? translate("Advanced Payment", "دفعة مقدمة") : m }))}
          clearable
          style={{ maxWidth: 300 }}
        />

        {isAdvancedPayment && (
          <>
            <Select
              label={translate("Project", "المشروع")}
              placeholder={!customer ? translate("Select a customer first", "اختر عميلاً أولاً") : translate("Select project", "اختر المشروع")}
              value={project || null}
              onChange={(v) => setProject(v || "")}
              data={customerProjects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
              disabled={!customer}
              searchable
              style={{ maxWidth: 300 }}
            />

            {customer && customerProjects.length === 0 && (
              <Alert color="yellow" variant="light">
                {translate("This customer has no projects.", "ليس لدى هذا العميل أي مشاريع.")}
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
