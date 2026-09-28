import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { Subcategory } from "@/types/categories";
import ratios from "@/utils/constants/ratios";
import { formatDate } from "@/utils/helpers/date-formaters";
import { outlineIcons, solidIcons } from "@/components/icons";
import { Button, Menu } from "@mantine/core";
import Img from "@/components/ui/img";
import copyToClipboard from "@/utils/helpers/copy-to-clipboard";

export default function SubcategoryCard({
  subcategory,
  openUpdateModal,
  openDeleteModal,
}: {
  subcategory: Subcategory;
  openUpdateModal: (() => void) | null;
  openDeleteModal: (() => void) | null;
}) {
  const { language, translate, translations } = useLanguage();

  const [copied, setCopied] = useState(false);

  return (
    <div className="relative flex flex-col overflow-hidden rounded-md border bg-slate-50">
      <Img
        width="100%"
        src={subcategory.image}
        alt={translate(subcategory.name.en, subcategory.name.ar)}
        aspectRatio={ratios.subcategory}
      />

      <div className="flex flex-col justify-between gap-1 p-3">
        <h3 className="font-medium">{translate(subcategory.name.en, subcategory.name.ar)}</h3>
        <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500 sm:text-sm">
          <span>{translate("Created at", "أنشئت في")}</span>
          {formatDate(subcategory.createdAt, language)}
        </div>
        <div className="mt-1 self-start">
          <Button
            variant="transparent"
            size="xs"
            p="0"
            leftSection={copied ? <solidIcons.Check /> : <outlineIcons.Copy />}
            style={{ fontWeight: 500 }}
            onClick={() => copyToClipboard(subcategory._id, setCopied)}
          >
            {translate("Copy ID", "نسخ الرقم التعريفى")}
          </Button>
        </div>
      </div>

      {(openUpdateModal || openDeleteModal) && (
        <div className={`absolute ${translate("right-2", "left-2")} top-2 transition-opacity`}>
          <Menu withArrow width={215} radius={7.5} shadow="md">
            <Menu.Target>
              <button className="rounded-md bg-[#ffffff75] p-2">
                <solidIcons.TbMenu />
              </button>
            </Menu.Target>

            <Menu.Dropdown dir={translations.dir}>
              {openUpdateModal && (
                <Menu.Item leftSection={<outlineIcons.Edit />} onClick={openUpdateModal}>
                  {translate("Edit Subcategory", "تعديل الفئة الفرعية")}
                </Menu.Item>
              )}

              {openUpdateModal && openDeleteModal && <Menu.Divider />}

              {openDeleteModal && (
                <>
                  <Menu.Label>{translate("Danger Zone", "منطقة الخطر")}</Menu.Label>
                  <Menu.Item color="red" leftSection={<outlineIcons.Trash />} onClick={openDeleteModal}>
                    {translate("Delete Subcategory", "حذف الفئة الفرعية")}
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </div>
      )}
    </div>
  );
}
