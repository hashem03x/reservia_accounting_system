import { useMemo } from "react";
import { Alert, NumberInput, SegmentedControl, Select, Table, Text, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import { formatDate } from "@/utils/helpers/date-formaters";
import {
  DocumentPaymentTerms,
  InstallmentInput,
  MAX_INSTALLMENTS,
  PaymentSchedule,
  computeDocumentPaymentSchedule,
  resizeInstallments,
  validateDocumentPaymentTerms,
} from "@/utils/helpers/document-payment-terms";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Payment terms of one document - a Purchase Order (vendor terms, tenor from the PO issue date) or a
 * Project (customer terms, tenor from the project start date). Immediate / Lump sum (100%, due date)
 * / Installments: choosing N installments shows N rows, each with a description, a percentage OR a
 * fixed amount, and a tenor in days from the issue date; the due date and amount are shown live with
 * the allocated and unallocated totals. The rules mirror the backend
 * (utils/helpers/document-payment-terms.ts) - the backend validates again on save.
 *
 * `value === null` with `emptyLabel` set = "not set" (e.g. a Purchase Order then takes the vendor's
 * default terms). A schedule is contractual only: it never records or marks a payment.
 */
export default function PaymentTermsEditor({
  value,
  onChange,
  total,
  issueDate,
  issueDateLabel,
  emptyLabel,
  disabled = false,
}: {
  value: DocumentPaymentTerms | null;
  onChange: (value: DocumentPaymentTerms | null) => void;
  total: number;
  issueDate: string | Date | null;
  issueDateLabel: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const { translate, language } = useLanguage();
  const schedule = useMemo(() => computeDocumentPaymentSchedule(value, { total, issueDate }), [value, total, issueDate]);
  const error = useMemo(() => validateDocumentPaymentTerms(value, { total, issueDate }), [value, total, issueDate]);

  const modeOptions = [
    ...(emptyLabel ? [{ value: "none", label: emptyLabel }] : []),
    { value: "immediate", label: translate("Immediate", "فوري") },
    { value: "lump_sum", label: translate("Lump sum (100%)", "دفعة واحدة (100%)") },
    { value: "installments", label: translate("Installments", "أقساط") },
  ];
  const installments = value?.mode === "installments" ? value.installments ?? [] : [];

  function setMode(mode: string) {
    if (mode === "none") return onChange(null);
    if (mode === "immediate") return onChange({ mode: "immediate" });
    if (mode === "lump_sum") return onChange({ mode: "lump_sum", lumpSumDueDate: value?.mode === "lump_sum" ? value.lumpSumDueDate ?? null : null });
    onChange({ mode: "installments", installments: installments.length ? installments : resizeInstallments([], 3) });
  }
  function setRow(index: number, patch: Partial<InstallmentInput>) {
    onChange({ mode: "installments", installments: installments.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <Select
        label={translate("Payment terms", "شروط السداد")}
        value={value?.mode ?? "none"}
        onChange={(v) => v && setMode(v)}
        data={modeOptions}
        allowDeselect={false}
        disabled={disabled}
      />

      {value?.mode === "immediate" && (
        <Text size="sm" c="dimmed">
          {translate(`100% due on the ${issueDateLabel}.`, `100% مستحقة في ${issueDateLabel}.`)}
        </Text>
      )}

      {value?.mode === "lump_sum" && (
        <DateInput
          label={translate("Due date (100%)", "تاريخ الاستحقاق (100%)")}
          value={value.lumpSumDueDate ? new Date(value.lumpSumDueDate) : null}
          onChange={(d) => onChange({ mode: "lump_sum", lumpSumDueDate: d ? d.toISOString().slice(0, 10) : null })}
          minDate={issueDate ? new Date(issueDate) : undefined}
          valueFormat="YYYY-MM-DD"
          required
          disabled={disabled}
        />
      )}

      {value?.mode === "installments" && (
        <>
          <NumberInput
            label={translate("Number of installments", "عدد الأقساط")}
            value={installments.length}
            onChange={(n) => onChange({ mode: "installments", installments: resizeInstallments(installments, Number(n) || 1) })}
            min={1}
            max={MAX_INSTALLMENTS}
            allowDecimal={false}
            allowNegative={false}
            w={200}
            disabled={disabled}
          />
          <Text size="xs" c="dimmed">
            {translate(`Tenor = days after the ${issueDateLabel}.`, `المدة = عدد الأيام بعد ${issueDateLabel}.`)}
          </Text>
          <div className="flex flex-col gap-2">
            {installments.map((row, i) => {
              const computed = schedule.rows[i];
              return (
                <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-md bg-gray-50 p-2 dark:bg-gray-800 sm:grid-cols-12">
                  <TextInput
                    className="sm:col-span-4"
                    label={translate(`Installment ${i + 1} - description`, `القسط ${i + 1} - الوصف`)}
                    value={row.description}
                    onChange={(e) => setRow(i, { description: e.currentTarget.value })}
                    maxLength={200}
                    required
                    disabled={disabled}
                  />
                  <div className="sm:col-span-2">
                    <Text size="sm" fw={500} mb={4}>
                      {translate("Basis", "الأساس")}
                    </Text>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      value={row.basis}
                      onChange={(v) => setRow(i, { basis: v as InstallmentInput["basis"] })}
                      data={[
                        { value: "percentage", label: "%" },
                        { value: "amount", label: translate("Amount", "مبلغ") },
                      ]}
                      disabled={disabled}
                    />
                  </div>
                  <NumberInput
                    className="sm:col-span-2"
                    label={row.basis === "percentage" ? translate("Percentage", "النسبة") : translate("Amount", "المبلغ")}
                    value={(row.basis === "percentage" ? row.percentage : row.amount) ?? ""}
                    onChange={(v) => setRow(i, row.basis === "percentage" ? { percentage: v } : { amount: v })}
                    min={0}
                    max={row.basis === "percentage" ? 100 : undefined}
                    decimalScale={row.basis === "percentage" ? 4 : 2}
                    allowNegative={false}
                    suffix={row.basis === "percentage" ? "%" : undefined}
                    thousandSeparator={row.basis === "amount" ? "," : undefined}
                    required
                    disabled={disabled}
                  />
                  <NumberInput
                    className="sm:col-span-2"
                    label={translate("Tenor (days)", "المدة (أيام)")}
                    value={row.tenorDays}
                    onChange={(v) => setRow(i, { tenorDays: v })}
                    min={0}
                    max={3650}
                    allowDecimal={false}
                    allowNegative={false}
                    required
                    disabled={disabled}
                  />
                  <div className="text-xs text-gray-600 dark:text-gray-300 sm:col-span-2">
                    <div>
                      {translate("Due", "الاستحقاق")}: {computed?.dueDate ? formatDate(computed.dueDate.toISOString(), language) : "-"}
                    </div>
                    <div className="tabular-nums">
                      {translate("Amount", "المبلغ")}: {money(computed?.amount ?? 0)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {value && value.mode !== "immediate" && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
          <span>
            {translate("Value", "القيمة")}: <b>{money(schedule.total)}</b>
          </span>
          <span>
            {translate("Allocated", "المخصص")}: <b>{money(schedule.allocatedAmount)}</b> ({schedule.allocatedPercentage}%)
          </span>
          <span className={schedule.unallocatedAmount > 0 ? "text-orange-600" : ""}>
            {translate("Unallocated", "غير مخصص")}: <b>{money(schedule.unallocatedAmount)}</b>
          </span>
        </div>
      )}
      {error && (
        <Alert color="red" variant="light" p="xs">
          {error}
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        {translate(
          "Contractual schedule only - it never records a payment or marks anything as paid.",
          "جدول تعاقدي فقط - لا يسجل أي دفعة ولا يجعل أي مبلغ مدفوعًا.",
        )}
      </Text>
    </div>
  );
}

/** Read-only payment schedule (as returned by the API: paymentSchedule / customerPaymentSchedule). */
export function PaymentScheduleView({ schedule, emptyText }: { schedule: PaymentSchedule | null | undefined; emptyText: string }) {
  const { translate, language } = useLanguage();
  if (!schedule || schedule.rows.length === 0) return <Text size="sm" c="dimmed">{emptyText}</Text>;
  return (
    <div className="flex flex-col gap-2">
      <Table withTableBorder striped className="text-sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{translate("Installment", "القسط")}</Table.Th>
            <Table.Th className="text-end">%</Table.Th>
            <Table.Th className="text-end">{translate("Amount", "المبلغ")}</Table.Th>
            <Table.Th className="text-end">{translate("Tenor (days)", "المدة (أيام)")}</Table.Th>
            <Table.Th>{translate("Due date", "تاريخ الاستحقاق")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {schedule.rows.map((row, i) => (
            <Table.Tr key={i}>
              <Table.Td>{row.description}</Table.Td>
              <Table.Td className="text-end tabular-nums">{Number(row.percentage).toFixed(2)}%</Table.Td>
              <Table.Td className="text-end tabular-nums">{money(row.amount)}</Table.Td>
              <Table.Td className="text-end tabular-nums">{row.tenorDays ?? "-"}</Table.Td>
              <Table.Td>{row.dueDate ? formatDate(new Date(row.dueDate).toISOString(), language) : "-"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <div className="flex flex-wrap gap-x-6 text-xs text-gray-600 tabular-nums dark:text-gray-300">
        <span>
          {translate("Allocated", "المخصص")}: {money(schedule.allocatedAmount)} ({schedule.allocatedPercentage}%)
        </span>
        <span>
          {translate("Unallocated", "غير مخصص")}: {money(schedule.unallocatedAmount)}
        </span>
      </div>
    </div>
  );
}
