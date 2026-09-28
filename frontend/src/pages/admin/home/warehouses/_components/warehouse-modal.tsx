import { Warehouse } from "@/types/warehouse";
import { useState, useEffect } from "react";
import { useWarehouses } from "@/context/WarehousesContext";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Alert, Button, Checkbox, createTheme, MantineProvider, NumberInput, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import ImgController from "@/components/ui/img-controller";

const theme = createTheme({
  cursorType: "pointer",
});

export default function WarehouseModal({
  opened,
  close,
  warehouseToUpdate,
  setWarehouseToUpdate,
}: {
  opened: boolean;
  close: () => void;
  warehouseToUpdate: Warehouse | null;
  setWarehouseToUpdate: React.Dispatch<React.SetStateAction<Warehouse | null>>;
}) {
  const { language, translate, translations } = useLanguage();

  const { setData: setWarehouses } = useWarehouses();

  const [image, setImage] = useState<File | string | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [balance, setBalance] = useState<string | number>("");
  const [isDefault, setIsDefault] = useState(false);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (warehouseToUpdate) {
      setImage(warehouseToUpdate.image);
      setName(warehouseToUpdate.name);
      setLocation(warehouseToUpdate.location);
      setBalance(warehouseToUpdate.balance);
      setIsDefault(warehouseToUpdate.isDefault);
    } else reset();
  }, [warehouseToUpdate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData();

    if (image) formData.append("image", image);
    else formData.append("image", String(null));
    formData.append("name", name);
    formData.append("location", location);
    formData.append("isDefault", String(isDefault));
    if (!warehouseToUpdate) formData.append("balance", String(balance));

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        method: warehouseToUpdate ? "PUT" : "POST",
        url: warehouseToUpdate ? `warehouses/${warehouseToUpdate._id}` : "warehouses",
        data: formData,
        language,
      });

      // Is new default warehouse
      if ((!warehouseToUpdate && res.data.isDefault) || (!warehouseToUpdate?.isDefault && res.data.isDefault)) {
        setWarehouses((prev) => prev.map((warehouse) => ({ ...warehouse, isDefault: false })));
      }

      setWarehouses((prev) =>
        warehouseToUpdate
          ? prev.map((warehouse) => (warehouse._id === warehouseToUpdate._id ? res.data : warehouse))
          : [res.data, ...prev],
      );

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      if (warehouseToUpdate) setWarehouseToUpdate(null);
      else reset();
      setError("");
    }, 250);
  }

  function reset() {
    setImage(null);
    setName("");
    setLocation("");
    setBalance("");
    setIsDefault(false);
  }

  const title = translate(
    `${warehouseToUpdate ? "Update" : "Add"} Warehouse`,
    `${warehouseToUpdate ? "تحديث الفرع" : "إضافة فرع"}`,
  );

  const dataChanged = warehouseToUpdate
    ? image !== warehouseToUpdate.image ||
      name !== warehouseToUpdate.name ||
      location !== warehouseToUpdate.location ||
      isDefault !== warehouseToUpdate.isDefault
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs sm:text-sm">
            {translate("Please upload a squared image for the warehouse.", "يرجى تحميل صورة مربعة للفرع.")}{" "}
          </p>
          <ImgController image={image} setImage={setImage} mini className="aspect-square w-[200px]" />
        </div>

        <TextInput
          label={translate("Name", "الاسم")}
          placeholder={translate("Name", "الاسم")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <TextInput
          label={translate("Location", "الموقع")}
          placeholder={translate("Location", "الموقع")}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          required
        />

        {!warehouseToUpdate && (
          <NumberInput
            label={translate("Opening Balance", "رصيد الافتتاح")}
            placeholder={translate("Opening Balance", "رصيد الافتتاح")}
            value={balance}
            onChange={(value) => setBalance(value)}
            required
            hideControls
          />
        )}

        {warehouseToUpdate?.isDefault ? (
          <Alert color="indigo" icon={<solidIcons.ExclamationCircle />}>
            {translate("This is the default (main) warehouse.", "هذا هو الفرع الافتراضي (الرئيسي).")}
          </Alert>
        ) : (
          <MantineProvider theme={theme}>
            <Checkbox
              label={translate("Set as default warehouse", "تعيين كفرع افتراضي")}
              checked={isDefault}
              onChange={(e) => setIsDefault(e.currentTarget.checked)}
            />
          </MantineProvider>
        )}

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!name || !location || (warehouseToUpdate ? !dataChanged : balance === "")}
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
