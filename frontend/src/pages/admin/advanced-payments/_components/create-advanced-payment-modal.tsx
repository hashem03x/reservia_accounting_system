import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import CustomerSearch from "@/components/global/customer-search";
import VendorSearch from "@/components/global/vendor-search";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { Customer } from "@/types/customer";
import { Vendor } from "@/types/vendor";
import { AdvancedPayment } from "@/types/advanced-payment";
import { Project } from "@/types/project";

export default function CreateAdvancedPaymentModal({
  opened,
  close,
  onCreated,
}: {
  opened: boolean;
  close: () => void;
  onCreated: (payment: AdvancedPayment) => void;
}) {
  const { translate, language, translations } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [type, setType] = useState<"customer" | "vendor" | "">("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [project, setProject] = useState("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [amount, setAmount] = useState<string | number>("");
  const [currency, setCurrency] = useState(translations.currency);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const { privateRequest: fetchProjectsRequest, data: customerProjects, setData: setCustomerProjects, loading: projectsLoading } = useDataHandler<Project[]>({
    initialData: [],
  });
  // Vendor Advanced Payments are also now required to carry a Project (docs section "Vendor
  // Advanced Payment Project Number") - but unlike Customer advances, a project has no concept of
  // "its vendor" (same reasoning as purchaseOrder.js's identical `project` field comment), so every
  // project is offered here, not scoped down to anything vendor-specific.
  const { privateRequest: fetchVendorProjectsRequest, data: vendorProjects, setData: setVendorProjects, loading: vendorProjectsLoading } = useDataHandler<Project[]>({
    initialData: [],
  });
  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // Only Projects belonging to the selected customer are ever offered - the one customer/one
  // project rule this whole feature depends on (docs section "Project Selection").
  useEffect(() => {
    setProject("");
    if (type !== "customer" || !customer) {
      setCustomerProjects([]);
      return;
    }
    fetchProjectsRequest({ url: "projects", params: { customer: customer._id, limit: 100 }, language })
      .then((res) => setCustomerProjects(res.data))
      .catch(() => setCustomerProjects([]));
  }, [type, customer]);

  useEffect(() => {
    if (type !== "vendor") {
      setVendorProjects([]);
      return;
    }
    fetchVendorProjectsRequest({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setVendorProjects(res.data))
      .catch(() => setVendorProjects([]));
  }, [type]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "advanced-payments",
        data: {
          type,
          customer: type === "customer" ? customer?._id : undefined,
          vendor: type === "vendor" ? vendor?._id : undefined,
          project: type === "customer" || type === "vendor" ? project : undefined,
          amount,
          paymentAccount,
          currency: currency || undefined,
          reference: reference || undefined,
          notes: notes || undefined,
        },
      });

      onCreated(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setType("");
      setCustomer(null);
      setVendor(null);
      setProject("");
      setPaymentAccount("");
      setAmount("");
      setCurrency(translations.currency);
      setReference("");
      setNotes("");
      setError("");
    }, 250);
  }

  const canSubmit =
    type === "customer"
      ? !!customer && !!project && !!amount && !!paymentAccount
      : type === "vendor"
        ? !!vendor && !!project && !!amount && !!paymentAccount
        : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Create Advanced Payment", "إنشاء دفعة مقدمة")} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <Select
          label={translate("Payment Type", "نوع الدفعة")}
          placeholder={translate("Select type", "اختر النوع")}
          value={type}
          onChange={(v) => {
            setType((v as "customer" | "vendor") || "");
            setCustomer(null);
            setVendor(null);
            setProject("");
          }}
          data={[
            { value: "customer", label: translate("Customer", "عميل") },
            { value: "vendor", label: translate("Vendor", "بائع") },
          ]}
          required
        />

        {type === "customer" && (
          <>
            <CustomerSearch customer={customer} setCustomer={setCustomer} label={translate("Customer", "العميل")} placeholder={translate("Search for a customer", "ابحث عن عميل")} required />

            {customer && (
              <Select
                label={translate("Project", "المشروع")}
                placeholder={projectsLoading ? translate("Loading projects...", "جاري تحميل المشاريع...") : translate("Select project", "اختر المشروع")}
                value={project || null}
                onChange={(v) => setProject(v || "")}
                data={customerProjects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
                disabled={projectsLoading}
                nothingFoundMessage={translate("This customer has no projects.", "ليس لدى هذا العميل أي مشاريع.")}
                searchable
                required
              />
            )}
            {customer && !projectsLoading && customerProjects.length === 0 && (
              <p className="-mt-2 text-xs text-red-500">{translate("This customer has no projects.", "ليس لدى هذا العميل أي مشاريع.")}</p>
            )}
          </>
        )}

        {type === "vendor" && (
          <>
            <VendorSearch vendor={vendor} setVendor={setVendor} label={translate("Vendor", "البائع")} placeholder={translate("Search for a vendor", "ابحث عن بائع")} required />

            <Select
              label={translate("Project", "المشروع")}
              placeholder={vendorProjectsLoading ? translate("Loading projects...", "جاري تحميل المشاريع...") : translate("Select project", "اختر المشروع")}
              value={project || null}
              onChange={(v) => setProject(v || "")}
              data={vendorProjects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
              disabled={vendorProjectsLoading}
              searchable
              required
              withAsterisk
            />
          </>
        )}

        <NumberInput
          label={translate("Amount", "المبلغ")}
          placeholder={translate("Enter amount", "أدخل المبلغ")}
          value={amount}
          onChange={setAmount}
          min={0.01}
          decimalScale={2}
          required
        />

        {/* The cash/bank account this advance was received into (customer) or paid from (vendor) -
            loaded from the Chart of Accounts (Cash & Cash Equivalents only), never hardcoded (docs
            section "Advanced Payment Payment Method"). Required - the automatic accounting engine
            needs a real account to post the journal entry against. */}
        <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} required />

        <TextInput label={translate("Currency", "العملة")} value={currency} onChange={(e) => setCurrency(e.target.value)} />

        <TextInput label={translate("Reference (optional)", "المرجع (اختياري)")} value={reference} onChange={(e) => setReference(e.target.value)} />

        <Textarea label={translate("Notes (optional)", "ملاحظات (اختياري)")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />

        <Button type="submit" loading={loading} disabled={!canSubmit} mt="md">
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
