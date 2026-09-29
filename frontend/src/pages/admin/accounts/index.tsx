import { ChartOfAccount } from "@/types/chart-of-account";
import { useEffect, useMemo, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Alert, Badge, Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import CreateAccountModal from "./_components/create-account-modal";
import TrialBalanceModal from "./_components/trial-balance-modal";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { outlineIcons } from "@/components/icons";

const typeColors: Record<string, string> = { asset: "blue", liability: "red", equity: "grape", revenue: "green", expense: "orange" };

type TrialBalanceRow = { account: { _id: string }; debit: number; credit: number; balance: number };

export default function ChartOfAccounts() {
  const { language, translate, translations } = useLanguage();
  const canCreate = useHasPermission(resources.accounts, actions.create);
  const canDelete = useHasPermission(resources.accounts, actions.delete);
  const privateRequest = usePrivateRequest();

  useDocumentTitle(`${translations.pages.accounts} | ${translations.adminPanel}`);

  const { loading, setLoading, error, setError, data: accounts, setData: setAccounts } = useDataHandler<ChartOfAccount[]>({
    initialData: [],
    initialLoading: true,
  });

  // Balances are derived from posted Journal Entry lines - never stored on the account document
  // itself (see services/accounting/generalLedgerService.js) - so this page reuses the existing
  // trial-balance aggregation (one query for every account with posted activity) rather than
  // querying each account's balance individually.
  const [balances, setBalances] = useState<Record<string, TrialBalanceRow>>({});

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const [accountsRes, trialBalanceRes] = await Promise.all([
        privateRequest({ url: "accounts", params: { limit: 500, sort: "code" }, language }),
        privateRequest({ url: "accounts/trial-balance", language }),
      ]);
      setAccounts(accountsRes.data);
      const map: Record<string, TrialBalanceRow> = {};
      (trialBalanceRes.data as TrialBalanceRow[]).forEach((row) => {
        map[row.account._id] = row;
      });
      setBalances(map);
    });
  }

  useEffect(() => {
    load();
  }, []);

  // An account with no posted activity yet simply isn't in the trial balance - it has no
  // transaction history, so its balance is 0, not "unknown".
  function getBalance(accountId: string) {
    return balances[accountId]?.balance ?? 0;
  }

  // The total across every account must be zero whenever the underlying journal entries are all
  // individually balanced (which posting itself enforces - see journalEntryModel.js) - shown, not
  // hidden, so a real data problem (a bug, or data touched outside this app) would be visible
  // immediately instead of silently forced to zero.
  const totalLedgerBalance = useMemo(() => Math.round(Object.values(balances).reduce((sum, row) => sum + row.balance, 0) * 100) / 100, [balances]);

  async function handleDeactivate(account: ChartOfAccount) {
    if (!confirm(translate(`Deactivate account "${account.name}"?`, `إلغاء تفعيل الحساب "${account.name}"؟`))) return;
    try {
      await privateRequest({ url: `accounts/${account._id}`, method: "DELETE", language });
      setAccounts((prev) => prev.map((a) => (a._id === account._id ? { ...a, isActive: false } : a)));
    } catch (err) {
      alert((err as Error)?.message || translate("Failed to deactivate account.", "فشل إلغاء تفعيل الحساب."));
    }
  }

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure();
  const [trialBalanceOpened, { open: openTrialBalance, close: closeTrialBalance }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.accounts,
        sideElements: (
          <div className="flex gap-2">
            <Button variant="light" color="dark" onClick={openTrialBalance}>
              {translate("Trial Balance", "ميزان المراجعة")}
            </Button>
            {canCreate && (
              <Button color="cyan" variant="light" onClick={openCreateModal}>
                {translate("Create Account", "إنشاء حساب")}
              </Button>
            )}
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading accounts...", "جاري تحميل الحسابات...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading accounts", "خطأ في تحميل الحسابات")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : accounts.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No accounts found", "لا توجد حسابات")} />
      ) : (
        <>
          <Alert
            color={totalLedgerBalance === 0 ? "green" : "red"}
            variant="light"
            icon={totalLedgerBalance === 0 ? <outlineIcons.ShieldCheck /> : <outlineIcons.ExclamationCircle />}
            mb="md"
          >
            {translate("Total ledger balance", "إجمالي رصيد دفتر الأستاذ")}: <b>{totalLedgerBalance.toLocaleString()}</b>
            {totalLedgerBalance === 0
              ? ` (${translate("balanced", "متوازن")})`
              : ` — ${translate("the ledger is out of balance - this should never happen and needs investigation.", "دفتر الأستاذ غير متوازن - يجب ألا يحدث هذا ويحتاج إلى التحقيق.")}`}
          </Alert>

          <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Code", "الرمز")}</Table.Th>
              <Table.Th>{translate("Name", "الاسم")}</Table.Th>
              <Table.Th>{translate("Type", "النوع")}</Table.Th>
              <Table.Th>{translate("Parent Account", "الحساب الرئيسي")}</Table.Th>
              <Table.Th>{translate("Balance", "الرصيد")}</Table.Th>
              <Table.Th>{translate("Status", "الحالة")}</Table.Th>
              {canDelete && <Table.Th>{translate("Actions", "الإجراءات")}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {accounts.map((account) => (
              <Table.Tr key={account._id}>
                <Table.Td className="font-medium">{account.code}</Table.Td>
                <Table.Td>{account.name}</Table.Td>
                <Table.Td>
                  <Badge color={typeColors[account.type] || "gray"} variant="light">
                    {account.type}
                  </Badge>
                </Table.Td>
                <Table.Td>{account.parentAccount ? `${account.parentAccount.code} - ${account.parentAccount.name}` : "-"}</Table.Td>
                <Table.Td className={getBalance(account._id) < 0 ? "text-red-600" : ""}>{getBalance(account._id).toLocaleString()}</Table.Td>
                <Table.Td>
                  <Badge color={account.isActive ? "green" : "gray"} variant="light">
                    {account.isActive ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
                  </Badge>
                  {account.isSystemDefault && (
                    <Badge color="dark" variant="outline" ml={6}>
                      {translate("System", "نظام")}
                    </Badge>
                  )}
                </Table.Td>
                {canDelete && (
                  <Table.Td>
                    {account.isActive && !account.isSystemDefault && (
                      <Button variant="light" color="red" size="xs" onClick={() => handleDeactivate(account)}>
                        {translate("Deactivate", "إلغاء تفعيل")}
                      </Button>
                    )}
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
          </Table>
        </>
      )}

      <CreateAccountModal
        opened={createModalOpened}
        close={closeCreateModal}
        accounts={accounts}
        onCreated={(account) => setAccounts((prev) => [...prev, account])}
      />
      <TrialBalanceModal opened={trialBalanceOpened} close={closeTrialBalance} />
    </AdminLayoutBox>
  );
}
