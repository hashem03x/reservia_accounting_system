import { useEffect } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Badge, Button, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { Product } from "@/types/product";
import { PucTransfer } from "@/types/puc-transfer";
import PucTransferModal from "./puc-transfer-modal";

/** The product's PUC transfers and the PUC Transfer action (stock products only). */
export default function PucTransfersSection({ product }: { product: Product }) {
  const { language, translate, translations } = useLanguage();
  const canTransfer = useHasPermission(resources.products, actions.update);
  const [opened, { open, close }] = useDisclosure();
  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<PucTransfer[]>({
    initialData: [],
    initialLoading: true,
  });

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `puc-transfers/product/${product._id}`, language });
      setData(res.data || []);
    });
  }
  useEffect(() => {
    load();
  }, [product._id]);

  const name = (language === "ar-EG" ? product.title?.ar : product.title?.en) || product.title?.en || product.sku || "";
  const money = (n: number) =>
    `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${translations.currency}`;

  return (
    <section
      className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow dark:bg-gray-800"
      data-tour="product-puc-transfer"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4>{translate("PUC Transfers", "تحويلات مشروعات تحت التنفيذ")}</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {translate(
              "Move this product's stock into a project's Projects Under Construction (PUC).",
              "نقل مخزون هذا المنتج إلى مشروعات تحت التنفيذ لمشروع.",
            )}
          </p>
        </div>
        {canTransfer && (
          <Button onClick={open} variant="light">
            {translate("PUC Transfer", "تحويل لمشروعات تحت التنفيذ")}
          </Button>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-gray-400">{translate("Loading...", "جاري التحميل...")}</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-400">{translate("No PUC transfers yet.", "لا توجد تحويلات بعد.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("From", "من")}</Table.Th>
                <Table.Th>{translate("To Project", "إلى المشروع")}</Table.Th>
                <Table.Th className="text-end">{translate("Quantity", "الكمية")}</Table.Th>
                <Table.Th className="text-end">{translate("Amount", "القيمة")}</Table.Th>
                <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
                <Table.Th>{translate("By", "بواسطة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((t) => (
                <Table.Tr key={t._id} className={t.journalEntry?.status === "reversed" ? "text-gray-400 line-through" : ""}>
                  <Table.Td>{formatDate(t.date, language)}</Table.Td>
                  <Table.Td>
                    {t.sourceType === "warehouse"
                      ? `${translate("Warehouse", "الفرع")}: ${t.warehouse?.name || "-"}`
                      : `${translate("Project", "المشروع")}: ${t.sourceProject?.projectNumber || "-"}`}
                  </Table.Td>
                  <Table.Td>{t.project?.projectNumber}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{t.quantity}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{money(t.amount)}</Table.Td>
                  <Table.Td>
                    <JournalEntryLink entry={t.journalEntry} />
                    {t.journalEntry?.status === "reversed" && (
                      <Badge ms="xs" size="xs" color="gray" variant="light">
                        {translate("Reversed", "معكوس")}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{t.createdBy?.name || "-"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}
      <PucTransferModal opened={opened} close={close} productId={product._id} productName={name} onDone={load} />
    </section>
  );
}
