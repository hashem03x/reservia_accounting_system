import { Governorate } from "@/types/governorate";
import { useState, useEffect } from "react";
import { useGovernorates } from "@/context/GovernorateContext";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Button, NumberInput, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function GovernorateModal({
  opened,
  close,
  governorateToUpdate,
  setGovernorateToUpdate,
}: {
  opened: boolean;
  close: () => void;
  governorateToUpdate: Governorate | null;
  setGovernorateToUpdate: React.Dispatch<React.SetStateAction<Governorate | null>>;
}) {
  const { language, translate, translations } = useLanguage();

  const { setData: setGovernorates } = useGovernorates();

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [shippingCost, setShippingCost] = useState<number | string>("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (governorateToUpdate) {
      setNameEn(governorateToUpdate.name.en);
      setNameAr(governorateToUpdate.name.ar);
      setShippingCost(governorateToUpdate.shippingCost);
    } else reset();
  }, [governorateToUpdate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        method: governorateToUpdate ? "PUT" : "POST",
        url: governorateToUpdate ? `governorates/${governorateToUpdate._id}` : "governorates",
        data: { name: { en: nameEn, ar: nameAr }, shippingCost },
        language,
      });

      setGovernorates((prev) =>
        governorateToUpdate
          ? prev.map((governorate) => (governorate._id === governorateToUpdate._id ? res.data : governorate))
          : [...prev, res.data],
      );

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      if (governorateToUpdate) setGovernorateToUpdate(null);
      else reset();
      setError("");
    }, 250);
  }

  function reset() {
    setNameEn("");
    setNameAr("");
    setShippingCost("");
  }

  const title = translate(
    `${governorateToUpdate ? "Update" : "Add"} Governorate`,
    `${governorateToUpdate ? "تحديث المحافظة" : "إضافة محافظة"}`,
  );

  const dataChanged = governorateToUpdate
    ? nameEn !== governorateToUpdate.name.en ||
      nameAr !== governorateToUpdate.name.ar ||
      shippingCost !== governorateToUpdate.shippingCost
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextInput
          label={translate("Name (English)", "الاسم (الإنجليزية)")}
          placeholder={translate("Name (English)", "الاسم (الإنجليزية)")}
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          required
        />

        <TextInput
          label={translate("Name (Arabic)", "الاسم (العربية)")}
          placeholder={translate("Name (Arabic)", "الاسم (العربية)")}
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          required
        />

        <NumberInput
          label={translate("Shipping Cost", "تكلفة الشحن")}
          placeholder={translate("Shipping Cost", "تكلفة الشحن")}
          value={shippingCost}
          onChange={setShippingCost}
          required
          min={0}
          clampBehavior="strict"
          allowNegative={false}
          decimalScale={2}
        />

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!nameEn || !nameAr || !shippingCost || (governorateToUpdate ? !dataChanged : false)}
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
