import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Customer } from "@/types/customer";
import { Project } from "@/types/project";
import paths from "@/utils/constants/paths";
import { Alert, Button, Select } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import { OrderItemInput } from "./types";
import validation from "./_utils/validation";
import noProductDetails from "./_utils/no-variant-details";
import CustomerWarehouseSection from "./_components/customer-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";
import InfoItem from "@/components/ui/info-item";
import { useEffect } from "react";
import OrderTaxSection from "@/components/global/order-tax-section";
import { calculateOrderTotals } from "@/utils/helpers/order-totals";

const emptyOrderItem: OrderItemInput = {
  productCode: "",
  productError: false,
  ...noProductDetails,
};

// Creating a Sales Order no longer asks how it is paid, and has no shipping cost: payments
// (including from an Advanced Payment) are recorded afterwards from the order's Payment tab.
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
  const [project, setProject] = useState("");
  const [vatPercentage, setVatPercentage] = useState<string | number>(0);
  const [withholdingTaxPercentage, setWithholdingTaxPercentage] = useState<string | number>(0);

  // Preview only - the backend recomputes every amount on save (utils/orderTotals.js) and never
  // trusts these. `subtotal` is the pre-tax sum of the lines; `orderTotals.total` is the order's
  // Total Amount (subtotal + VAT - withholding), the one figure shown as the order amount.
  const subtotal = items.reduce((acc, item) => acc + (item.starterSubtotal || 0), 0);
  const orderTotals = calculateOrderTotals(subtotal, vatPercentage, withholdingTaxPercentage);

  const addNewItem = () => setItems((prevItems) => [...prevItems, emptyOrderItem]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // Only scoped to the selected customer's own projects (docs section "One Project = One
  // Customer"). Reloaded any time the customer changes, never carried over from a previous one.
  const {
    privateRequest: fetchProjectsRequest,
    data: customerProjects,
    setData: setCustomerProjects,
  } = useDataHandler<Project[]>({ initialData: [] });
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

  async function handleSaveOrder(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    handleRequest(language, setLoading, setError, async () => {
      const filteredItems = items.filter((item) => item.productData);

      const validationError = validation({ customer, warehouse: warehouseId, items: filteredItems }, language);

      if (validationError) {
        setError(validationError);
        return;
      }

      if (!project) {
        setError(translate("A project is required to create a Sales Order.", "يجب اختيار مشروع لإنشاء طلب مبيعات."));
        return;
      }

      const response = await privateRequest({
        language,
        method: "POST",
        url: `sale-orders`,
        data: {
          isPrepaid: false,
          warehouse: warehouseId,
          project,
          customer: customer?._id,
          items: filteredItems.map((item) => ({
            product: item.productData?._id,
            unitPrice: item.unitPrice,
            itemDiscount: item.itemDiscount,
            starterQuantity: item.starterQuantity,
          })),
          // Always explicit numbers - an empty VAT input means "no VAT" (0), never undefined.
          vatPercentage: Number(vatPercentage) || 0,
          withholdingTaxPercentage: Number(withholdingTaxPercentage) || 0,
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
          <Button onClick={handleSaveOrder} size="md" px="xl" radius="md" loading={loading} disabled={!project}>
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

      {/* Order amount = the order's final Total Amount (incl. VAT, net of withholding). */}
      <div className="flex flex-col gap-2">
        <InfoItem
          label={translate("Order Total Amount", "إجمالي مبلغ الطلب")}
          value={`${orderTotals.total.toFixed(2)} ${translations.currency}`}
        />
        {orderTotals.total !== subtotal && (
          <InfoItem label={translate("Subtotal (before tax)", "الإجمالي قبل الضريبة")} value={`${subtotal.toFixed(2)} ${translations.currency}`} />
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

      {/* Project (mandatory - docs section "Sales Orders - Project is Required") */}
      <Select
        label={translate("Project", "المشروع")}
        placeholder={
          !customer ? translate("Select a customer first", "اختر عميلاً أولاً") : translate("Select project", "اختر المشروع")
        }
        value={project || null}
        onChange={(v) => setProject(v || "")}
        data={customerProjects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
        disabled={!customer}
        searchable
        required
        withAsterisk
        style={{ maxWidth: 300 }}
      />
      {customer && customerProjects.length === 0 && (
        <Alert color="yellow" variant="light">
          {translate("This customer has no projects.", "ليس لدى هذا العميل أي مشاريع.")}
        </Alert>
      )}

      <hr />

      <OrderTaxSection
        amount={subtotal}
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
    </AdminLayoutBox>
  );
}
