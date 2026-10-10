import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Table, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { AccountingPeriod } from "@/types/accounting-period";

const MONTHS_SHOWN = 24;

/** 'YYYY-MM' of the last `count` months (UTC - the reports' month), newest first. */
function recentPeriods(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
  );
}

/**
 * Admin -> Accounting Periods: close a month so nothing can be posted, edited or reversed into it,
 * and reopen it when an adjustment is authorized. The backend enforces it on every accounting
 * write (manual and automatic journal entries, orders, payments, expenses, fixed assets,
 * depreciation, PUC transfers); this page only changes the status.
 */
export default function AccountingPeriods() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translations.pages.accountingPeriods} | ${translations.adminPanel}`);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<AccountingPeriod[]>({
    initialData: [],
    initialLoading: true,
  });
  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "accounting-periods", language });
      setData(res.data || []);
    });
  }
  useEffect(() => {
    load();
  }, []);

  // Every month of the last two years, plus any older month that has a status of its own.
  const rows = useMemo(() => {
    const byPeriod = new Map(data.map((p) => [p.period, p]));
    const periods = [...new Set([...recentPeriods(MONTHS_SHOWN), ...data.map((p) => p.period)])].sort().reverse();
    return periods.map((period) => byPeriod.get(period) || ({ period, status: "open", history: [] } as AccountingPeriod));
  }, [data]);

  const [target, setTarget] = useState<{ period: string; action: "close" | "reopen" } | null>(null);
  const [note, setNote] = useState("");
  const {
    loading: saving,
    setLoading: setSaving,
    error: saveError,
    setError: setSaveError,
    privateRequest: saveRequest,
  } = useDataHandler({ initialData: null });
  function confirm() {
    if (!target) return;
    handleRequest(language, setSaving, setSaveError, async () => {
      await saveRequest({
        method: "POST",
        url: `accounting-periods/${target.period}/${target.action}`,
        data: { note: note || undefined },
        language,
      });
      setTarget(null);
      setNote("");
      load();
    });
  }

  const monthLabel = (period: string) =>
    new Intl.DateTimeFormat(language, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${period}-01T00:00:00Z`),
    );
  const currentPeriod = new Date().toISOString().slice(0, 7);

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.accountingPeriods,
        subTitle: translate("Close a month to lock its accounting records", "أغلق الشهر لقفل قيوده المحاسبية"),
      }}
    >
      <Alert color="blue" variant="light" mb="md">
        {translate(
          'While a month is closed, no journal entry dated in it can be created, edited, posted or reversed - including the automatic entries of orders, payments, expenses, fixed assets, depreciation and PUC transfers. Users see: "Accounting period is closed. Please contact the administrator to reopen it." Reports and records stay readable.',
          'أثناء إغلاق الشهر لا يمكن إنشاء أو تعديل أو ترحيل أو عكس أي قيد بتاريخ داخله - بما في ذلك القيود الآلية للأوامر والمدفوعات والمصروفات والأصول الثابتة والإهلاك وتحويلات مشروعات تحت التنفيذ. تظهر للمستخدم رسالة: "Accounting period is closed. Please contact the administrator to reopen it." وتبقى التقارير والسجلات متاحة للعرض.',
        )}
      </Alert>

      {loading ? (
        <LoadingSection message={translate("Loading accounting periods...", "جاري تحميل الفترات المحاسبية...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading accounting periods", "خطأ في تحميل الفترات المحاسبية")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : (
        <DataTableContainer>
          <DataTable className="text-sm">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th>{translate("Period", "الفترة")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th>{translate("Last Change", "آخر تغيير")}</Table.Th>
                <Table.Th>{translate("Note", "ملاحظة")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((p) => {
                const last = p.history[p.history.length - 1];
                const closed = p.status === "closed";
                return (
                  <Table.Tr key={p.period}>
                    <Table.Td className="whitespace-nowrap">
                      <span className="font-medium">{monthLabel(p.period)}</span>{" "}
                      <span className="text-xs tabular-nums text-gray-500">({p.period})</span>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={closed ? "red" : "green"} variant="light">
                        {closed ? translate("Closed", "مغلقة") : translate("Open", "مفتوحة")}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                      {last
                        ? `${last.action === "closed" ? translate("Closed", "أغلقت") : translate("Reopened", "أعيد فتحها")} · ${last.by?.name || "-"} · ${formatDateAndTime(last.at, language)}`
                        : "-"}
                    </Table.Td>
                    <Table.Td className="max-w-[260px] truncate" title={last?.note || undefined}>
                      {last?.note || "-"}
                    </Table.Td>
                    <Table.Td className="whitespace-nowrap text-end">
                      {closed ? (
                        <Button
                          size="compact-sm"
                          variant="light"
                          color="green"
                          onClick={() => setTarget({ period: p.period, action: "reopen" })}
                        >
                          {translate("Reopen", "إعادة فتح")}
                        </Button>
                      ) : (
                        <Button
                          size="compact-sm"
                          variant="light"
                          color="red"
                          disabled={p.period > currentPeriod}
                          onClick={() => setTarget({ period: p.period, action: "close" })}
                        >
                          {translate("Close", "إغلاق")}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}

      <Modal
        opened={!!target}
        onClose={() => {
          setTarget(null);
          setSaveError("");
        }}
        title={
          target?.action === "close"
            ? translate("Close accounting period", "إغلاق الفترة المحاسبية")
            : translate("Reopen accounting period", "إعادة فتح الفترة المحاسبية")
        }
      >
        {target && (
          <div className="flex flex-col gap-3">
            {saveError && <ErrorAlert error={saveError} />}
            <p className="text-sm">
              {target.action === "close"
                ? translate(
                    `Close ${monthLabel(target.period)}? No accounting record dated in it can then be added or changed until it is reopened.`,
                    `إغلاق ${monthLabel(target.period)}؟ لن يمكن إضافة أو تعديل أي سجل محاسبي بتاريخ داخله حتى يعاد فتحه.`,
                  )
                : translate(
                    `Reopen ${monthLabel(target.period)}? Records dated in it can be added and changed again.`,
                    `إعادة فتح ${monthLabel(target.period)}؟ سيمكن إضافة وتعديل السجلات بتاريخ داخله مرة أخرى.`,
                  )}
            </p>
            <Textarea
              label={translate("Note (optional)", "ملاحظة (اختياري)")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              autosize
              minRows={2}
            />
            <Button color={target.action === "close" ? "red" : "green"} loading={saving} onClick={confirm}>
              {target.action === "close"
                ? translate("Close period", "إغلاق الفترة")
                : translate("Reopen period", "إعادة فتح الفترة")}
            </Button>
          </div>
        )}
      </Modal>
    </AdminLayoutBox>
  );
}
