import { Governorate } from "@/types/governorate";
import { useLanguage } from "@/context/LanguageContext";
import { Button, Menu } from "@mantine/core";
import { solidIcons, outlineIcons } from "@/components/icons";

export default function GovernorateCard({
  governorate,
  openUpdateModal,
  openDeleteModal,
}: {
  governorate: Governorate;
  openUpdateModal: (() => void) | null;
  openDeleteModal: (() => void) | null;
}) {
  const { translate, translations } = useLanguage();

  return (
    <div className="flex justify-between rounded-lg bg-gray-100 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-bold">{translate(governorate.name.en, governorate.name.ar)}</h3>
        <p className="text-sm">
          {governorate.shippingCost} {translations.currency}
        </p>
      </div>

      {(openUpdateModal || openDeleteModal) && (
        <Menu withArrow width={215} radius={7.5} shadow="md">
          <Menu.Target>
            <Button variant="light" color="dark" p="xs" radius="lg">
              <solidIcons.MenuKebab />
            </Button>
          </Menu.Target>

          <Menu.Dropdown dir={translations.dir}>
            {openUpdateModal && (
              <Menu.Item leftSection={<outlineIcons.Edit />} onClick={openUpdateModal}>
                {translate("Edit Governorate", "تعديل المحافظة")}
              </Menu.Item>
            )}

            {/* {openUpdateModal && openDeleteModal && <Menu.Divider />} */}

            {/* {openDeleteModal && (
              <>
                <Menu.Label>{translate("Danger Zone", "منطقة الخطر")}</Menu.Label>
                <Menu.Item color="red" leftSection={<outlineIcons.Trash />} onClick={openDeleteModal}>
                  {translate("Delete Governorate", "حذف المحافظة")}
                </Menu.Item>
              </>
            )} */}
          </Menu.Dropdown>
        </Menu>
      )}
    </div>
  );
}
