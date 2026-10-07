import { useState, useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Coupon } from "@/types/coupon";
import { PaginatedData } from "@/types/global";
import { Button, NumberInput, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function CouponModal({
  opened,
  close,
  setPaginatedCoupons,
  couponToUpdate,
  setCouponToUpdate,
}: {
  opened: boolean;
  close: () => void;
  setPaginatedCoupons: React.Dispatch<React.SetStateAction<PaginatedData<Coupon>>>;
  couponToUpdate: Coupon | null;
  setCouponToUpdate: React.Dispatch<React.SetStateAction<Coupon | null>>;
}) {
  const { language, translate, translations } = useLanguage();

  const [name, setName] = useState("");
  const [discount, setDiscount] = useState<string | number>("");
  const [maxUses, setMaxUses] = useState<string | number>("");
  const [remainingUses, setRemainingUses] = useState<string | number>("");
  const [expire, setExpire] = useState<Date | null>(null);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (couponToUpdate) {
      setName(couponToUpdate.name);
      setDiscount(couponToUpdate.discount);
      setMaxUses(couponToUpdate.maxUses);
      setRemainingUses(couponToUpdate.remainingUses);
      setExpire(new Date(couponToUpdate.expire));
    } else reset();
  }, [couponToUpdate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (couponToUpdate && remainingUses > maxUses) {
      return setError(
        translate(
          "Remaining Coupons can't be more than Total Number of Coupons",
          "عدد الكوبونات المتبقية لا يمكن أن يكون أكثر من إجمالي عدد الكوبونات",
        ),
      );
    }

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: couponToUpdate ? "PUT" : "POST",
        url: couponToUpdate ? `coupons/${couponToUpdate._id}` : "coupons",
        data: { name, discount, maxUses, remainingUses: couponToUpdate ? remainingUses || 0 : maxUses, expire },
      });

      setPaginatedCoupons((prev) => {
        if (!prev) return null;

        const updatedData = couponToUpdate
          ? prev.data.map((coupon) => (coupon._id === couponToUpdate._id ? res.data : coupon))
          : [res.data, ...prev.data];

        return { ...prev, data: updatedData };
      });

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      if (couponToUpdate) setCouponToUpdate(null);
      else reset();
      setError("");
    }, 250);
  }

  function reset() {
    setName("");
    setDiscount("");
    setMaxUses("");
    setRemainingUses("");
    setExpire(null);
  }

  const title = translate(
    `${couponToUpdate ? "Update" : "Add"} Coupon`,
    `${couponToUpdate ? "تحديث الكوبون" : "إضافة كوبون"}`,
  );

  const dataChanged = couponToUpdate
    ? name !== couponToUpdate.name ||
      discount !== couponToUpdate.discount ||
      maxUses !== couponToUpdate.maxUses ||
      remainingUses !== couponToUpdate.remainingUses ||
      expire?.toISOString() !== couponToUpdate.expire
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextInput
          label={translate("Coupon Code", "كود الكوبون")}
          placeholder={translate("Coupon Code", "كود الكوبون")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          data-autofocus
        />

        <NumberInput
          label={translate("Discount", "الخصم")}
          placeholder={translate("Discount", "الخصم")}
          required
          max={100}
          min={0}
          clampBehavior="strict"
          allowNegative={false}
          decimalScale={2}
          value={discount}
          onChange={setDiscount}
          rightSection="%"
        />

        <NumberInput
          label={translate("Number of Coupons", "عدد الكوبونات")}
          placeholder={translate("Number of Coupons", "عدد الكوبونات")}
          required
          min={0}
          clampBehavior="strict"
          allowNegative={false}
          decimalScale={0}
          value={maxUses}
          onChange={setMaxUses}
        />

        {couponToUpdate && (
          <NumberInput
            label={translate("Remaining Coupons", "عدد الكوبونات المتبقية")}
            placeholder={translate("Remaining Coupons", "عدد الكوبونات المتبقية")}
            required
            min={0}
            clampBehavior="strict"
            allowNegative={false}
            decimalScale={0}
            value={remainingUses}
            onChange={setRemainingUses}
          />
        )}

        <DateInput
          label={translate("Expire Date", "تاريخ الانتهاء")}
          placeholder={translate("Expire Date", "تاريخ الانتهاء")}
          value={expire}
          onChange={setExpire}
          required
          minDate={new Date()}
        />

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={
              !name || !expire || !discount || !maxUses || (couponToUpdate ? !dataChanged || remainingUses === "" : false)
            }
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
