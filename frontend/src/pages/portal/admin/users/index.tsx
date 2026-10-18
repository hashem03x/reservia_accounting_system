import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import { Badge, Button, Pagination, Table, TextInput, PasswordInput, Select } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { rolesArray } from "@/utils/constants/roles";
import { DataTableContainer } from "@/components/ui/data-table";
import { ClickableRow } from "@/components/ui/clickable-row";

type PlatformUser = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  isActive: boolean;
  platformAdmin: boolean;
  systemMemberships: { system: string; role: string; isActive: boolean }[];
};

// Central Business Portal - the dedicated platform administrator interface (docs section
// "Central System and Role Administration"). Deliberately separate from the existing ERP
// `/admin/users` page (which edits an ERP staff member's role/permissions) - this page manages
// cross-system access, a genuinely different, more sensitive authority. Gated by
// PlatformAdminGuard on the frontend and requirePlatformAdmin on the backend.
export default function PlatformAdminUsers() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translate("User Management", "إدارة المستخدمين")} | ${translations.appName}`);

  const navigate = useNavigate();

  const [activePage, setActivePage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword] = useDebounce(keyword, 350);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<{
    data: PlatformUser[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  } | null>({ initialData: null, initialLoading: true });

  function loadUsers() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({
        url: "admin/platform/users",
        params: { page: activePage.toString(), limit: "20", ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}) },
        language,
      });
      setData(response);
    });
  }

  useEffect(() => {
    loadUsers();
  }, [activePage, debouncedKeyword]);

  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translate("User Management", "إدارة المستخدمين"),
        backLink: `/${paths.portal}`,
        sideElements: (
          <Button onClick={openCreate} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
            {translate("Create User", "إنشاء مستخدم")}
          </Button>
        ),
      }}
    >
      <TextInput
        value={keyword}
        onChange={e => setKeyword(e.currentTarget.value)}
        placeholder={translate("Search by name, email or phone", "البحث بالاسم أو البريد الإلكتروني أو الهاتف")}
        leftSection={<solidIcons.Search />}
      />

      <hr />

      {loading ? (
        <LoadingSection message={translate("Loading users...", "جاري تحميل المستخدمين...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading users", "خطأ في تحميل المستخدمين")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: loadUsers }} />
      ) : !data || data.data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No Users Found", "لا يوجد مستخدمون")} />
      ) : (
        <>
          <DataTableContainer>
            <Table className="text-nowrap" verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                  <Table.Th>{translate("Email", "البريد الإلكتروني")}</Table.Th>
                  <Table.Th>{translate("ERP Role", "الدور في ERP")}</Table.Th>
                  <Table.Th>{translate("Systems", "الأنظمة")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th>{translate("Platform Admin", "مسؤول النظام")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.data.map(u => (
                  <ClickableRow key={u._id} className="cursor-pointer text-gray-600" onClick={() => navigate(`${u._id}`)}>
                    <Table.Td className="font-semibold text-gray-800">{u.name}</Table.Td>
                    <Table.Td>{u.email || "-"}</Table.Td>
                    <Table.Td>{u.role}</Table.Td>
                    <Table.Td>
                      <div className="flex flex-wrap gap-1">
                        {u.systemMemberships.filter(m => m.isActive).map(m => (
                          <Badge key={m.system} size="xs" variant="light">
                            {m.system}
                          </Badge>
                        ))}
                        {u.systemMemberships.filter(m => m.isActive).length === 0 && <span className="text-xs text-gray-400">{translate("None", "لا يوجد")}</span>}
                      </div>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={u.isActive ? "teal" : "gray"} variant="light">
                        {u.isActive ? translate("Active", "نشط") : translate("Disabled", "معطل")}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{u.platformAdmin ? <Badge size="sm" color="grape">{translate("Yes", "نعم")}</Badge> : "-"}</Table.Td>
                  </ClickableRow>
                ))}
              </Table.Tbody>
            </Table>
          </DataTableContainer>

          {data.pagination.totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination total={data.pagination.totalPages} value={activePage} onChange={setActivePage} size="sm" />
            </div>
          )}
        </>
      )}

      <CreateUserModal opened={createOpened} close={closeCreate} onCreated={loadUsers} />
    </AdminLayoutBox>
  );
}

// =============================================================

function CreateUserModal({ opened, close, onCreated }: { opened: boolean; close: () => void; onCreated: () => void }) {
  const { language, translate } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("user");

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setRole("user");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: "admin/platform/users", method: "POST", data: { name, email, phone, password, role }, language });
      notifySuccess({ language, title: translate("Success", "نجاح"), message: translate("User created. Assign system access from their detail page.", "تم إنشاء المستخدم. يمكنك تعيين صلاحيات الأنظمة من صفحة التفاصيل.") });
      reset();
      close();
      onCreated();
    });
  }

  return (
    <Modal opened={opened} onClose={() => { reset(); close(); }} title={translate("Create User", "إنشاء مستخدم")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <ErrorAlert error={error} fade />}
        <TextInput required label={translate("Name", "الاسم")} value={name} onChange={e => setName(e.currentTarget.value)} />
        <TextInput required type="email" label={translate("Email", "البريد الإلكتروني")} value={email} onChange={e => setEmail(e.currentTarget.value)} />
        <TextInput label={translate("Phone", "الهاتف")} value={phone} onChange={e => setPhone(e.currentTarget.value)} />
        <PasswordInput required label={translate("Password", "كلمة المرور")} value={password} onChange={e => setPassword(e.currentTarget.value)} />
        <Select
          label={translate("ERP Role", "الدور في ERP")}
          data={rolesArray.filter(r => r.value !== "user").map(r => ({ value: r.value, label: translate(r.label.en, r.label.ar) }))}
          value={role}
          onChange={v => setRole(v || "user")}
          allowDeselect={false}
        />
        <p className="text-xs text-gray-400">
          {translate("No system access is granted on creation - assign it from the user's detail page.", "لا يتم منح صلاحية أي نظام عند الإنشاء - يمكنك تعيينها من صفحة تفاصيل المستخدم.")}
        </p>
        <Button type="submit" loading={loading} fullWidth>
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
