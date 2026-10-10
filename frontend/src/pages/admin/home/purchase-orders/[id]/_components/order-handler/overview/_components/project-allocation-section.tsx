import { useEffect } from "react";
import { Alert, Badge, Button, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import JournalEntryLink from "@/components/global/journal-entry-link";
import ErrorAlert from "@/components/ui/error-alert";
import { PurchaseOrderAllocation } from "@/types/purchase-order-extras";
import { useOrder } from "../../../../context";

/**
 * Quantities of each line: ordered, received, returned, allocated to the order's project and still
 * unallocated. Received stock lines are allocated automatically when the order is created; an order
 * created before that (or after a failure) can be allocated here - safely, never twice.
 */
export default function ProjectAllocationSection() {
  const { language, translate } = useLanguage();
  const { order } = useOrder();
  const canAllocate = useHasPermission(resources.purchaseOrders, actions.update);
  const { privateRequest, loading, setLoading, error, setError, data, setData } =
    useDataHandler<PurchaseOrderAllocation | null>({ initialData: null, initialLoading: true });
  const {
    privateRequest: allocate,
    loading: allocating,
    setLoading: setAllocating,
    error: allocateError,
    setError: setAllocateError,
  } = useDataHandler({ initialData: null });

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `purchaseOrder/${order._id}/project-allocation`, language });
      setData(res.data);
    });
  }
  useEffect(() => {
    load();
  }, [order._id, order.items?.map((i) => i.returnedQuantity).join(",")]);

  function runAllocation() {
    handleRequest(language, setAllocating, setAllocateError, async () => {
      const res = await allocate({ method: "POST", url: `purchaseOrder/${order._id}/project-allocation`, language });
      setData(res.data);
    });
  }

  const pending = data?.lines.some((l) => l.unallocated > 0) ?? false;
  const name = (l: PurchaseOrderAllocation["lines"][number]) =>
    (language === "ar-EG" ? l.product?.title?.ar : l.product?.title?.en) || l.product?.title?.en || "-";

  return (
    <section className="flex flex-col gap-2" data-tour="po-project-allocation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4>{translate("Project Allocation", "التخصيص للمشروع")}</h4>
        {data && (
          <div className="flex items-center gap-2 text-sm">
            <Badge
              color={
                data.status === "allocated" && !pending ? "green" : data.status === "not_applicable" ? "gray" : "yellow"
              }
              variant="light"
            >
              {data.status === "not_applicable"
                ? translate("Not applicable", "لا ينطبق")
                : pending
                  ? translate("Not fully allocated", "غير مخصص بالكامل")
                  : translate("Allocated to the project", "مخصص للمشروع")}
            </Badge>
            {data.journalEntry && (
              <span className="text-xs text-gray-500">
                {translate("WIP entry", "قيد المشروعات تحت التنفيذ")} <JournalEntryLink entry={data.journalEntry} />
              </span>
            )}
          </div>
        )}
      </div>
      {error && <ErrorAlert error={error} />}
      {allocateError && <ErrorAlert error={allocateError} />}
      {loading && !data ? (
        <p className="text-sm text-gray-400">{translate("Loading...", "جاري التحميل...")}</p>
      ) : (
        data && (
          <>
            <div className="overflow-x-auto rounded-md border dark:border-gray-700">
              <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Product / Service", "الصنف / الخدمة")}</Table.Th>
                    <Table.Th className="text-end">{translate("Ordered", "المطلوب")}</Table.Th>
                    <Table.Th className="text-end">{translate("Received", "المستلم")}</Table.Th>
                    <Table.Th className="text-end">{translate("Returned", "المرتجع")}</Table.Th>
                    <Table.Th className="text-end">{translate("Allocated to Project", "المخصص للمشروع")}</Table.Th>
                    <Table.Th className="text-end">{translate("Unallocated Received", "المستلم غير المخصص")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.lines.map((l) => (
                    <Table.Tr key={l.itemId}>
                      <Table.Td>
                        {name(l)}
                        {!l.stock && (
                          <span className="ms-2 text-xs text-gray-500">
                            ({translate("service - no stock", "خدمة - بدون مخزون")})
                          </span>
                        )}
                      </Table.Td>
                      <Table.Td className="text-end tabular-nums">{l.ordered}</Table.Td>
                      <Table.Td className="text-end tabular-nums">{l.received}</Table.Td>
                      <Table.Td className="text-end tabular-nums">{l.returned}</Table.Td>
                      <Table.Td className="text-end tabular-nums">{l.stock ? l.allocated : "-"}</Table.Td>
                      <Table.Td
                        className={`text-end tabular-nums ${l.unallocated > 0 ? "font-semibold text-amber-600" : ""}`}
                      >
                        {l.stock ? l.unallocated : "-"}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {translate(
                "An order is received into stock when it is created; its received stock lines then move to the order's project (the same movement its accounting already makes: inventory to PUC). Returns release the allocation first.",
                "يُستلم الأمر في المخزون عند إنشائه؛ ثم تنتقل أصنافه المخزنية المستلمة إلى مشروع الأمر (نفس حركة قيوده: من المخزون إلى مشروعات تحت التنفيذ). المرتجعات تحرر التخصيص أولاً.",
              )}
            </p>
            {pending && canAllocate && (
              <Alert color="yellow" variant="light">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {translate(
                      "Some received quantity is not allocated to the project yet.",
                      "جزء من الكمية المستلمة لم يُخصص للمشروع بعد.",
                    )}
                  </span>
                  <Button size="xs" loading={allocating} onClick={runAllocation}>
                    {translate("Allocate to project", "تخصيص للمشروع")}
                  </Button>
                </div>
              </Alert>
            )}
          </>
        )
      )}
    </section>
  );
}
