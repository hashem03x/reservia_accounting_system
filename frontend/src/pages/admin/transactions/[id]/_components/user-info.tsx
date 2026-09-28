import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { User } from "@/types/user";
import { Transaction } from "@/types/transaction";
import { solidIcons } from "@/components/icons";
import { Alert } from "@mantine/core";
import InfoRow from "./info-row";

export default function UserInfo({ transaction }: { transaction: Transaction }) {
  const { language, translate } = useLanguage();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: user,
    setData: setUser,
  } = useDataHandler<User | null>({ initialData: null, initialLoading: true });

  function getUser() {
    handleRequest(language, setLoading, setError, async () => {
      const { data } = await privateRequest({ url: `users/${transaction.userId}`, language });
      setUser(data);
    });
  }

  useEffect(() => {
    getUser();
  }, []);

  return (
    <section>
      <h3 className="mb-4">{translate("User Information", "معلومات المستخدم")}</h3>
      {loading ? (
        <Alert color="yellow" icon={<solidIcons.Spinner className="animate-spin" />} radius="md" px={25} py={20}>
          {translate("Loading user info...", "تحميل معلومات المستخدم...")}
        </Alert>
      ) : error ? (
        <Alert color="red" icon={<solidIcons.ExclamationCircle />} radius="md" px={25} py={20}>
          {translate("Error loading user info", "خطأ في تحميل معلومات المستخدم")}: {error}
        </Alert>
      ) : (
        user && (
          <div className="flex flex-col gap-2">
            <InfoRow label={translate("Name", "الاسم")} value={user.name} />
            <InfoRow label={translate("Email", "البريد الإلكتروني")} value={user.email} />
          </div>
        )
      )}
    </section>
  );
}
