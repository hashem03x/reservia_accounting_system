import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Button, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import Img from "@/components/ui/img";
import scannerImg from "@/assets/scanner.png";
import useDataHandler from "@/hooks/useDataHandler";
import { PurchaseOrder } from "@/types/orders";
import handleRequest from "@/utils/helpers/handle-request";
import ErrorAlert from "@/components/ui/error-alert";

const CODE_LENGTH = 12;
const ID_LENGTH = 24;

export default function ScannerModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { translate, translations, language } = useLanguage();

  const [code, setCode] = useState("");
  const [id, setId] = useState("");

  const navigate = useNavigate();

  function handleClose() {
    close();
    setTimeout(() => setCode(""), 250);
  }

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<PurchaseOrder | null>({
    initialData: null,
  });

  async function getOrderByCode(code: string) {
    await handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({ url: `purchaseorder/code/${code}`, language });
      navigate(response.data._id);
    });
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Scan Order Barcode", "مسح باركود الطلب")}>
      <div className="flex flex-col gap-3">
        <div className="flex-center rounded-lg bg-gray-100 px-4 py-8">
          <Img src={scannerImg} alt="Scanner" className="h-24 w-24 animate-pulse" />
        </div>
        <TextInput
          label={translate(`Order Code (${CODE_LENGTH} digits)`, `كود الطلب (${CODE_LENGTH} أرقام)`)}
          placeholder={translate(
            `Scan the order barcode or manually enter it.`,
            `امسح باركود الطلب أو أدخل كود الطلب يدويًا.`,
          )}
          value={code}
          maxLength={CODE_LENGTH}
          onChange={(e) => {
            const value = e.currentTarget.value;
            setCode(value);
            if (value.length === CODE_LENGTH) getOrderByCode(value);
          }}
          disabled={loading}
        />

        <TextInput
          label={translate(`Order ID (${ID_LENGTH} digits)`, `معرف الطلب (${ID_LENGTH} أرقام)`)}
          placeholder={translate(`Or enter the order ID.`, `أو أدخل معرف الطلب.`)}
          value={id}
          maxLength={ID_LENGTH}
          onChange={(e) => {
            const value = e.currentTarget.value;
            setId(value);
            if (value.length === ID_LENGTH) navigate(value);
          }}
          disabled={loading}
        />

        <Button onClick={handleClose} variant="light" color="dark" fullWidth>
          {translations.cancel}
        </Button>

        {error && <ErrorAlert error={error} />}
      </div>
    </Modal>
  );
}
