import { useState } from "react";
import { useAbout } from "@/context/AboutContext";
import { useLanguage } from "@/context/LanguageContext";
import useHasPermission from "@/hooks/useHasPermission";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Button, Checkbox } from "@mantine/core";
import { notifySuccess } from "@/utils/helpers/notifiers";
import Img from "@/components/ui/img";
import ImgController from "@/components/ui/img-controller";
import ErrorAlert from "@/components/ui/error-alert";

export default function AboutForm() {
  const { translate, language } = useLanguage();

  const canIupdateCustomization = useHasPermission(resources.customization, actions.update);

  const { data, setData } = useAbout();

  const [logo, setLogo] = useState<File | string | null>(data?.logo || null);
  const [showSubcategory, setShowSubcategory] = useState(data?.barcodeSittings?.subcategory || false);
  const [showColor, setShowColor] = useState(data?.barcodeSittings?.color || false);
  const [showSize, setShowSize] = useState(data?.barcodeSittings?.size || false);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // This is good but it's not accurate in case of updating the logo.
  const isDataChanged =
    showSubcategory !== data?.barcodeSittings?.subcategory ||
    showColor !== data?.barcodeSittings?.color ||
    showSize !== data?.barcodeSittings?.size;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!logo) {
      setError(translate("Please upload a logo.", "يرجى تحميل شعار."));
      return;
    }

    const formData = new FormData();
    if (logo instanceof File) formData.append("logo", logo);
    formData.append("barcodeSittings[subcategory]", String(showSubcategory));
    formData.append("barcodeSittings[color]", String(showColor));
    formData.append("barcodeSittings[size]", String(showSize));

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        url: `about-us/${import.meta.env.VITE_ABOUT_ID}`,
        method: "PUT",
        data: formData,
        language,
      });

      setData((prev) =>
        prev
          ? {
              ...prev,
              logo: res.data.logo,
              barcodeSittings: { subcategory: showSubcategory, color: showColor, size: showSize },
            }
          : prev,
      );

      notifySuccess({ message: translate("Data has been updated successfully.", "تم تحديث البيانات بنجاح."), language });
    });
  }

  return (
    <form className="flex flex-col gap-4 border-t pt-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <h5>{translate("Logo", "شعار")}</h5>
          <span className="font-bold text-red-500">*</span>
        </div>
        <p>{translate("Upload a square image for your logo.", "قم بتحميل صورة مربعة للشعار.")}</p>
        {canIupdateCustomization ? (
          <ImgController image={logo} setImage={setLogo} mini className="aspect-square h-40 w-40" />
        ) : (
          <Img src={logo as string} alt="logo" className="aspect-square h-40 rounded-md" />
        )}
      </div>

      <hr />

      <div className="flex flex-col gap-1">
        <h5>{translate("Barcode Sticker Settings", "إعدادات ملصق الباركود")}</h5>
        <p>
          {translate(
            "Select which information to display on barcode printable stickers.",
            "حدد المعلومات التي تريد عرضها على ملصقات الباركود القابلة للطباعة.",
          )}
        </p>
        <div className="flex flex-col gap-2">
          <Checkbox
            label={translate("Show Subcategory", "إظهار الفئة الفرعية")}
            checked={showSubcategory}
            onChange={(e) => setShowSubcategory(e.currentTarget.checked)}
            disabled={!canIupdateCustomization}
          />
          <Checkbox
            label={translate("Show Color", "إظهار اللون")}
            checked={showColor}
            onChange={(e) => setShowColor(e.currentTarget.checked)}
            disabled={!canIupdateCustomization}
          />
          <Checkbox
            label={translate("Show Size", "إظهار الحجم")}
            checked={showSize}
            onChange={(e) => setShowSize(e.currentTarget.checked)}
            disabled={!canIupdateCustomization}
          />
        </div>
      </div>

      {error && <ErrorAlert error={error} />}

      {canIupdateCustomization && (
        <Button variant="gradient" radius={100} type="submit" loading={loading} size="lg" disabled={!isDataChanged}>
          {translate("Save", "حفظ")}
        </Button>
      )}
    </form>
  );
}
