import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor } from "@/types/vendor";
import { Project } from "@/types/project";
import paths from "@/utils/constants/paths";
import { Button, Select } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import { OrderItemInput } from "./types";
import validation from "./_utils/validation";
import noProductDetails from "./_utils/no-variant-details";
import VendorWarehouseSection from "./_components/vendor-warehouse-section";
import OrderItemsSection from "./_components/order-items-section";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import OrderTaxSection from "@/components/global/order-tax-section";
<<<<<<< HEAD
import { calculateOrderTotals } from "@/utils/helpers/order-totals";
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

const emptyOrderItem: OrderItemInput = {
  productCode: "",
  productError: false,
  ...noProductDetails,
};

export default function NewPurchaseOrder() {
  const { language, translate, translations } = useLanguage();

  const title = translate("New Purchase Order", "طلب مشتريات جديد");

  useDocumentTitle(`${title} | ${translations.adminPanel}`);

  const navigate = useNavigate();

  const { data: warehouses } = useWarehouses();
  const defatulWarehouseId = warehouses.find((warehouse) => warehouse.isDefault)?._id || warehouses[0]?._id || "";

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(defatulWarehouseId);
  const [items, setItems] = useState<OrderItemInput[]>([emptyOrderItem]);
  const [project, setProject] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [vatPercentage, setVatPercentage] = useState<string | number>(0);
  const [withholdingTaxPercentage, setWithholdingTaxPercentage] = useState<string | number>(0);

<<<<<<< HEAD
  // Preview only (the backend recomputes and stores every amount) - same canonical formula.
  const subtotal = items.reduce((acc, item) => acc + (item.starterSubtotal || 0), 0);
  const orderTotals = calculateOrderTotals(subtotal, vatPercentage, withholdingTaxPercentage);
=======
  const totalAmount = items.reduce((acc, item) => acc + item.starterSubtotal, 0);
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

  // No vendor<->project relationship exists in the data model (unlike Sales Order's customer
  // scoping) - every project is offered regardless of the selected vendor (docs section "Purchase
  // Orders - Add Project Number").
  const {
    privateRequest: fetchProjectsRequest,
    data: projects,
    setData: setProjects,
  } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    fetchProjectsRequest({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, []);

  const addNewItem = () => setItems((prevItems) => [...prevItems, emptyOrderItem]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSaveOrder(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const filteredItems = items.filter((item) => item.productData);

      const validationError = validation({ vendor, warehouse: warehouseId, items: filteredItems }, language);

      if (validationError) {
        setError(validationError);
        return;
      }

      if (!project) {
        setError(translate("A project is required to create a Purchase Order.", "يجب اختيار مشروع لإنشاء طلب مشتريات."));
        return;
      }

      if (paymentMethod === "account" && !paymentAccount) {
        setError(translate("A payment account must be selected.", "يجب اختيار حساب الدفع."));
        return;
      }

      const response = await privateRequest({
        language,
        method: "POST",
        url: `purchaseorder`,
        data: {
          warehouseId,
          vendorId: vendor?._id,
          project: project || undefined,
          paymentMethod: paymentMethod || undefined,
          paymentAccount: paymentMethod === "account" ? paymentAccount : undefined,
<<<<<<< HEAD
          vatPercentage: Number(vatPercentage) || 0,
          withholdingTaxPercentage: Number(withholdingTaxPercentage) || 0,
=======
          vatPercentage,
          withholdingTaxPercentage,
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
          items: filteredItems.map((item) => ({
            productId: item.productData?._id,
            unitPrice: item.unitPrice,
            itemDiscount: item.itemDiscount,
            starterQuantity: item.starterQuantity,
          })),
        },
      });

      navigate(`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${response.data._id}`);
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
            disabled={!project || (paymentMethod === "account" && !paymentAccount)}
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
<<<<<<< HEAD
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs md:text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-600">{translate("Order Total Amount", "اجمالى سعر الطلب")}:</span>
          <span className="font-bold text-gray-800">{`${orderTotals.total.toFixed(2)} ${translations.currency}`}</span>
        </div>
        {orderTotals.total !== subtotal && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500">{translate("Subtotal (before tax)", "الإجمالي قبل الضريبة")}:</span>
            <span className="text-gray-700">{`${subtotal.toFixed(2)} ${translations.currency}`}</span>
          </div>
        )}
=======
      <div className="flex items-center gap-1.5 text-xs md:text-sm">
        <span className="text-gray-600">{translate("Order Total Amount", "اجمالى سعر الطلب")}:</span>
        <span className="font-bold text-gray-800">{`${totalAmount.toFixed(2)} ${translations.currency}`}</span>
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
      </div>

      <hr />

      <VendorWarehouseSection
        vendor={vendor}
        setVendor={setVendor}
        warehouseId={warehouseId}
        setWarehouseId={setWarehouseId}
      />

      <hr />

      {/* Project (mandatory - docs section "Purchase Orders - Project is Required") */}
      <Select
        label={translate("Project", "المشروع")}
        placeholder={translate("Select project", "اختر المشروع")}
        value={project || null}
        onChange={(v) => setProject(v || "")}
        data={projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
        searchable
        required
        withAsterisk
        style={{ maxWidth: 300 }}
      />

      <hr />

      {/* Payment Method - a Cash/Cash-Equivalent Chart of Accounts account, never a hardcoded list
          (docs section "Payment Methods Must Come From Chart of Accounts"). */}
      <div className="flex flex-col gap-3">
        <Select
          label={translate("Payment Method (Optional)", "طريقة الدفع (اختياري)")}
          placeholder={translate("Select payment method", "اختر طريقة الدفع")}
          value={paymentMethod || null}
          onChange={(v) => {
            setPaymentMethod(v || "");
            setPaymentAccount("");
          }}
          data={[{ value: "account", label: translate("Cash / Cash Equivalent Account", "حساب نقدي / ما يعادله") }]}
          clearable
          style={{ maxWidth: 300 }}
        />
        {paymentMethod === "account" && (
          <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} required />
        )}
      </div>

      <hr />

      <OrderTaxSection
<<<<<<< HEAD
        amount={subtotal}
=======
        amount={totalAmount}
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        vatPercentage={vatPercentage}
        setVatPercentage={setVatPercentage}
        withholdingTaxPercentage={withholdingTaxPercentage}
        setWithholdingTaxPercentage={setWithholdingTaxPercentage}
      />

      <hr />

      <OrderItemsSection items={items} setItems={setItems} addNewItem={addNewItem} />
    </AdminLayoutBox>
  );
}
