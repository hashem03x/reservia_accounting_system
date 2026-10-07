import { User } from "@/types/user";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import DeleteModal from "@/components/ui/delete-modal";

export default function DeleteUserModal({ opened, close, user }: { opened: boolean; close: () => void; user: User }) {
  const { language, translate } = useLanguage();

  const navigate = useNavigate();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteUser() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `users/${user._id}`, language });
      navigate(`/${paths.admin}/${paths.users}`);
    });
  }

  function handleClose() {
    close();
    setTimeout(() => setError(""), 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(`Delete User "${user.name}"`, `حذف المستخدم "${user.name}"`)}
      subTitle={translate(`Are you sure you want to delete this user?`, `هل أنت متأكد أنك تريد حذف هذا المستخدم؟`)}
      action={deleteUser}
      loading={loading}
      error={error}
    />
  );
}
