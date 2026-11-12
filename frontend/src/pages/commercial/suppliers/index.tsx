import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Select, Table, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import paths from "@/utils/constants/paths";
import { EDIT_ROLES, STATUS_COLOR, SUPPLIER_STATUSES, Supplier } from "./types";

// Deal Engine C18 - the approved supplier list. Procurement proposes a supplier (Candidate); the MD
// approves it. Only Approved suppliers price a BOQ normally; Conditional ones only as a flagged fallback.
export default function SuppliersPage() {
  const { translate, language } = useLanguage();
  const navigate = useNavigate();
  const { systems } = useSystemAccess();
  const canEdit = EDIT_ROLES.includes(systems?.COMMERCIAL?.role || "");
  useDocumentTitle(`${translate("Suppliers", "الموردون")} | Reservia Deal Engine`);
  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<Supplier[]>({ initialData: [], initialLoading: true });
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [opened, { open, close }] = useDisclosure();
  const [form, setForm] = useState({ legalName: "", tradeName: "", country: "Egypt", city: "" });
  const create = useDataHandler({ initialData: null });

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "commercial/suppliers", params: { ...(status ? { status } : {}), ...(q ? { q } : {}) }, language });
      setData(res.data as Supplier[]);
    });
  }
  useEffect(load, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  function submit() {
    handleRequest(language, create.setLoading, create.setError, async () => {
      const res = await create.privateRequest({ url: "commercial/suppliers", method: "POST", data: form, language });
      close();
      navigate(`/${paths.commercial}/${paths.commercialSuppliers}/${(res.data as Supplier)._id}`);
    });
  }

  return (
    <AdminLayoutBox
      header={{
        title: translate("Approved supplier list", "قائمة الموردين المعتمدين"),
        subTitle: translate("Procurement proposes, the MD approves. Only Approved and Conditional suppliers can price a BOQ.", "المشتريات تقترح والمدير العام يعتمد. يسعّر جدول الكميات من الموردين المعتمدين والمشروطين فقط."),
        sideElements: canEdit && (
          <Button color="teal" onClick={open} data-testid="supplier-new">
            {translate("Add supplier", "إضافة مورد")}
          </Button>
        ),
      }}
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Select placeholder={translate("All statuses", "كل الحالات")} data={SUPPLIER_STATUSES} value={status || null} onChange={(v) => setStatus(v || "")} clearable className="w-[180px]" />
        <TextInput placeholder={translate("Search name or code", "بحث بالاسم أو الكود")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="w-[240px]" />
        <Button variant="light" onClick={load}>
          {translate("Search", "بحث")}
        </Button>
      </div>
      {loading ? (
        <LoadingSection />
      ) : error ? (
        <ErrorSection errorTitle={translate("Could not load suppliers", "تعذر تحميل الموردين")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : !data.length ? (
        <EmptySection useDefaultImg message={translate("No suppliers yet.", "لا يوجد موردون بعد.")} />
      ) : (
        <div className="overflow-x-auto">
          <Table striped highlightOnHover miw={760} data-testid="suppliers-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Code", "الكود")}</Table.Th>
                <Table.Th>{translate("Supplier", "المورد")}</Table.Th>
                <Table.Th>{translate("Location", "الموقع")}</Table.Th>
                <Table.Th>{translate("Categories", "الفئات")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th>{translate("Review", "المراجعة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((s) => (
                <Table.Tr key={s._id} className="cursor-pointer" onClick={() => navigate(`/${paths.commercial}/${paths.commercialSuppliers}/${s._id}`)}>
                  <Table.Td className="font-mono">{s.code}</Table.Td>
                  <Table.Td>
                    <div className="font-medium">{s.legalName}</div>
                    {s.tradeName && <div className="text-xs text-gray-500">{s.tradeName}</div>}
                  </Table.Td>
                  <Table.Td>{[s.city, s.country].filter(Boolean).join(", ")}</Table.Td>
                  <Table.Td className="text-xs">{s.categories.join(", ") || "-"}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[s.status]} variant="light">
                      {s.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{s.reviewFlags.length ? <Badge color="red" variant="light">{s.reviewFlags.length} {translate("flag(s)", "تنبيه")}</Badge> : <span className="text-xs text-gray-400">-</span>}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}

      <Modal opened={opened} onClose={close} title={translate("Add supplier (Candidate)", "إضافة مورد (مرشح)")} size="md">
        <div className="flex flex-col gap-3">
          <TextInput label={translate("Legal name", "الاسم القانوني")} required value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} data-testid="supplier-legal-name" />
          <TextInput label={translate("Trade name", "الاسم التجاري")} value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label={translate("Country", "الدولة")} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            <TextInput label={translate("City", "المدينة")} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <Button color="teal" onClick={submit} loading={create.loading} disabled={!form.legalName.trim()} data-testid="supplier-create">
            {translate("Add as Candidate", "إضافة كمرشح")}
          </Button>
          {create.error && <ErrorAlert error={create.error} />}
        </div>
      </Modal>
    </AdminLayoutBox>
  );
}
