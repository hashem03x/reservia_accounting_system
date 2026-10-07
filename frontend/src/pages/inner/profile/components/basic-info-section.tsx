import { useNavigate } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import useLogout from "@/hooks/useLogout";
import paths from "@/utils/constants/paths";
import { formatDate } from "@/utils/helpers/date-formaters";
import { getRoleLabel } from "@/utils/constants/roles";
import { outlineIcons } from "@/components/icons";
import { Button } from "@mantine/core";
import MiniDivider from "@/components/ui/mini-divider";
import EditProfileModal from "./edit-profile-modal";
import EditPasswordModal from "./change-password-modal";

export default function BasicInfoSection() {
  const { language, translate } = useLanguage();

  const [EditProfileOpened, { open: openEditProfile, close: closeEditProfile }] = useDisclosure();
  const [EditPasswordOpened, { open: openEditPassword, close: closeEditPassword }] = useDisclosure();

  const navigate = useNavigate();

  const { user } = useUser();

  const logout = useLogout();

  if (!user) return null;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="flex-center mb-14 h-40 w-full bg-gradient-to-r from-sky-300 to-blue-300">
        <div className="-mb-40 rounded-full border bg-white p-4 text-gray-800 shadow">
          <outlineIcons.Admin className="h-12 w-12" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <h2 className="text-center text-3xl font-bold tracking-tighter">{user.name}</h2>
        <p className="flex-center gap-1 text-center">{user.email}</p>
        <p className="text-center">
          {translate("Member since", "عضو منذ")} {formatDate(user.createdAt, language)}
        </p>

        <div className="flex gap-2">
          <Button variant="light" radius="md" leftSection={<outlineIcons.Edit />} onClick={openEditProfile}>
            {translate("Edit Profile", "تعديل الحساب")}
          </Button>
          <Button variant="light" radius="md" leftSection={<outlineIcons.Lock />} onClick={openEditPassword}>
            {translate("Change Password", "تغيير كلمة المرور")}
          </Button>
        </div>

        <MiniDivider className="my-2" />

        <span className="mb-2 rounded-lg bg-gray-800 px-4 py-1 text-sm text-gray-100">
          {getRoleLabel(user.role, language)}
        </span>

        <div className="flex flex-col gap-4">
          <Button variant="light" radius="md" onClick={() => navigate(`/${paths.admin}`)}>
            {translate("Admin Panel", "لوحة التحكم")}
          </Button>

          <Button
            radius="md"
            variant="light"
            color="orange"
            onClick={() => {
              navigate(`/${paths.login}`);
              logout();
            }}
          >
            {translate("Logout", "تسجيل الخروج")}
          </Button>
        </div>
      </div>

      {/* Modals */}
      <EditProfileModal opened={EditProfileOpened} close={closeEditProfile} />
      <EditPasswordModal opened={EditPasswordOpened} close={closeEditPassword} />
    </div>
  );
}
