import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import useHasPermission from "@/hooks/useHasPermission";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { User as UserType } from "@/types/user";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { isOffline } from "@/utils/constants/customer-types";
import { getRoleLabel, isAdmin, isCustomer, isModerator, isRepresentative } from "@/utils/constants/roles";
import { formatDate } from "@/utils/helpers/date-formaters";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import UserPermissions from "./_components/user-permissions";
import UserModal from "../_components/user-modal";
import DeleteUserModal from "./_components/delete-user-modal";

export default function User() {
  const { language, translate, translations } = useLanguage();

  const { user: loggedInUser } = useUser();

  const { id } = useParams<{ id: string }>();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: user,
    setData: setUser,
  } = useDataHandler<UserType | null>({ initialData: null, initialLoading: true });

  useDocumentTitle(`${user?.name ?? translate("User Data", "بيانات المستخدم")} | ${translations.pages.users}`);

  function handleLoadUser() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({ url: `users/${id}`, signal: controller.signal, language });
      if (response.data.isDeleted || isOffline(response.data.type))
        setError(translate("This user does not exist.", "هذا المستخدم غير موجود."));
      else setUser(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadUser(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, []);

  const canIUpdateUsers = useHasPermission(resources.users, actions.update);
  const canIDeleteUsers = useHasPermission(resources.users, actions.delete);

  // ========== Handle Modals ==========

  const [updateModalOpened, { open: openUpdateModal, close: closeUpdateModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translate("User Data", "بيانات المستخدم"),
        backLink: true,
        sideElements: user && (
          <div className="flex gap-2">
            {canIUpdateUsers && (
              <Button onClick={openUpdateModal} variant="light" radius="md" title={translate("Update", "تحديث")}>
                <outlineIcons.Edit size={18} />
              </Button>
            )}
            {/* Remove `false` to enable the delete button */}
            {false && canIDeleteUsers && (
              <Button onClick={openDeleteModal} variant="light" color="red" radius="md" title={translate("Delete", "حذف")}>
                <outlineIcons.Trash size={18} />
              </Button>
            )}
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading user data", "جاري تحميل بيانات المستخدم")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("An error occurred while loading user data", "حدث خطأ أثناء تحميل بيانات المستخدم")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadUser }}
        />
      ) : (
        user && (
          <div className="flex flex-1 flex-col gap-4">
            {/* User Basic Data */}
            <section className="flex-center w-full flex-1 flex-col gap-4 rounded-xl bg-gray-100 px-4 py-10 sm:px-6">
              <figure>
                <div className="rounded-full border bg-white p-4 text-gray-800 shadow">
                  {isCustomer(user.role) ? (
                    <outlineIcons.User className="h-12 w-12" />
                  ) : (
                    <outlineIcons.Admin className="h-12 w-12" />
                  )}
                </div>
              </figure>

              <div className="flex flex-col items-center gap-2">
                <h2 className="text-center text-3xl font-bold tracking-tighter sm:text-5xl">{user.name}</h2>
                {/* Badge */}
                <div className="mb-1 rounded-full bg-blue-500 px-3 py-1 text-xs text-gray-100 sm:text-sm">
                  {getRoleLabel(user.role, language)}
                </div>
                <p className="text-center">{user.phone}</p>
                <p className="text-center">{user.email}</p>
                <p className="text-center">
                  {translate("Member since", "عضو منذ")} {formatDate(user.createdAt, language)}
                </p>
                <p className="max-w-xs rounded-xl bg-[#f5e5d5] p-3 px-6 text-center">
                  {isAdmin(user.role)
                    ? translate(
                        "Admins have unrestricted access to all resources and can perform any action.",
                        "يتمتع المسؤولون بإمكانية الوصول إلى جميع البيانات ويمكنهم تنفيذ أي إجراء.",
                      )
                    : isModerator(user.role)
                      ? translate(
                          "Moderators' permissions are customizable to allow specific actions.",
                          "يمكن تخصيص صلاحيات المشرفين للسماح بإجراءات محددة.",
                        )
                      : isRepresentative(user.role)
                        ? translate(
                            "Representatives' permissions are customizable to allow specific actions.",
                            "يمكن تخصيص صلاحيات المندوبين للسماح بإجراءات محددة.",
                          )
                        : isCustomer(user.role)
                          ? translate(
                              "Customers do not have access to the admin panel.",
                              "لا يمكن للعملاء الوصول إلى لوحة التحكم.",
                            )
                          : null}
                </p>

                {isCustomer(user.role) && (
                  <Link
                    target="_blank"
                    to={`/${paths.admin}/${paths.home}/${paths.customers}/${user._id}`}
                    className="flex items-center gap-1 text-xs text-blue-500 hover:underline sm:text-sm"
                  >
                    {translate("View Customer Shopping Data", "عرض بيانات التسوق للعميل")}
                    <solidIcons.ExternalLink />
                  </Link>
                )}
              </div>
            </section>

            {/* Only Admins can manage permissions for the moderators. */}
            {loggedInUser && isAdmin(loggedInUser.role) && (isModerator(user.role) || isRepresentative(user.role)) && (
              <UserPermissions user={user} setUser={setUser} />
            )}
          </div>
        )
      )}

      {/* Modals */}
      {user && (
        <>
          <UserModal
            opened={updateModalOpened}
            close={closeUpdateModal}
            userToUpdate={user}
            callback={(response) => setUser(response)}
          />
          <DeleteUserModal opened={deleteModalOpened} close={closeDeleteModal} user={user} />
        </>
      )}
    </AdminLayoutBox>
  );
}
