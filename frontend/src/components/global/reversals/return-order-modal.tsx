import { useEffect, useMemo, useState } from "react";
import { Alert, Button, NumberInput, Select, Switch, Table, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { AccountingReversal, ReturnableLine } from "@/types/reversal";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/**
 * Return (part of) a Sales or Purchase Order through the accounting reversal engine: quantities per
 * line (never more than is still returnable), the warehouse goods come back to / leave from, a
 * required reason, and an optional refund through a cash or bank account. The server posts the
 * compensating journal entries, updates stock and balances, and records it all - in one step.
 */
export default function ReturnOrderModal({
  opened,
  close,
  kind,
  orderId,
  orderCode,
  lines,
  defaultWarehouseId,
  paidAmount,
  onDone,
}: {
  opened: boolean;
  close: () => void;
  kind: "sales" | "purchase";
  orderId: string;
  orderCode?: string;
  lines: ReturnableLine[];
  defaultWarehouseId?: string | null;
  paidAmount: number;
  onDone: (reversal: AccountingReversal) => void;
}) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const { data: warehouses } = useWarehouses();

  const [quantities, setQuantities] = useState<Record<string, number | string>>({});
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(false);
  const [refundAccount, setRefundAccount] = useState("");
  const [key, setKey] = useState(newKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // A fresh dialog, a fresh request key: a retried submit of THIS dialog is never applied twice.
  useEffect(() => {
    if (!opened) return;
    setQuantities({});
    setWarehouseId(defaultWarehouseId || "");
    setReason("");
    setRefund(false);
    setRefundAccount("");
    setKey(newKey());
    setError("");
  }, [opened, defaultWarehouseId]);

  const left = (line: ReturnableLine) => Math.max(0, line.ordered - line.returned);
  const selected = lines.filter((l) => Number(quantities[l.productId]) > 0);
  const tooMuch = selected.find((l) => Number(quantities[l.productId]) > left(l));
  const netReturned = useMemo(
    () => selected.reduce((s, l) => s + Number(quantities[l.productId]) * l.unitPrice, 0),
    [selected, quantities],
  );
  const needsWarehouse = selected.some((l) => !l.isService) || refund;
  const canSubmit =
    selected.length > 0 && !tooMuch && reason.trim() && (!needsWarehouse || warehouseId) && (!refund || refundAccount);

  function returnAll() {
    setQuantities(Object.fromEntries(lines.map((l) => [l.productId, left(l)])));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || loading) return;
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        url: `reversals/${kind === "sales" ? "sales-orders" : "purchase-orders"}/${orderId}/returns`,
        method: "POST",
        data: {
          items: selected.map((l) => ({ productId: l.productId, quantity: Number(quantities[l.productId]) })),
          warehouseId: warehouseId || null,
          reason: reason.trim(),
          refund: refund ? { paymentAccount: refundAccount } : null,
          idempotencyKey: key,
        },
        language,
      });
      onDone(res.data);
      close();
    });
  }

  const title =
    kind === "sales"
      ? translate("Return items from the customer", "إرجاع أصناف من العميل")
      : translate("Return items to the vendor", "إرجاع أصناف إلى المورد");
  return (
    <Modal
      opened={opened}
      onClose={() => !loading && close()}
      title={`${title}${orderCode ? ` - ${orderCode}` : ""}`}
      size="xl"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="overflow-x-auto rounded-md border border-gray-100">
          <Table className="text-sm" verticalSpacing="xs">
            <Table.Thead className="bg-gray-50">
              <Table.Tr>
                <Table.Th>{translate("Item", "الصنف")}</Table.Th>
                <Table.Th className="text-end">{translate("Ordered", "الكمية")}</Table.Th>
                <Table.Th className="text-end">{translate("Returned", "المرتجع")}</Table.Th>
                <Table.Th className="w-36">{translate("Return now", "إرجاع الآن")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line) => (
                <Table.Tr key={line.productId}>
                  <Table.Td>
                    {translate(line.title.en, line.title.ar)}
                    {line.isService && <span className="ms-1 text-xs text-gray-500">({translate("service", "خدمة")})</span>}
                  </Table.Td>
                  <Table.Td className="text-end tabular-nums">{line.ordered}</Table.Td>
                  <Table.Td className="text-end tabular-nums">{line.returned}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      min={0}
                      max={left(line)}
                      decimalScale={0}
                      disabled={left(line) === 0}
                      value={quantities[line.productId] ?? ""}
                      onChange={(v) => setQuantities((q) => ({ ...q, [line.productId]: v }))}
                      placeholder={`${translate("max", "حد")} ${left(line)}`}
                      aria-label={`${translate("Quantity to return", "الكمية المرتجعة")} - ${translate(line.title.en, line.title.ar)}`}
                      error={
                        Number(quantities[line.productId]) > left(line)
                          ? translate(`Only ${left(line)} left`, `المتبقي ${left(line)} فقط`)
                          : undefined
                      }
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
        <div>
          <Button variant="subtle" size="xs" onClick={returnAll}>
            {translate("Return everything still returnable", "إرجاع كل ما يمكن إرجاعه")}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={
              kind === "sales"
                ? translate("Goods come back to", "تعود البضاعة إلى")
                : translate("Goods leave from", "تخرج البضاعة من")
            }
            data={warehouses.map((w) => ({ value: w._id, label: w.name }))}
            value={warehouseId || null}
            onChange={(v) => setWarehouseId(v || "")}
            required={needsWarehouse}
            searchable
          />
          <Textarea
            label={translate("Reason", "السبب")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            autosize
            minRows={1}
            maxLength={1000}
          />
        </div>

        <Switch
          checked={refund}
          onChange={(e) => setRefund(e.currentTarget.checked)}
          label={
            kind === "sales"
              ? translate("Refund what is now paid in excess", "رد المبلغ المدفوع بالزيادة")
              : translate(
                  "Record the vendor's refund of what is now paid in excess",
                  "تسجيل رد المورد للمبلغ المدفوع بالزيادة",
                )
          }
          description={translate(
            `Paid so far: ${money(paidAmount)}. Without a refund, any excess stays as a credit on the account.`,
            `المدفوع حتى الآن: ${money(paidAmount)}. بدون رد يبقى أي فائض رصيداً دائناً في الحساب.`,
          )}
        />
        {refund && (
          <PaymentAccountSelect
            value={refundAccount}
            onChange={setRefundAccount}
            label={translate("Refund cash / bank account", "حساب النقدية / البنك للرد")}
            required
          />
        )}

        <Alert color="blue" variant="light">
          <span className="text-sm">
            {kind === "sales"
              ? translate(
                  `Returning ${money(netReturned)} (before tax). The order total, the project's executed % and its recognized revenue, VAT, receivable and cost are reduced by the returned part; goods go back into stock. Journal entries are posted automatically and the original entries are kept.`,
                  `إرجاع ${money(netReturned)} (قبل الضريبة). يقل إجمالي الأمر ونسبة تنفيذ المشروع والإيراد المعترف به والضريبة والمديونية والتكلفة بقدر المرتجع؛ وتعود البضاعة إلى المخزون. تُرحَّل القيود تلقائياً وتبقى القيود الأصلية.`,
                )
              : translate(
                  `Returning ${money(netReturned)} (before tax). The order total, the vendor's balance, inventory / project cost and input VAT are reduced by the returned part; goods leave stock (and the project). Journal entries are posted automatically and the original entries are kept.`,
                  `إرجاع ${money(netReturned)} (قبل الضريبة). يقل إجمالي الأمر ورصيد المورد والمخزون / تكلفة المشروع وضريبة المدخلات بقدر المرتجع؛ وتخرج البضاعة من المخزون (والمشروع). تُرحَّل القيود تلقائياً وتبقى القيود الأصلية.`,
                )}
          </span>
        </Alert>

        {error && <ErrorAlert error={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={close} disabled={loading}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button type="submit" color="orange" loading={loading} disabled={!canSubmit}>
            {translate("Record the return", "تسجيل المرتجع")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
