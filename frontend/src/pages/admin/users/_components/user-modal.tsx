import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Permission, Role, User } from "@/types/user";
import { validationRegex } from "@/utils/validations";
import roles, { rolesArray, isAdmin, isModerator, isRepresentative } from "@/utils/constants/roles";
import { Alert, Button, PasswordInput, Select, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function UserModal({
  opened,
  close,
  callback,
  userToUpdate,
}: {
  opened: boolean;
  close: () => void;
  callback: (user: User) => void;
  userToUpdate?: User;
}) {
  const { language, translate, translations } = useLanguage();

  const [name, setName] = useState<string>(userToUpdate?.name || "");
  const [email, setEmail] = useState<string>(userToUpdate?.email || "");
  const [phone, setPhone] = useState<string>(userToUpdate?.phone || "");
  const [password, setPassword] = useState<string>("");
  const [role, setRole] = useState<Role>(userToUpdate?.role || roles.user.value);

  const isValidName = validationRegex.name.test(name);
  const isValidEmail = validationRegex.email.test(email);
  const isValidPhone = validationRegex.phone.test(phone);
  const isValidPassword = validationRegex.password.test(password);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: userToUpdate ? "PUT" : "POST",
        url: userToUpdate ? `users/${userToUpdate._id}` : "users",
        data: userToUpdate
          ? {
              name: name === userToUpdate.name ? undefined : name,
              email: email === userToUpdate.email ? undefined : email,
              phone: phone === userToUpdate.phone ? undefined : phone,
              role: role === userToUpdate.role ? undefined : role,
            }
          : { name, email, phone, password, passwordConfirm: password, role },
      });

      if (isModerator(role)) {
        if (!userToUpdate || (userToUpdate && !isModerator(userToUpdate.role)))
          await privateRequest({
            method: "POST",
            url: `users/permssions/${res.data._id}`,
            data: moderatorDefaultPermissions,
            language,
          });
      }

      if (isRepresentative(role)) {
        if (!userToUpdate || (userToUpdate && !isRepresentative(userToUpdate.role)))
          await privateRequest({
            method: "POST",
            url: `users/permssions/${res.data._id}`,
            data: representativeDefaultPermissions,
            language,
          });
      }

      callback(res.data);

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setName(userToUpdate?.name || "");
      setEmail(userToUpdate?.email || "");
      setPhone(userToUpdate?.phone || "");
      setPassword("");
      setRole(userToUpdate?.role || roles.user.value);
      setError("");
    }, 250);
  }

  const title = translate(`${userToUpdate ? "Update" : "Add"} User`, `${userToUpdate ? "تحديث المستخدم" : "إضافة مستخدم"}`);

  const dataChanged = userToUpdate
    ? name !== userToUpdate.name ||
      email !== userToUpdate.email ||
      phone !== userToUpdate.phone ||
      role !== userToUpdate.role
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          label={translate("Name", "الاسم")}
          placeholder={translate("Name", "الاسم")}
          error={
            name && !isValidName
              ? translate("Name should not start with a number or special character.", "يجب ألا يبدأ الاسم برقم أو علامة.")
              : null
          }
          required
          autoFocus
        />

        <TextInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          label={translate("Email", "البريد الإلكتروني")}
          placeholder={translate("Email", "البريد الإلكتروني")}
          error={email && !isValidEmail ? translate("Enter a valid email address.", "أدخل عنوان بريد إلكتروني صالح.") : null}
          required
        />

        <TextInput
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          label={translate("Phone", "الهاتف")}
          placeholder={translate("Phone", "الهاتف")}
          error={phone && !isValidPhone ? translate("Enter a valid phone number.", "أدخل رقم هاتف صالح.") : null}
          required
        />

        {!userToUpdate && (
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            label={translate("Password", "كلمة المرور")}
            placeholder={translate("Password", "كلمة المرور")}
            autoComplete="new-password" // Prevent browser autofill
            error={
              password && !isValidPassword
                ? translate("Password should be at least 8 characters long.", "يجب أن تكون كلمة المرور من 8 أحرف على الأقل.")
                : null
            }
            required
          />
        )}

        <Select
          data={rolesArray.map((role) => ({
            value: role.value,
            label: translate(role.label.en, role.label.ar),
          }))}
          value={role}
          onChange={(value) => setRole(value as Role)}
          placeholder={translate("Select Role", "اختر الدور")}
          label={translate("Role", "الدور")}
          allowDeselect={false}
          required
        />

        {/*  Admin Alert */}
        {isAdmin(role) ? (
          !userToUpdate || (userToUpdate && !isAdmin(userToUpdate.role)) ? (
            <Alert
              color="red"
              icon={<solidIcons.ExclamationCircle size={25} />}
              title={translate("Be Careful!", "كن حذرًا!")}
            >
              {translate(
                "You are about to grant this user admin privileges, giving them full control over the system. Are you sure you want to proceed?",
                "أنت على وشك منح هذا المستخدم صلاحيات المسؤول، مما يمنحه سيطرة كاملة على النظام. هل أنت متأكد أنك تريد المتابعة؟",
              )}
            </Alert>
          ) : null
        ) : null}

        {/*  Moderator Alert */}
        {isModerator(role) && (
          <Alert color="yellow" icon={<solidIcons.ExclamationCircle size={25} />}>
            {translate("Moderator permissions can be modified as needed.", "يمكن تعديل صلاحيات المشرف حسب الحاجة.")}
          </Alert>
        )}

        {/* Repereentative Alert */}
        {isRepresentative(role) && (
          <Alert color="yellow" icon={<solidIcons.ExclamationCircle size={25} />}>
            {translate("Representatives permissions can be modified as needed.", "يمكن تعديل صلاحيات المندوب حسب الحاجة.")}
          </Alert>
        )}

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={
              !isValidName || !isValidEmail || !isValidPhone || !role || (userToUpdate ? !dataChanged : !isValidPassword)
            }
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}

// =============================================================

const moderatorDefaultPermissions: Permission[] = [
  { resource: "vendors", actions: ["read", "create", "update"] },
  { resource: "purchaseOrders", actions: ["read", "create", "update"] },
  { resource: "products", actions: ["read", "create", "update"] },
  { resource: "salesOrders", actions: ["read", "create", "update"] },
  { resource: "customers", actions: ["read", "create", "update"] },
  { resource: "expenses", actions: ["read", "create", "update"] },
  { resource: "warehouses", actions: ["read"] },
  { resource: "transfers", actions: ["read", "create"] },
  { resource: "reports", actions: [] },
  { resource: "cash", actions: ["read", "update"] },
  { resource: "categories", actions: ["read"] },
  { resource: "subcategories", actions: ["create", "read", "update"] },
  { resource: "coupons", actions: ["read"] },
  { resource: "customization", actions: ["read"] },
  { resource: "governorates", actions: ["read"] },
  { resource: "transactions", actions: [] },
  { resource: "users", actions: ["read"] },
  { resource: "databaseExport", actions: [] },
];

const representativeDefaultPermissions: Permission[] = [
  { resource: "vendors", actions: [] },
  { resource: "purchaseOrders", actions: [] },
  { resource: "products", actions: ["read"] },
  { resource: "salesOrders", actions: ["read", "create", "update"] },
  { resource: "customers", actions: ["read", "create", "update"] },
  { resource: "expenses", actions: [] },
  { resource: "warehouses", actions: ["read"] },
  { resource: "transfers", actions: [] },
  { resource: "reports", actions: [] },
  { resource: "cash", actions: [] },
  { resource: "categories", actions: ["read"] },
  { resource: "subcategories", actions: ["read"] },
  { resource: "coupons", actions: [] },
  { resource: "customization", actions: ["read"] },
  { resource: "governorates", actions: ["read"] },
  { resource: "transactions", actions: [] },
  { resource: "users", actions: ["read"] },
  { resource: "databaseExport", actions: [] },
];
