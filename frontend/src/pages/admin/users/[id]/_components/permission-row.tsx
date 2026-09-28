import { useLanguage } from "@/context/LanguageContext";
import resources from "@/utils/constants/resources";
import allActions, { actionsArray } from "@/utils/constants/actions";
import { Action, Permission, Resource } from "@/types/user";
import { Table, Checkbox, MantineProvider, createTheme } from "@mantine/core";

const theme = createTheme({
  cursorType: "pointer",
});

export default function PermissionRow({
  resource,
  actions,
  permissions,
  setPermissions,
}: {
  resource: Resource;
  actions: Action[];
  permissions: Permission[];
  setPermissions: React.Dispatch<React.SetStateAction<Permission[]>>;
}) {
  const { translate } = useLanguage();

  const renderActionCheckbox = (action: Action) => {
    const accessStatus = getAccessStatus(resource, action);

    const tooltip =
      accessStatus === ACCESSIBLE
        ? translate("This action is always accessible for this resource.", "هذا الإجراء متاح دائمًا لهذه البيانات.")
        : accessStatus === RESTRICTED
          ? translate(
              "This action is not allowed for users on this resource.",
              "هذا الإجراء غير مسموح للمستخدمين على هذه البيانات.",
            )
          : translate(allActions[action].label.en, allActions[action].label.ar);

    return (
      <Table.Td key={action}>
        {actions.includes(action) && (
          <Checkbox
            checked={permissions.some((p) => p.resource === resource && p.actions.includes(action))}
            onChange={() => togglePermission(permissions, setPermissions, resource, action)}
            // disabled={accessStatus !== STANDARD} // تم إلغاء تفعيل هذا الخيار بطلب من العميل
            title={tooltip}
          />
        )}
      </Table.Td>
    );
  };

  return (
    <Table.Tr>
      <Table.Td>{translate(resources[resource].label.en, resources[resource].label.ar)}</Table.Td>
      <MantineProvider theme={theme}>{actionsArray.map((action) => renderActionCheckbox(action.value))}</MantineProvider>
    </Table.Tr>
  );
}

// =============================================================

// Access statuses for user permissions
const ACCESSIBLE = "accessible";
const RESTRICTED = "restricted";
const STANDARD = "standard";
type AccessStatus = typeof ACCESSIBLE | typeof RESTRICTED | typeof STANDARD;

// Permissions that are always accessible
const alwaysAccessiblePermissions: Permission[] = [
  { resource: resources.products.value, actions: [allActions.read.value] },
  { resource: resources.warehouses.value, actions: [allActions.read.value] },
  { resource: resources.categories.value, actions: [allActions.read.value] },
  { resource: resources.subcategories.value, actions: [allActions.read.value] },
  { resource: resources.governorates.value, actions: [allActions.read.value] },
  { resource: resources.customization.value, actions: [allActions.read.value] },
];

// Permissions that are always restricted
const alwaysRestrictedPermissions: Permission[] = [
  { resource: resources.users.value, actions: [allActions.create.value, allActions.update.value, allActions.delete.value] },
];

// Check if an action is always accessible for a given resource
function isAccessible(resource: Resource, action: Action): boolean {
  return alwaysAccessiblePermissions.some(
    (permission) => permission.resource === resource && permission.actions.includes(action),
  );
}

// Check if an action is always restricted for a given resource
function isRestricted(resource: Resource, action: Action): boolean {
  return alwaysRestrictedPermissions.some(
    (permission) => permission.resource === resource && permission.actions.includes(action),
  );
}

// Determine access status for a given resource and action
function getAccessStatus(resource: Resource, action: Action): AccessStatus {
  if (isAccessible(resource, action)) return ACCESSIBLE;
  if (isRestricted(resource, action)) return RESTRICTED;
  return STANDARD;
}

// =============================================================

// Update permissions based on action toggle
function togglePermission(
  permissions: Permission[],
  setPermissions: React.Dispatch<React.SetStateAction<Permission[]>>,
  resource: Resource,
  action: Action,
) {
  const updatedPermissions = [...permissions];
  const permissionIndex = updatedPermissions.findIndex((p) => p.resource === resource);

  if (permissionIndex !== -1) {
    const actionExists = updatedPermissions[permissionIndex].actions.includes(action);
    const updatedActions = actionExists
      ? updatedPermissions[permissionIndex].actions.filter((a) => a !== action)
      : [...updatedPermissions[permissionIndex].actions, action];

    updatedPermissions[permissionIndex] = { ...updatedPermissions[permissionIndex], actions: updatedActions };
  } else {
    updatedPermissions.push({ resource, actions: [action] });
  }

  setPermissions(updatedPermissions);
}
