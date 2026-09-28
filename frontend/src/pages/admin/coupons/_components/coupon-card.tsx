import { Coupon } from "@/types/coupon";
import { useLanguage } from "@/context/LanguageContext";
import { formatDate } from "@/utils/helpers/date-formaters";
import { Button, Menu } from "@mantine/core";
import { outlineIcons, solidIcons } from "@/components/icons";

export default function CouponCard({
  coupon,
  openUpdateModal,
  openDeleteModal,
}: {
  coupon: Coupon;
  openUpdateModal: (() => void) | null;
  openDeleteModal: (() => void) | null;
}) {
  const { language, translate, translations } = useLanguage();

  // Get the appropriate gradient based on coupon discount
  const gradientColors = getGradientForDiscount(coupon.discount);

  return (
    <div
      key={coupon._id}
      className="relative flex flex-col gap-2 overflow-hidden text-nowrap rounded-lg px-6 py-6"
      style={{ background: `linear-gradient(to bottom, ${gradientColors[0]}, ${gradientColors[1]})` }}
    >
      <header className="flex items-center justify-between">
        <h2 className="mb-1">{coupon.name}</h2>

        {(openUpdateModal || openDeleteModal) && (
          <Menu withArrow shadow="md" width={215} radius={7.5}>
            <Menu.Target>
              <Button variant="light" color="dark" p="xs" radius="lg">
                <solidIcons.MenuKebab />
              </Button>
            </Menu.Target>

            <Menu.Dropdown dir={translations.dir}>
              {openUpdateModal && (
                <Menu.Item leftSection={<outlineIcons.Edit />} onClick={openUpdateModal}>
                  {translate("Update Coupon", "تعديل الكوبون")}
                </Menu.Item>
              )}

              {openUpdateModal && openDeleteModal && <Menu.Divider />}

              {openDeleteModal && (
                <>
                  <Menu.Label>{translate("Danger Zone", "منطقة الخطر")}</Menu.Label>
                  <Menu.Item color="red" leftSection={<outlineIcons.Trash />} onClick={openDeleteModal}>
                    {translate("Delete Coupon", "حذف الكوبون")}
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </header>

      <div className="flex items-center gap-2 text-sm text-gray-800">
        <solidIcons.Percent />
        <span>
          {translate("Discount", "الخصم")}: {coupon.discount}%
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-800">
        <solidIcons.Coupon />
        <span>
          {translate("Total Coupons", "إجمالي الكوبونات")}: {coupon.maxUses}
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-800">
        <outlineIcons.Coupon />
        <span>
          {translate("Remaining Coupons", "عدد الكوبونات المتبقية")}: {coupon.remainingUses}
        </span>
        {coupon.remainingUses === 0 && (
          <span className="rounded-full bg-rose-500 px-2 py-1 text-xs text-white sm:text-sm">
            {translate("Out of Stock", "نفذت الكمية")}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-800">
        <solidIcons.Calendar />
        <span>
          {translate("Expires in", "ينتهي في")}: {formatDate(coupon.expire, language)}
        </span>
        {new Date(coupon.expire) < new Date(new Date().setDate(new Date().getDate() - 1)) && (
          <span className="rounded-full bg-rose-500 px-2 py-1 text-xs text-white sm:text-sm">
            {translate("Expired", "منتهي")}
          </span>
        )}
      </div>

      <div
        className={`absolute ${translate("right-0 translate-x-1/2", "left-0 -translate-x-1/2")} top-1/2 -translate-y-1/2 rounded-full bg-white p-8`}
      />
    </div>
  );
}

// =============================================================

// Define gradient colors for discount ranges (4 balanced shades of orange)
const getGradientForDiscount = (discount: number) => {
  if (discount < 25) {
    return ["#ffe5b4", "#ffd199"]; // Light orange
  } else if (discount < 50) {
    return ["#ffd199", "#ffb366"]; // Soft orange
  } else if (discount < 75) {
    return ["#ffb366", "#ff944d"]; // Medium orange
  } else {
    return ["#ff944d", "#ff7f3a"]; // Vibrant orange
  }
};
