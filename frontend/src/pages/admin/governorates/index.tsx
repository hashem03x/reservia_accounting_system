import { useState } from "react";
import { useGovernorates } from "@/context/GovernorateContext";
import { useLanguage } from "@/context/LanguageContext";
import { useDisclosure } from "@mantine/hooks";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHasPermission from "@/hooks/useHasPermission";
import { Governorate } from "@/types/governorate";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { solidIcons } from "@/components/icons";
import { Button, TextInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import EmptySection from "@/components/ui/sections/empty";
import NoResultsSection from "@/components/ui/sections/no-results";
import ErrorSection from "@/components/ui/sections/error";
import GovernorateCard from "./_components/governorate-card";
import GovernorateModal from "./_components/governorate-modal";
import DeleteGovernorateModal from "./_components/delete-governorate-modal";

export default function Governorates() {
  const { translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.governorates} | ${translations.adminPanel}`);

  const { loading, error, data: governorates, reFetch } = useGovernorates();

  const [keyword, setKeyword] = useState("");

  let filteredGovernorates: Governorate[] = [];

  if (!keyword) filteredGovernorates = governorates;
  else {
    const lowerCaseFilter = keyword.toLowerCase();
    filteredGovernorates = governorates?.filter(
      (governorate) =>
        governorate.name.en.toLowerCase().includes(lowerCaseFilter) || governorate.name.ar.includes(lowerCaseFilter),
    );
  }

  const canICreateGovernorate = useHasPermission(resources.governorates, actions.create);
  const canIUpdateGovernorate = useHasPermission(resources.governorates, actions.update);
  const canIDeleteGovernorate = useHasPermission(resources.governorates, actions.delete);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);

  const [governorateToUpdate, setGovernorateToUpdate] = useState<Governorate | null>(null);
  const [governorateToDelete, setGovernorateToDelete] = useState<Governorate | null>(null);

  function handleOpenUpdateModal(governorate: Governorate) {
    setGovernorateToUpdate(governorate);
    openModal();
  }

  function handleOpenDeleteModal(governorate: Governorate) {
    setGovernorateToDelete(governorate);
    openDeleteModal();
  }

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.governorates,
        sideElements: canICreateGovernorate && (
          <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
            {translate("Add Governorate", "إضافة محافظة")}
          </Button>
        ),
      }}
    >
      <TextInput
        value={keyword}
        onChange={(e) => setKeyword(e.currentTarget.value)}
        placeholder={translate("Search for a governorate", "ابحث عن محافظة")}
        leftSection={<solidIcons.Search />}
        rightSection={
          keyword && (
            <button onClick={() => setKeyword("")}>
              <solidIcons.XMark />
            </button>
          )
        }
      />

      {loading ? (
        <LoadingSection message={translate("Loading Governorates...", "جاري تحميل المحافظات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error Loading Governorates", "خطأ في تحميل المحافظات")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: reFetch }}
        />
      ) : filteredGovernorates.length === 0 ? (
        keyword ? (
          <NoResultsSection
            keyword={keyword}
            button={{ text: translate("View All", "عرض الكل"), onClick: () => setKeyword("") }}
          />
        ) : (
          <EmptySection useDefaultImg message={translate("No Governorates Found", "لا توجد محافظات")} />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredGovernorates.map((governorate) => (
            <GovernorateCard
              key={governorate._id}
              governorate={governorate}
              openUpdateModal={canIUpdateGovernorate ? () => handleOpenUpdateModal(governorate) : null}
              openDeleteModal={canIDeleteGovernorate ? () => handleOpenDeleteModal(governorate) : null}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <GovernorateModal
        opened={modalOpened}
        close={closeModal}
        governorateToUpdate={governorateToUpdate}
        setGovernorateToUpdate={setGovernorateToUpdate}
      />
      <DeleteGovernorateModal
        opened={deleteModalOpened}
        close={closeDeleteModal}
        governorateToDelete={governorateToDelete}
        setGovernorateToDelete={setGovernorateToDelete}
      />
    </AdminLayoutBox>
  );
}
