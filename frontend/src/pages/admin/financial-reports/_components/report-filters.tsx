import { useEffect, useState } from "react";
import { NumberInput, Select, Switch, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useSectors from "@/hooks/useSectors";
import CustomerSearch from "@/components/global/customer-search";
import VendorSearch from "@/components/global/vendor-search";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { toDateOnly } from "@/utils/helpers/format-date";
import { Customer } from "@/types/customer";
import { Vendor } from "@/types/vendor";
import { ChartOfAccountRef } from "@/types/orders";
import { ReportFilterName } from "@/types/accounting-report";

export type FilterValues = Record<string, string>;

// "YYYY-MM-DD" <-> the date picker's local Date (the picked calendar day, no time-zone shift).
const toDate = (value?: string) => (value ? new Date(`${value}T00:00:00`) : null);
const fromDate = (date: Date | null) => (date ? toDateOnly(date) : "");

/** The filter controls a report declares (backend catalog) - nothing else is shown. */
export default function ReportFilters({ reportKey, filters, values, onChange }: { reportKey: string; filters: ReportFilterName[]; values: FilterValues; onChange: (values: FilterValues) => void }) {
  const { language, translate } = useLanguage();
  const set = (key: string, value: string) => onChange({ ...values, [key]: value });
  const has = (name: ReportFilterName) => filters.includes(name);

  // The pickers hold the chosen record; the filter value is its id. Only an actual pick changes the
  // filter, so a customer/supplier id restored from the URL is kept.
  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [vendor, setVendorState] = useState<Vendor | null>(null);
  const setCustomer: React.Dispatch<React.SetStateAction<Customer | null>> = (next) => {
    const value = typeof next === "function" ? next(customer) : next;
    setCustomerState(value);
    set("customer", value?._id || "");
  };
  const setVendor: React.Dispatch<React.SetStateAction<Vendor | null>> = (next) => {
    const value = typeof next === "function" ? next(vendor) : next;
    setVendorState(value);
    set("vendor", value?._id || "");
  };

  const { sectors } = useSectors();
  const { privateRequest: loadProjects, data: projects, setData: setProjects } = useDataHandler<{ _id: string; projectNumber: string; name?: string }[]>({ initialData: [] });
  const { privateRequest: loadExpenseAccounts, data: expenseAccounts, setData: setExpenseAccounts } = useDataHandler<ChartOfAccountRef[]>({ initialData: [] });
  // Tax accounts found in the Chart of Accounts, each with the tax reports it belongs to.
  const { privateRequest: loadTaxAccounts, data: taxAccounts, setData: setTaxAccounts } = useDataHandler<(ChartOfAccountRef & { reports: string[] })[]>({ initialData: [] });
  const filterKey = filters.join(",");
  useEffect(() => {
    if (has("project")) {
      loadProjects({ url: "projects", params: { limit: 1000, sort: "projectNumber", fields: "projectNumber,name" }, language })
        .then((res) => setProjects(res.data || []))
        .catch(() => setProjects([]));
    }
    if (has("expenseAccount")) {
      loadExpenseAccounts({ url: "expenses/account-options", language })
        .then((res) => setExpenseAccounts(res.data || []))
        .catch(() => setExpenseAccounts([]));
    }
    if (has("taxAccount")) {
      loadTaxAccounts({ url: "accounting-reports/tax-accounts", language })
        .then((res) => setTaxAccounts(res.data || []))
        .catch(() => setTaxAccounts([]));
    }
  }, [filterKey]);

  const options = (list: [string, string, string][]) => list.map(([value, en, ar]) => ({ value, label: translate(en, ar) }));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {has("period") && (
        <>
          <DateInput label={translate("From", "من")} value={toDate(values.from)} onChange={(d) => set("from", fromDate(d))} valueFormat="YYYY-MM-DD" required />
          <DateInput label={translate("To", "إلى")} value={toDate(values.to)} onChange={(d) => set("to", fromDate(d))} valueFormat="YYYY-MM-DD" required />
        </>
      )}
      {has("asOf") && <DateInput label={translate("As of", "في تاريخ")} value={toDate(values.asOf)} onChange={(d) => set("asOf", fromDate(d))} valueFormat="YYYY-MM-DD" required />}
      {has("customer") && <CustomerSearch customer={customer} setCustomer={setCustomer} label={translate("Customer", "العميل")} placeholder={translate("All customers", "كل العملاء")} />}
      {has("vendor") && <VendorSearch vendor={vendor} setVendor={setVendor} label={translate("Supplier", "المورد")} placeholder={translate("All suppliers", "كل الموردين")} />}
      {has("project") && (
        <Select
          label={translate("Project", "المشروع")}
          placeholder={translate("All projects", "كل المشروعات")}
          value={values.project || null}
          onChange={(v) => set("project", v || "")}
          data={projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
          searchable
          clearable
        />
      )}
      {has("sector") && (
        <Select
          label={translate("Sector", "السيكتور")}
          placeholder={translate("All sectors", "كل السيكتورات")}
          value={values.sector || null}
          onChange={(v) => set("sector", v || "")}
          data={[...sectors.map((s) => ({ value: s.name, label: s.isActive === false ? `${s.name} (${translate("inactive", "غير نشط")})` : s.name })), { value: "__none__", label: translate("No sector", "بدون سيكتور") }]}
          searchable
          clearable
        />
      )}
      {has("projectStatus") && (
        <Select
          label={translate("Project Status", "حالة المشروع")}
          placeholder={translate("All", "الكل")}
          value={values.projectStatus || null}
          onChange={(v) => set("projectStatus", v || "")}
          data={options([
            ["active", "Active", "نشط"],
            ["completed", "Completed", "مكتمل"],
            ["on_hold", "On Hold", "متوقف"],
            ["cancelled", "Cancelled", "ملغي"],
          ])}
          clearable
        />
      )}
      {has("cashAccount") && <PaymentAccountSelect value={values.account || ""} onChange={(v) => set("account", v)} label={translate("Bank / Cash Account", "حساب البنك / النقدية")} clearable />}
      {has("expenseAccount") && (
        <Select
          label={translate("Expense Account", "حساب المصروف")}
          placeholder={translate("All accounts", "كل الحسابات")}
          value={values.account || null}
          onChange={(v) => set("account", v || "")}
          data={expenseAccounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          searchable
          clearable
        />
      )}
      {has("expenseType") && (
        <Select
          label={translate("Accounts", "الحسابات")}
          value={values.expenseType || "expense"}
          onChange={(v) => set("expenseType", v || "expense")}
          data={options([
            ["expense", "Expenses", "المصروفات"],
            ["cogs", "Cost of sales", "تكلفة المبيعات"],
            ["all", "Expenses + cost of sales", "المصروفات + تكلفة المبيعات"],
          ])}
        />
      )}
      {has("orderStatus") && (
        <Select
          label={translate("Order Status", "حالة الأمر")}
          placeholder={translate("All", "الكل")}
          value={values.orderStatus || null}
          onChange={(v) => set("orderStatus", v || "")}
          data={options([
            ["pending", "Pending", "قيد التنفيذ"],
            ["delivered", "Delivered", "تم التسليم"],
            ["canceled", "Canceled", "ملغي"],
          ])}
          clearable
        />
      )}
      {has("paymentStatus") && (
        <Select
          label={translate("Payment Status", "حالة الدفع")}
          placeholder={translate("All", "الكل")}
          value={values.paymentStatus || null}
          onChange={(v) => set("paymentStatus", v || "")}
          data={options([
            ["unpaid", "Unpaid", "غير مدفوع"],
            ["partial", "Partially paid", "مدفوع جزئياً"],
            ["paid", "Paid", "مدفوع"],
          ])}
          clearable
        />
      )}
      {has("assetStatus") && (
        <Select
          label={translate("Asset Status", "حالة الأصل")}
          placeholder={translate("All", "الكل")}
          value={values.assetStatus || null}
          onChange={(v) => set("assetStatus", v || "")}
          data={options([
            ["active", "Active", "نشط"],
            ["fully_depreciated", "Fully depreciated", "مهلك بالكامل"],
            ["under_maintenance", "Under maintenance", "تحت الصيانة"],
            ["disposed", "Disposed", "مستبعد"],
          ])}
          clearable
        />
      )}
      {has("assetClass") && (
        <Select
          label={translate("Asset Type", "نوع الأصل")}
          placeholder={translate("All", "الكل")}
          value={values.assetClass || null}
          onChange={(v) => set("assetClass", v || "")}
          data={options([
            ["tangible", "Tangible", "ملموس"],
            ["intangible", "Intangible", "غير ملموس"],
          ])}
          clearable
        />
      )}
      {has("termDays") && (
        <NumberInput
          label={translate("Credit terms (days)", "مدة الائتمان (أيام)")}
          description={translate("Due date = posting date + terms", "تاريخ الاستحقاق = تاريخ القيد + المدة")}
          value={values.termDays === undefined || values.termDays === "" ? 0 : Number(values.termDays)}
          onChange={(v) => set("termDays", v === "" ? "" : String(v))}
          min={0}
          max={3650}
          allowDecimal={false}
        />
      )}
      {has("taxAccount") && (
        <Select
          label={translate("Tax Account", "حساب الضريبة")}
          placeholder={translate("All tax accounts", "كل حسابات الضريبة")}
          value={values.account || null}
          onChange={(v) => set("account", v || "")}
          data={taxAccounts.filter((a) => a.reports.includes(reportKey)).map((a) => ({ value: a._id, label: `${a.code} - ${(language === "ar-EG" && a.nameAr) || a.name}` }))}
          searchable
          clearable
        />
      )}
      {has("taxMovement") && (
        <Select
          label={translate("Movement Type", "نوع الحركة")}
          placeholder={translate("All", "الكل")}
          value={values.movement || null}
          onChange={(v) => set("movement", v || "")}
          data={options([
            ["invoice", "Tax on a document", "ضريبة على مستند"],
            ["reversal", "Reversal", "قيد عكسي"],
            ["payment", "Payment / refund", "سداد / استرداد"],
            ["offset", "Settlement between tax accounts", "تسوية بين حسابات الضرائب"],
            ["adjustment", "Manual entry / adjustment", "قيد يدوي / تسوية"],
          ])}
          clearable
        />
      )}
      {has("taxSource") && (
        <Select
          label={translate("Source Document", "نوع المستند")}
          placeholder={translate("All", "الكل")}
          value={values.source || null}
          onChange={(v) => set("source", v || "")}
          data={options([
            ["SO", "Sales Order", "أمر بيع"],
            ["PO", "Purchase Order", "أمر شراء"],
            ["EXPENSE", "Expense", "مصروف"],
            ["FIXED_ASSET", "Fixed Asset", "أصل ثابت"],
            ["MANUAL", "Manual journal entry", "قيد يدوي"],
            ["OTHER", "Other automatic entry", "قيد آلي آخر"],
          ])}
          clearable
        />
      )}
      {has("taxReference") && (
        <TextInput
          label={translate("Document / invoice / tax reg. no.", "رقم المستند / الفاتورة / التسجيل الضريبي")}
          placeholder={translate("Search", "بحث")}
          value={values.reference || ""}
          onChange={(e) => set("reference", e.currentTarget.value)}
          maxLength={100}
        />
      )}
      {(has("byProject") || has("includeZero")) && (
        <div className="flex flex-col justify-end gap-2 pb-1">
          {has("byProject") && <Switch label={translate("Break down by project", "تفصيل حسب المشروع")} checked={values.byProject === "true"} onChange={(e) => set("byProject", e.currentTarget.checked ? "true" : "")} />}
          {has("includeZero") && <Switch label={translate("Include accounts without balances", "إظهار الحسابات بدون أرصدة")} checked={values.includeZero === "true"} onChange={(e) => set("includeZero", e.currentTarget.checked ? "true" : "")} />}
        </div>
      )}
    </div>
  );
}
