import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import { Table } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";

type TrialBalanceRow = { account: { _id: string; code: string; name: string; type: string }; debit: number; credit: number; balance: number };

export default function TrialBalanceModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { translate, language } = useLanguage();

  const { privateRequest, loading, setLoading, error, setError, data: rows, setData: setRows } = useDataHandler<TrialBalanceRow[]>({
    initialData: [],
  });

  useEffect(() => {
    if (!opened) return;
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "accounts/trial-balance", language });
      setRows(res.data);
    });
  }, [opened]);

  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  const totalBalance = Math.round(rows.reduce((sum, r) => sum + r.balance, 0) * 100) / 100;

  return (
    <Modal opened={opened} onClose={close} title={translate("Trial Balance", "ميزان المراجعة")} size="lg">
      {loading ? (
        <LoadingSection message={translate("Loading...", "جاري التحميل...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error", "خطأ")} errorMessage={error} />
      ) : rows.length === 0 ? (
        <EmptySection message={translate("No posted journal entries yet.", "لا توجد قيود مرحلة بعد.")} />
      ) : (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Account", "الحساب")}</Table.Th>
              <Table.Th>{translate("Debit", "مدين")}</Table.Th>
              <Table.Th>{translate("Credit", "دائن")}</Table.Th>
              <Table.Th>{translate("Balance", "الرصيد")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.account._id}>
                <Table.Td>
                  {row.account.code} - {row.account.name}
                </Table.Td>
                <Table.Td>{row.debit.toLocaleString()}</Table.Td>
                <Table.Td>{row.credit.toLocaleString()}</Table.Td>
                <Table.Td className={row.balance < 0 ? "text-red-600" : ""}>{row.balance.toLocaleString()}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr className="font-bold">
              <Table.Td>{translate("Total", "الإجمالي")}</Table.Td>
              <Table.Td>{totalDebit.toLocaleString()}</Table.Td>
              <Table.Td>{totalCredit.toLocaleString()}</Table.Td>
              <Table.Td className={totalBalance !== 0 ? "text-red-600" : "text-green-600"}>{totalBalance.toLocaleString()}</Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      )}
    </Modal>
  );
}
