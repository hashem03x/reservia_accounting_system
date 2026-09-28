import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { validationRegex } from "@/utils/validations";
import { UserState } from "@/types/user";
import { Button, TextInput } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";

export default function EditProfileModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { language, translate } = useLanguage();
  const { user, setUser } = useUser();

  const { name: currentName, email: currentEmail, phone: currentPhone } = user as UserState;

  const [name, setName] = useState<string>(currentName);
  const [email, setEmail] = useState<string>(currentEmail);
  const [phone, setPhone] = useState<string>(currentPhone);

  const isValidName = validationRegex.name.test(name);
  const isValidEmail = validationRegex.email.test(email);
  const isValidPhone = validationRegex.phone.test(phone);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        method: "PUT",
        url: "users/updateMe",
        data: {
          name,
          email: email !== currentEmail ? email : undefined,
          phone: phone !== currentPhone ? phone : undefined,
        },
        language,
      });

      setUser((prev) => {
        if (!prev) return prev;
        return { ...prev, name, email, phone };
      });

      handleClose();
    });
  }

  function handleClose() {
    setError("");
    close();
  }

  if (!user) return null;

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Edit Profile", "تعديل الحساب")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextInput
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          label={translate("Name", "الاسم")}
          placeholder={translate("Name", "الاسم")}
          error={
            name && !isValidName
              ? translate("Name should not start with a number or special character.", "يجب ألا يبدأ الاسم برقم أو علامة.")
              : null
          }
          required
        />
        <TextInput
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          label={translate("Email", "البريد الالكتروني")}
          placeholder={translate("Email", "البريد الالكتروني")}
          error={email && !isValidEmail ? translate("Enter a valid email address.", "أدخل عنوان بريد إلكتروني صالح.") : null}
          required
        />
        <TextInput
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          label={translate("Phone", "رقم الهاتف")}
          placeholder={translate("Phone", "رقم الهاتف")}
          error={phone && !isValidPhone ? translate("Enter a valid phone number.", "أدخل رقم هاتف صالح.") : null}
          required
        />

        <div className="flex gap-2">
          <Button
            fullWidth
            type="submit"
            loading={loading}
            disabled={
              !isValidName ||
              !isValidEmail ||
              !isValidPhone ||
              (name === currentName && email === currentEmail && phone === currentPhone)
            }
          >
            {translate("Save", "حفظ")}
          </Button>
          <Button variant="light" fullWidth color="dark" onClick={handleClose}>
            {translate("Cancel", "إلغاء")}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
