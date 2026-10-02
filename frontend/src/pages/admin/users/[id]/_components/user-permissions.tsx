import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { Action, Permission, Resource, User } from "@/types/user";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import { actionsArray } from "@/utils/constants/actions";
import { solidIcons } from "@/components/icons";
import { Alert, Button, Table } from "@mantine/core";
import PermissionRow from "./permission-row";

export default function UserPermissions({
  user,
  setUser,
}: {
  user: User;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
}) {
  const { translate, language } = useLanguage();

  const oldPermissions = Object.keys(allPossiblePermissions).map((resource) => ({
    resource: resource as Resource,
    actions: user.permissions.find((p) => p.resource === resource)?.actions ?? [],
  }));

  const [newPermissions, setNewPermissions] = useState<Permission[]>(oldPermissions);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  if (error) {
    notifyError({
      title: translate("Permission Save Failed", "فشل في حفظ الصلاحيات"),
      message: error,
      language,
    });
    setError("");
  }

  async function savePermission() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        method: "POST",
        url: `users/permssions/${user._id}`,
        data: newPermissions,
        language,
      });

      setUser({ ...user, permissions: newPermissions });

      notifySuccess({
        title: translate("Success", "تم بنجاح"),
        message: translate("Permissions saved successfully.", "تم حفظ الصلاحيات بنجاح"),
        language,
      });
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <h3>{translate("User Permissions", "صلاحيات المستخدم")}</h3>
        <p>
          {translate(
            "This user has access to the following resources and actions.",
            "هذا المستخدم لديه صلاحية الوصول إلى البيانات والإجراءات التالية.",
          )}
        </p>
      </header>

      <div className="overflow-x-auto">
        <Table verticalSpacing={8.5} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Resource", "البيانات")}</Table.Th>
              {actionsArray.map((action) => (
                <Table.Th key={action.value}>{translate(action.label.en, action.label.ar)}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {/* List all possible permissions */}
            {Object.entries(allPossiblePermissions).map(([resource, actions]) => (
              <PermissionRow
                key={resource}
                resource={resource as Resource}
                actions={actions}
                permissions={newPermissions}
                setPermissions={setNewPermissions}
              />
            ))}
          </Table.Tbody>
        </Table>
      </div>

      <Button
        onClick={savePermission}
        loading={loading}
        size="md"
        radius="md"
        fullWidth
        disabled={hasSamePermissions(oldPermissions, newPermissions)}
      >
        {translate("Save All", "حفظ الكل")}
      </Button>

      <Alert color="yellow" icon={<solidIcons.ExclamationCircle />} radius="md">
        {translate(
          "For certain resources, the user may need the (View) permission to access other actions.",
          "بالنسبة لبعض البيانات، قد يحتاج المستخدم صلاحية (العرض) للوصول إلى الإجراءات الأخرى.",
        )}
      </Alert>
    </section>
  );
}

// =============================================================

function hasSamePermissions(permissions1: Permission[], permissions2: Permission[]) {
  const sortedPermissions1 = permissions1
    .map((p) => ({
      resource: p.resource,
      actions: p.actions.sort(),
    }))
    .sort((a, b) => a.resource.localeCompare(b.resource));

  const sortedPermissions2 = permissions2
    .map((p) => ({
      resource: p.resource,
      actions: p.actions.sort(),
    }))
    .sort((a, b) => a.resource.localeCompare(b.resource));

  return JSON.stringify(sortedPermissions1) === JSON.stringify(sortedPermissions2);
}

// =============================================================

const allPossiblePermissions: Record<Resource, Action[]> = {
  vendors: ["create", "read", "update"],
  purchaseOrders: ["create", "read", "update"],
  products: ["create", "read", "update"],
  salesOrders: ["create", "read", "update"],
  customers: ["create", "read", "update"],
  expenses: ["create", "read", "update"],
  warehouses: ["create", "read", "update"],
  transfers: ["create", "read"],
  analytics: ["read"],
  reports: ["read"],
  cash: ["read", "update"],
  currencies: ["read", "update"],
  categories: ["create", "read", "update", "delete"],
  subcategories: ["create", "read", "update", "delete"],
  coupons: ["create", "read", "update", "delete"],
  customization: ["read", "update"],
  governorates: ["create", "read", "update", "delete"],
  transactions: ["read"],
  users: ["create", "read", "update"],
  fixedAssets: ["create", "read", "update"],
  databaseExport: ["read"],
  projects: ["create", "read", "update", "delete"],
  accounts: ["create", "read", "update", "delete"],
  journalEntries: ["create", "read", "update"],
  advancedPayments: ["create", "read", "update", "delete"],
};
