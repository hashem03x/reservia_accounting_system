import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { Alert, Button, NumberInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import useFetchingStatus from "@/hooks/useFetchingStatus";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { Product } from "@/types/product";
import Modal from "@/components/ui/modal";
import { outlineIcons, solidIcons } from "@/components/icons";

export default function GlobalDiscount({ singleProduct = null }: { singleProduct?: Product | null }) {
  const { language } = useLanguage();

  const [opened, { open, close }] = useDisclosure(false);

  const [discount, setDiscount] = useState<number | string>(0);

  const privateRequest = usePrivateRequest();
  const { loading, setLoading, error, setError } = useFetchingStatus();
  const [success, setSuccess] = useState(false);

  function applyDiscount() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        method: "PUT",
        url: `products/${singleProduct ? singleProduct._id : ""}/discount`,
        data: { discount },
      });

      setSuccess(true);

      setTimeout(() => {
        handleClose();
        setDiscount("");
        setTimeout(() => setSuccess(false), 250);
        window.location.reload();
      }, 1500);
    });
  }

  function handleClose() {
    close();
    setTimeout(() => setError(""), 250);
  }

  return (
    <>
      {singleProduct ? (
        <Button
          variant="light"
          color="pink"
          size="xs"
          radius="md"
          onClick={open}
          title={translate(language, "Add Discount", "إضافة خصم")}
        >
          <outlineIcons.Discount size={18} />
        </Button>
      ) : (
        <Button variant="light" color="pink" leftSection={<outlineIcons.Discount />} size="sm" onClick={open}>
          {translate(language, "Global Discount", "خصم عام")}
        </Button>
      )}

      <Modal opened={opened} onClose={handleClose}>
        <div className="flex flex-col gap-3">
          {singleProduct ? (
            <h3>{translate(language, "Apply Discount", "تطبيق خصم")}</h3>
          ) : (
            <h3>{translate(language, "Apply Global Discount", "تطبيق خصم عام")}</h3>
          )}

          {success ? (
            <Alert color="teal" icon={<solidIcons.CheckCircle />}>
              {translate(language, "Discount has been applied successfully", "تم تطبيق الخصم بنجاح")}
            </Alert>
          ) : (
            <>
              {singleProduct ? (
                <p>
                  {translate(
                    language,
                    "This discount will be applied to this products only",
                    "سيتم تطبيق هذا الخصم على هذا المنتج فقط",
                  )}
                  .
                </p>
              ) : (
                <p>
                  {translate(language, "This discount will be applied to", "سيتم تطبيق هذا الخصم على")}{" "}
                  <span className="font-medium text-gray-800">{translate(language, "all products", "جميع المنتجات")}.</span>
                </p>
              )}

              <NumberInput
                label={translate(language, "Discount Percentage (%)", "نسبة الخصم (%)")}
                placeholder={translate(language, "Discount Percentage (%)", "نسبة الخصم (%)")}
                withAsterisk
                max={100}
                min={0}
                clampBehavior="strict"
                allowNegative={false}
                decimalScale={2}
                value={discount}
                onChange={setDiscount}
                rightSection={"%"}
              />

              {!singleProduct && (
                <Alert
                  color="orange"
                  title={translate(language, "Warning", "تحذير")}
                  icon={<solidIcons.ExclamationCircle />}
                >
                  {translate(
                    language,
                    "This discount will be applied to all products and will override any existing individual discounts. Please ensure you want to apply this discount globally.",
                    "سيتم تطبيق هذا الخصم على جميع المنتجات وسيتجاوز أي خصومات فردية موجودة. يرجى التأكد من رغبتك في تطبيق هذا الخصم على مستوى المتجر بأكمله.",
                  )}
                </Alert>
              )}

              <div className="flex items-center gap-2">
                <Button size="md" loading={loading} onClick={applyDiscount} disabled={discount === ""}>
                  {translate(language, "Apply", "تطبيق")}
                </Button>
                <Button variant="light" color="dark" size="md" onClick={handleClose}>
                  {translate(language, "Cancel", "إلغاء")}
                </Button>
              </div>

              {error && (
                <Alert color="red" icon={<solidIcons.ExclamationCircle />}>
                  {error}
                </Alert>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
