import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import systems from "@/utils/constants/systems";
import { SystemId } from "@/types/systems";
import { Badge, Button, Switch, Select, TextInput, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import DeleteModal from "@/components/ui/delete-modal";
import ErrorAlert from "@/components/ui/error-alert";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";

type Membership = { system: SystemId; role: string; isActive: boolean };
type PlatformUser = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  isActive: boolean;
  platformAdmin: boolean;
  systemMemberships: Membership[];
};
type AuditEntry = { _id: string; action: string; createdAt: string; actorName: string; actorEmail?: string; before: unknown; after: unknown };

// Central Business Portal - a single user's cross-system access: basic details, activation,
// per-system membership/role, platform-admin grant/revoke (with last-admin protection enforced
// server-side), password reset, and this user's own audit history.
export default function PlatformAdminUser() {
  const { language, translate, translations } = useLanguage();
  const { id } = useParams();

  const { privateRequest, loading, setLoading, error, setError, data: user, setData: setUser } = useDataHandler<PlatformUser | null>({
    initialData: null,
    initialLoading: true,
  });
  const { data: auditLog, setData: setAuditLog, privateRequest: privateRequest2 } = useDataHandler<AuditEntry[]>({ initialData: [] });

  useDocumentTitle(`${user?.name || translate("User", "مستخدم")} | ${translations.appName}`);

  function loadUser() {
    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({ url: `admin/platform/users/${id}`, language });
      setUser(response.data);
    });
  }

  function loadAuditLog() {
    privateRequest2({ url: "admin/platform/audit-log", params: { targetUser: id || "" }, language }).then(res => setAuditLog(res.data));
  }

  useEffect(() => {
    loadUser();
    loadAuditLog();
  }, [id]);

  if (loading) return <LoadingSection message={translate("Loading user...", "جاري تحميل المستخدم...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error loading user", "خطأ في تحميل المستخدم")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: loadUser }} />;
  if (!user) return null;

  return (
    <AdminLayoutBox header={{ title: user.name, subTitle: user.email, backLink: `/${paths.portal}/${paths.platformAdmin}/${paths.users}` }}>
      <BasicInfo user={user} onUpdated={loadUser} />
      <hr />
      <SystemsEditor user={user} onUpdated={loadUser} />
      <hr />
      <PlatformAdminToggle user={user} onUpdated={loadUser} />
      <hr />
      <ResetPassword user={user} />
      <hr />
      <AuditLogSection entries={auditLog} />
    </AdminLayoutBox>
  );
}

// =============================================================

function BasicInfo({ user, onUpdated }: { user: PlatformUser; onUpdated: () => void }) {
  const { language, translate } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const [name, setName] = useState(user.name);
  const [isActive, setIsActive] = useState(user.isActive);

  const changed = name !== user.name || isActive !== user.isActive;

  function save() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `admin/platform/users/${user._id}`, method: "PATCH", data: { name, isActive }, language });
      notifySuccess({ language, title: translate("Saved", "تم الحفظ"), message: translate("User details updated.", "تم تحديث بيانات المستخدم.") });
      onUpdated();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3>{translate("Basic Information", "المعلومات الأساسية")}</h3>
      {error && <ErrorAlert error={error} fade />}
      <div className="flex flex-wrap items-end gap-3">
        <TextInput label={translate("Name", "الاسم")} value={name} onChange={e => setName(e.currentTarget.value)} />
        <Switch
          label={isActive ? translate("Active", "نشط") : translate("Disabled", "معطل")}
          checked={isActive}
          onChange={e => setIsActive(e.currentTarget.checked)}
        />
        <Button onClick={save} loading={loading} disabled={!changed}>
          {translate("Save", "حفظ")}
        </Button>
      </div>
      {!isActive && (
        <p className="text-xs text-orange-600">
          {translate("A disabled user cannot log in or use any protected API, regardless of system access.", "لا يمكن للمستخدم المعطل تسجيل الدخول أو استخدام أي واجهة محمية، بغض النظر عن صلاحيات الأنظمة.")}
        </p>
      )}
    </div>
  );
}

// =============================================================

function SystemsEditor({ user, onUpdated }: { user: PlatformUser; onUpdated: () => void }) {
  const { language, translate } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const [rows, setRows] = useState<Record<SystemId, { granted: boolean; role: string; isActive: boolean }>>(() => {
    const initial = {} as Record<SystemId, { granted: boolean; role: string; isActive: boolean }>;
    for (const s of systems) {
      const existing = user.systemMemberships.find(m => m.system === s.id);
      initial[s.id] = { granted: !!existing, role: existing?.role || (s.id === "ERP" ? "moderator" : "MEMBER"), isActive: existing?.isActive ?? true };
    }
    return initial;
  });

  function save() {
    handleRequest(language, setLoading, setError, async () => {
      const systemMemberships = (Object.keys(rows) as SystemId[]).filter(id => rows[id].granted).map(id => ({ system: id, role: rows[id].role, isActive: rows[id].isActive }));
      await privateRequest({ url: `admin/platform/users/${user._id}/systems`, method: "PUT", data: { systemMemberships }, language });
      notifySuccess({ language, title: translate("Saved", "تم الحفظ"), message: translate("System access updated.", "تم تحديث صلاحيات الأنظمة.") });
      onUpdated();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3>{translate("System Access", "صلاحيات الأنظمة")}</h3>
      {error && <ErrorAlert error={error} fade />}
      <div className="overflow-x-auto">
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("System", "النظام")}</Table.Th>
              <Table.Th>{translate("Granted", "مفعّل")}</Table.Th>
              <Table.Th>{translate("Role", "الدور")}</Table.Th>
              <Table.Th>{translate("Active", "نشط")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {systems.map(s => (
              <Table.Tr key={s.id}>
                <Table.Td className="font-medium">
                  {translate(s.name.en, s.name.ar)}
                  {!s.entryRoute && (
                    <Badge ms={6} size="xs" color="yellow" variant="light">
                      {translate("not yet implemented", "غير متاح حالياً")}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Switch checked={rows[s.id].granted} onChange={e => setRows(r => ({ ...r, [s.id]: { ...r[s.id], granted: e.currentTarget.checked } }))} />
                </Table.Td>
                <Table.Td>
                  <Select
                    size="xs"
                    disabled={!rows[s.id].granted || s.id !== "ERP"}
                    data={s.id === "ERP" ? ["admin", "moderator", "operator"] : ["MEMBER"]}
                    value={rows[s.id].role}
                    onChange={v => setRows(r => ({ ...r, [s.id]: { ...r[s.id], role: v || r[s.id].role } }))}
                    allowDeselect={false}
                  />
                </Table.Td>
                <Table.Td>
                  <Switch disabled={!rows[s.id].granted} checked={rows[s.id].isActive} onChange={e => setRows(r => ({ ...r, [s.id]: { ...r[s.id], isActive: e.currentTarget.checked } }))} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
      <p className="text-xs text-gray-400">
        {translate(
          'For ERP, the role here mirrors the real ERP role/permissions - toggling "Active" off takes effect immediately on their next request.',
          'بالنسبة لـ ERP، يعكس الدور هنا دور وصلاحيات ERP الفعلية - إيقاف "نشط" يسري فوراً في الطلب التالي للمستخدم.',
        )}
      </p>
      <div>
        <Button onClick={save} loading={loading}>
          {translate("Save System Access", "حفظ صلاحيات الأنظمة")}
        </Button>
      </div>
    </div>
  );
}

// =============================================================

function PlatformAdminToggle({ user, onUpdated }: { user: PlatformUser; onUpdated: () => void }) {
  const { language, translate } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  function toggle() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `admin/platform/users/${user._id}/platform-admin`, method: "PATCH", data: { platformAdmin: !user.platformAdmin }, language });
      notifySuccess({ language, title: translate("Saved", "تم الحفظ"), message: translate("Platform administrator access updated.", "تم تحديث صلاحية مسؤول النظام.") });
      closeConfirm();
      onUpdated();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3>{translate("Platform Administrator", "مسؤول النظام")}</h3>
      <p className="text-sm text-gray-500">
        {translate(
          "Platform administrators can manage system access for every user. This is separate from the ERP's own admin role.",
          "يمكن لمسؤولي النظام إدارة صلاحيات الأنظمة لجميع المستخدمين. هذا منفصل عن دور مسؤول ERP.",
        )}
      </p>
      <div className="flex items-center gap-3">
        <Badge color={user.platformAdmin ? "grape" : "gray"} variant="light">
          {user.platformAdmin ? translate("Platform Admin", "مسؤول النظام") : translate("Not a platform admin", "ليس مسؤول نظام")}
        </Badge>
        <Button color={user.platformAdmin ? "red" : "grape"} variant="light" onClick={openConfirm}>
          {user.platformAdmin ? translate("Revoke Platform Admin", "إلغاء صلاحية مسؤول النظام") : translate("Grant Platform Admin", "منح صلاحية مسؤول النظام")}
        </Button>
      </div>

      <DeleteModal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={user.platformAdmin ? translate("Revoke Platform Admin?", "إلغاء صلاحية مسؤول النظام؟") : translate("Grant Platform Admin?", "منح صلاحية مسؤول النظام؟")}
        subTitle={
          user.platformAdmin
            ? translate("This user will no longer be able to manage system access. This is refused if they are the last remaining platform admin.", "لن يتمكن هذا المستخدم من إدارة صلاحيات الأنظمة بعد ذلك. سيتم رفض هذا الإجراء إذا كان آخر مسؤول نظام متبقي.")
            : translate("This user will be able to create users and manage system access for everyone.", "سيتمكن هذا المستخدم من إنشاء مستخدمين وإدارة صلاحيات الأنظمة لجميع المستخدمين.")
        }
        action={toggle}
        loading={loading}
        error={error}
      />
    </div>
  );
}

// =============================================================

function ResetPassword({ user }: { user: PlatformUser }) {
  const { language, translate } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const [sent, setSent] = useState(false);

  function send() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `admin/platform/users/${user._id}/reset-password`, method: "POST", language });
      setSent(true);
    });
  }

  if (!user.email) return null;

  return (
    <div className="flex flex-col gap-3">
      <h3>{translate("Password", "كلمة المرور")}</h3>
      {error && <ErrorAlert error={error} fade />}
      <div>
        <Button variant="light" onClick={send} loading={loading}>
          {translate("Send Password Reset Code", "إرسال رمز إعادة تعيين كلمة المرور")}
        </Button>
        {sent && <p className="mt-2 text-sm text-teal-600">{translate("Reset code sent to the user's email.", "تم إرسال رمز إعادة التعيين إلى بريد المستخدم.")}</p>}
      </div>
    </div>
  );
}

// =============================================================

function AuditLogSection({ entries }: { entries: AuditEntry[] }) {
  const { translate, language } = useLanguage();

  return (
    <div className="flex flex-col gap-3">
      <h3>{translate("Audit History", "سجل التدقيق")}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">{translate("No recorded administrative actions for this user yet.", "لا توجد إجراءات إدارية مسجلة لهذا المستخدم حتى الآن.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("When", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Action", "الإجراء")}</Table.Th>
                <Table.Th>{translate("By", "بواسطة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map(entry => (
                <Table.Tr key={entry._id}>
                  <Table.Td>{new Date(entry.createdAt).toLocaleString(language === "ar-EG" ? "ar-EG" : "en-US")}</Table.Td>
                  <Table.Td>{entry.action}</Table.Td>
                  <Table.Td>{entry.actorName}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
