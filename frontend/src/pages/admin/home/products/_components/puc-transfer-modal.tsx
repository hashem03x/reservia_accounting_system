import { useEffect, useRef, useState } from "react";
import { Alert, Button, NumberInput, SegmentedControl, Select, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { toDateOnly } from "@/utils/helpers/format-date";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { PucTransferOptions } from "@/types/puc-transfer";

type ProjectOption = { _id: string; projectNumber: string; name?: string; status?: string };

const newRequestKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * PUC Transfer: move a quantity of this stock product into a project's PUC (Projects Under
 * Construction) - from warehouse stock (its cost leaves Materials Inventory) or from another
 * project's PUC (a reallocation between projects). The server validates the quantity, stock, cost
 * and accounting period, and posts the journal entry; a repeated submission records it once.
 */
export default function PucTransferModal({
  opened,
  close,
  productId,
  productName,
  onDone,
}: {
  opened: boolean;
  close: () => void;
  productId: string;
  productName: string;
  onDone?: () => void;
}) {
  const { language, translate, translations } = useLanguage();
  const [sourceType, setSourceType] = useState<"warehouse" | "project">("warehouse");
  const [warehouse, setWarehouse] = useState("");
  const [sourceProject, setSourceProject] = useState("");
  const [project, setProject] = useState("");
  const [quantity, setQuantity] = useState<string | number>("");
  const [date, setDate] = useState<Date | null>(new Date());
  const [notes, setNotes] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [options, setOptions] = useState<PucTransferOptions | null>(null);
  const requestKey = useRef(newRequestKey());
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!opened) return;
    setError("");
    setSuccess("");
    privateRequest({
      url: "projects",
      params: { limit: 1000, sort: "projectNumber", fields: "projectNumber,name,status" },
      language,
    })
      .then((res) => setProjects((res.data || []).filter((p: ProjectOption) => p.status !== "cancelled")))
      .catch(() => setProjects([]));
  }, [opened]);

  // Stock per warehouse, the cost still in Materials Inventory, and what the source project can give.
  useEffect(() => {
    if (!opened) return;
    privateRequest({
      url: `puc-transfers/product/${productId}/options`,
      params: sourceType === "project" && sourceProject ? { sourceProject } : {},
      language,
    })
      .then((res) => setOptions(res.data))
      .catch(() => setOptions(null));
  }, [opened, productId, sourceType, sourceProject]);

  const qty = typeof quantity === "number" ? quantity : 0;
  const unitCost = options?.product.cost ?? 0;
  const amount = Math.round(qty * unitCost * 100) / 100;
  const stock = options?.warehouses.find((w) => w._id === warehouse)?.quantity ?? null;
  const available = sourceType === "warehouse" ? stock : (options?.sourceProjectQuantity ?? null);
  const overQuantity = available !== null && qty > available;
  const overValue = sourceType === "warehouse" && options !== null && amount > options.materialsInventoryBalance;
  const canSubmit =
    qty > 0 &&
    !!project &&
    !!date &&
    (sourceType === "warehouse" ? !!warehouse : !!sourceProject && sourceProject !== project) &&
    !overQuantity &&
    !overValue;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        method: "POST",
        url: `puc-transfers/product/${productId}`,
        data: {
          quantity: qty,
          project,
          sourceType,
          warehouse: sourceType === "warehouse" ? warehouse : undefined,
          sourceProject: sourceType === "project" ? sourceProject : undefined,
          date: date ? toDateOnly(date) : undefined,
          notes: notes || undefined,
          requestKey: requestKey.current,
        },
        language,
      });
      requestKey.current = newRequestKey();
      setSuccess(translate("PUC transfer recorded and posted.", "تم تسجيل وترحيل تحويل مشروعات تحت التنفيذ."));
      setQuantity("");
      setNotes("");
      onDone?.();
      setTimeout(close, 900);
    });
  }

  const projectData = projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }));
  const money = (n: number) =>
    `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${translations.currency}`;

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={`${translate("PUC Transfer", "تحويل لمشروعات تحت التنفيذ")} - ${productName}`}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <ErrorAlert error={error} />}
        {success && (
          <Alert color="green" variant="light">
            {success}
          </Alert>
        )}
        <SegmentedControl
          value={sourceType}
          onChange={(v) => setSourceType(v as "warehouse" | "project")}
          data={[
            { value: "warehouse", label: translate("From warehouse stock", "من مخزون الفرع") },
            { value: "project", label: translate("From another project", "من مشروع آخر") },
          ]}
          fullWidth
        />
        {sourceType === "warehouse" ? (
          <Select
            label={translate("Warehouse", "الفرع")}
            value={warehouse || null}
            onChange={(v) => setWarehouse(v || "")}
            data={(options?.warehouses || []).map((w) => ({
              value: w._id,
              label: `${w.name || w._id} (${translate("in stock", "متاح")}: ${w.quantity})`,
            }))}
            required
          />
        ) : (
          <Select
            label={translate("Source Project", "المشروع المصدر")}
            value={sourceProject || null}
            onChange={(v) => setSourceProject(v || "")}
            data={projectData}
            description={
              options?.sourceProjectQuantity !== undefined
                ? `${translate("Quantity in this project's PUC", "الكمية في مشروعات تحت التنفيذ لهذا المشروع")}: ${options.sourceProjectQuantity}`
                : undefined
            }
            searchable
            required
          />
        )}
        <Select
          label={translate("Project Number", "رقم المشروع")}
          value={project || null}
          onChange={(v) => setProject(v || "")}
          data={projectData}
          searchable
          required
        />
        <NumberInput
          label={translate("Quantity", "الكمية")}
          value={quantity}
          onChange={setQuantity}
          min={0.001}
          decimalScale={3}
          required
          error={overQuantity ? translate(`Only ${available} available`, `المتاح ${available} فقط`) : undefined}
        />
        <DateInput label={translate("Date", "التاريخ")} value={date} onChange={setDate} valueFormat="YYYY-MM-DD" required />
        <Textarea
          label={translate("Description (optional)", "البيان (اختياري)")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          autosize
          minRows={2}
        />

        <div className="rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p>
            {translate("Unit cost", "تكلفة الوحدة")}:{" "}
            <b className="tabular-nums">{options?.product.cost != null ? money(unitCost) : translate("n/a", "غير متاح")}</b>{" "}
            · {translate("Amount", "القيمة")}: <b className="tabular-nums">{money(amount)}</b>
          </p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {sourceType === "warehouse"
              ? translate(
                  "Posts Dr PUC - Raw Materials (project) / Cr Materials Inventory, and reduces the warehouse stock.",
                  "يرحّل مدين مشروعات تحت التنفيذ - مواد خام (المشروع) / دائن مخزون المواد، ويخفض مخزون الفرع.",
                )
              : translate(
                  "Posts Dr PUC - Raw Materials (destination project) / Cr PUC - Raw Materials (source project). Company PUC is unchanged.",
                  "يرحّل مدين مشروعات تحت التنفيذ - مواد خام (المشروع المستلم) / دائن نفس الحساب (المشروع المصدر). إجمالي الشركة لا يتغير.",
                )}
          </p>
          {overValue && (
            <p className="mt-1 text-xs text-red-600">
              {translate(
                `Only ${money(options!.materialsInventoryBalance)} of materials cost is in Materials Inventory. Stock bought on a project's Purchase Order is already in that project's PUC - transfer it from that project.`,
                `قيمة مخزون المواد ${money(options!.materialsInventoryBalance)} فقط. المخزون المشترى على أمر شراء مشروع موجود بالفعل في مشروعات تحت التنفيذ لذلك المشروع - حوّله من ذلك المشروع.`,
              )}
            </p>
          )}
        </div>

        <Button type="submit" loading={loading} disabled={!canSubmit}>
          {translate("Transfer", "تحويل")}
        </Button>
      </form>
    </Modal>
  );
}
