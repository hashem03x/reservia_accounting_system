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
import { Alert, Badge, Button, Select, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import CreateAccountModal from "./_components/create-account-modal";
import EditAccountModal from "./_components/edit-account-modal";
import TrialBalanceModal from "./_components/trial-balance-modal";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { outlineIcons } from "@/components/icons";
import { AccountType } from "@/types/chart-of-account";
import { AccountStates } from "@/utils/constants/accounting";

const typeColors: Record<string, string> = { asset: "blue", liability: "red", equity: "grape", revenue: "green", expense: "orange", cogs: "teal" };
const accountTypes: AccountType[] = ["asset", "liability", "equity", "revenue", "cogs", "expense"];

function sortBySortOrder(list: ChartOfAccount[]) {
  return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

type TrialBalanceRow = { account: { _id: string }; debit: number; credit: number; balance: number };

export default function ChartOfAccounts() {
  const { language, translate, translations } = useLanguage();
  const canCreate = useHasPermission(resources.accounts, actions.create);
  const canUpdate = useHasPermission(resources.accounts, actions.update);
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
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(null);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      // Sorted by sortOrder (not code) so this list reflects the same order everywhere else in the
      // app (selectors, reports) - see chartOfAccountOrderingService.js. `code` is a tie-break only.
      const [accountsRes, trialBalanceRes] = await Promise.all([
        privateRequest({ url: "accounts", params: { limit: 500, sort: "sortOrder,code" }, language }),
        privateRequest({ url: "accounts/trial-balance", language }),
      ]);
      setAccounts(sortBySortOrder(accountsRes.data));
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

  const visibleAccounts = useMemo(
    () => accounts.filter((a) => (!typeFilter || a.type === typeFilter) && (!stateFilter || a.state === stateFilter)),
    [accounts, typeFilter, stateFilter]
  );

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
  const [editModalOpened, { open: openEditModal, close: closeEditModal }] = useDisclosure();
  const [editingAccount, setEditingAccount] = useState<ChartOfAccount | null>(null);

  function handleEditClick(account: ChartOfAccount) {
    setEditingAccount(account);
    openEditModal();
  }

  const showActionsColumn = canDelete || canUpdate;

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
          <div className="mb-4 flex flex-wrap gap-2">
            <Select
              placeholder={translate("Filter by type", "تصفية حسب النوع")}
              value={typeFilter}
              onChange={setTypeFilter}
              data={accountTypes.map((t) => ({ value: t, label: t }))}
              clearable
              w={200}
            />
            <Select
              placeholder={translate("Filter by state", "تصفية حسب الحالة")}
              value={stateFilter}
              onChange={setStateFilter}
              data={AccountStates.map((s) => ({ value: s, label: s }))}
              clearable
              w={200}
            />
          </div>

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
              <Table.Th>{translate("State", "الحالة الفرعية")}</Table.Th>
              <Table.Th>{translate("Parent Account", "الحساب الرئيسي")}</Table.Th>
              <Table.Th>{translate("Balance", "الرصيد")}</Table.Th>
              <Table.Th>{translate("Status", "الحالة")}</Table.Th>
              {showActionsColumn && <Table.Th>{translate("Actions", "الإجراءات")}</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibleAccounts.map((account) => (
              <Table.Tr key={account._id}>
                <Table.Td className="font-medium">{account.code}</Table.Td>
                <Table.Td>
                  {account.name}
                  {account.nameAr && <div className="text-xs text-gray-400" dir="rtl">{account.nameAr}</div>}
                </Table.Td>
                <Table.Td>
                  <Badge color={typeColors[account.type] || "gray"} variant="light">
                    {account.type}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {account.state ? (
                    <Badge color="gray" variant="outline">
                      {account.state}
                    </Badge>
                  ) : (
                    "-"
                  )}
                </Table.Td>
                <Table.Td>
                  {account.parentAccount
                    ? `${account.parentAccount.code} - ${account.parentAccount.name}`
                    : account.parentGroupNameEn
                      ? translate(account.parentGroupNameEn, account.parentGroupNameAr || account.parentGroupNameEn)
                      : "-"}
                </Table.Td>
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
                {showActionsColumn && (
                  <Table.Td>
                    <div className="flex gap-2">
                      {canUpdate && (
                        <Button variant="light" size="xs" onClick={() => handleEditClick(account)}>
                          {translate("Edit", "تعديل")}
                        </Button>
                      )}
                      {canDelete && account.isActive && !account.isSystemDefault && (
                        <Button variant="light" color="red" size="xs" onClick={() => handleDeactivate(account)}>
                          {translate("Deactivate", "إلغاء تفعيل")}
                        </Button>
                      )}
                    </div>
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
        onCreated={(account) => setAccounts((prev) => sortBySortOrder([...prev, account]))}
      />
      <EditAccountModal
        opened={editModalOpened}
        close={closeEditModal}
        account={editingAccount}
        accounts={accounts}
        onUpdated={(updated) => setAccounts((prev) => sortBySortOrder(prev.map((a) => (a._id === updated._id ? updated : a))))}
      />
      <TrialBalanceModal opened={trialBalanceOpened} close={closeTrialBalance} />
    </AdminLayoutBox>
  );
}
