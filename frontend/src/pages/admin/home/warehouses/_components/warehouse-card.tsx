import { Warehouse } from "@/types/warehouse";
import { useLanguage } from "@/context/LanguageContext";
import { solidIcons, outlineIcons } from "@/components/icons";
import { Button, Menu } from "@mantine/core";
import Img from "@/components/ui/img";
import placeholderImage from "@/assets/placeholder.jpg";

export default function WarehouseCard({
  warehouse,
  openUpdateModal,
  openDeleteModal,
}: {
  warehouse: Warehouse;
  openUpdateModal: (() => void) | null;
  openDeleteModal: (() => void) | null;
}) {
  const { translate, translations } = useLanguage();

  return (
    <div className="flex-center flex-col gap-2 rounded-lg bg-gray-100 px-6 py-20">
      <Img src={warehouse.image ?? placeholderImage} alt={warehouse.name} className="mb-2 h-28 w-28 rounded" />
      <h3>{warehouse.name}</h3>
      <p>{warehouse.location}</p>

      {warehouse.isDefault && (
        <span className="rounded-full bg-indigo-500 px-3 py-1 text-xs text-white md:text-sm">
          {translate("Default Warehouse", "المخزن الافتراضي")}
        </span>
      )}

      {(openUpdateModal || openDeleteModal) && (
        <Menu withArrow width={215} radius={7.5} shadow="md">
          <Menu.Target>
            <Button variant="light" color="dark" radius="lg">
              <solidIcons.TbMenu />
            </Button>
          </Menu.Target>

          <Menu.Dropdown dir={translations.dir}>
            {openUpdateModal && (
              <Menu.Item leftSection={<outlineIcons.Edit />} onClick={openUpdateModal}>
                {translate("Edit Warehouse", "تعديل المخزن")}
              </Menu.Item>
            )}

            {/* {openUpdateModal && openDeleteModal && <Menu.Divider />}

            {openDeleteModal && (
              <>
                <Menu.Label>{translate("Danger Zone", "منطقة الخطر")}</Menu.Label>
                <Menu.Item
                  color="red"
                  leftSection={<outlineIcons.Trash />}
                  onClick={openDeleteModal}
                  disabled={warehouse.isDefault}
                >
                  {translate("Delete Warehouse", "حذف المخزن")}
                </Menu.Item>
              </>
            )} */}
          </Menu.Dropdown>
        </Menu>
      )}
    </div>
  );
}
