import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import handleRequest from "@/utils/helpers/handle-request";
import { User } from "@/types/user";
import { PaginatedData } from "@/types/global";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import customerTypes from "@/utils/constants/customer-types";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { rolesArray, getRoleLabel } from "@/utils/constants/roles";
import { Button, Select, Table, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ErrorSection from "@/components/ui/sections/error";
import NoResultsSection from "@/components/ui/sections/no-results";
import LoadingSection from "@/components/ui/sections/loading";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import UserModal from "./_components/user-modal";

const USERS_PER_PAGE = import.meta.env.VITE_USERS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Users() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.users} | ${translations.adminPanel}`);

  const navigate = useNavigate();

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [roleFilter, setRoleFilter] = useState(searchParams.get("role") || "");
  const [keyword, setKeyword] = useState(searchParams.get("keyword") || "");
  const [debouncedKeyword] = useDebounce(keyword, 350);

  const params = {
    page: activePage.toString(),
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
  };

  // Track the previous filters and check if they have changed to reset the active page to 1.
  const { filtersChanged, updatePreviousFilters } = useHandlePreviousFilters({
    roleFilter,
    debouncedKeyword,
  });

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedUsers,
    setData: setPaginatedUsers,
  } = useDataHandler<PaginatedData<User>>({ initialData: null, initialLoading: true });

  function handleLoadUsers() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "users",
        params: { type: customerTypes.online.value, isDeleted: false, limit: USERS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedUsers(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    // If the filters have changed, reset the active page to 1.
    const newFilters = { roleFilter, debouncedKeyword };
    if (filtersChanged(newFilters)) {
      updatePreviousFilters(newFilters);
      if (activePage !== 1) {
        setActivePage(1); // This will, in turn, trigger this effect again and call getUsers().
        return;
      }
    }

    window.scrollTo({ top: 0, behavior: "instant" });

    const cancelRequest = handleLoadUsers(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage, roleFilter, debouncedKeyword]);

  const canICreateUsers = useHasPermission(resources.users, actions.create);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.users,
        sideElements: canICreateUsers && (
          <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
            {translate("Add New User", "إضافة مستخدم جديد")}
          </Button>
        ),
      }}
    >
      {/* Search and filter */}
      <div className="flex gap-2 sm:gap-3">
        <div className="flex-grow">
          <TextInput
            value={keyword}
            onChange={(e) => setKeyword(e.currentTarget.value)}
            placeholder={translate("Search for a user", "ابحث عن مستخدم")}
            leftSection={<solidIcons.Search />}
            rightSection={
              keyword && (
                <button onClick={() => setKeyword("")}>
                  <solidIcons.XMark />
                </button>
              )
            }
          />
        </div>

        <Select
          w={135}
          value={roleFilter}
          onChange={(value) => setRoleFilter(value as string)}
          placeholder={translate("Filter by role", "فلتر حسب الدور")}
          allowDeselect={false}
          data={[
            { value: "", label: translate("All", "الكل") },
            ...rolesArray.map((role) => ({ value: role.value, label: translate(role.label.en, role.label.ar) })),
          ]}
        />
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading users...", "جاري تحميل المستخدمين...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading users", "خطأ في تحميل المستخدمين")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadUsers }}
        />
      ) : (
        paginatedUsers &&
        (paginatedUsers.data.length === 0 ? (
          debouncedKeyword ? (
            <NoResultsSection
              keyword={debouncedKeyword}
              button={{ text: translate("View All", "عرض الكل"), onClick: () => setKeyword("") }}
            />
          ) : (
            <EmptySection useDefaultImg message={translate("No Users Found", "لا يوجد مستخدمون")} />
          )
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th>{translate("Phone", "الهاتف")}</Table.Th>
                    <Table.Th>{translate("Email", "البريد الإلكتروني")}</Table.Th>
                    <Table.Th>{translate("Role", "الدور")}</Table.Th>
                    <Table.Th>{translate("Joined on", "انضم في")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedUsers.data.map((user) => (
                    <Table.Tr
                      key={user._id}
                      className="cursor-pointer text-gray-600"
                      onClick={() => navigate(`${user._id}`)}
                    >
                      <Table.Td className="font-semibold text-gray-800">{user.name}</Table.Td>
                      <Table.Td>{user.phone}</Table.Td>
                      <Table.Td>{user.email}</Table.Td>
                      <Table.Td>{getRoleLabel(user.role, language)}</Table.Td>
                      <Table.Td>{formatDate(user.createdAt, language)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<User> paginatedData={paginatedUsers} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      {/* Modals */}
      <UserModal
        opened={modalOpened}
        close={closeModal}
        callback={(newUser) => {
          if (newUser) {
            setPaginatedUsers((prev) => {
              if (!prev) return null;
              return { ...prev, data: [newUser, ...prev.data] };
            });
          }
        }}
      />
    </AdminLayoutBox>
  );
}
