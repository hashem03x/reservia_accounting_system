import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { CompanyCapital } from "@/types/company-capital";
import { Button, NumberInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function IssuedCapitalModal({ opened, close, capital, onSaved }: { opened: boolean; close: () => void; capital: CompanyCapital; onSaved: () => void }) {
  const { language, translate } = useLanguage();
  const [issuedCapital, setIssuedCapital] = useState<string | number>("");
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    setIssuedCapital(capital?.issuedCapital ?? "");
    setError("");
  }, [opened, capital]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ language, method: "PATCH", url: "shareholders/company-capital", data: { issuedCapital } });
      onSaved();
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Issued Capital", "رأس المال المصدر")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}
        <NumberInput
          label={translate("Issued Capital - EGP", "رأس المال المصدر - جنيه")}
          description={translate(
            "The total officially issued company capital. Cannot be set below what shareholders have already paid in.",
            "إجمالي رأس المال المصدر رسميًا للشركة. لا يمكن تحديده بأقل مما سدده المساهمون بالفعل.",
          )}
          value={issuedCapital}
          onChange={setIssuedCapital}
          min={0.01}
          decimalScale={2}
          thousandSeparator
          required
          autoFocus
        />
        <Button type="submit" loading={loading} disabled={!(typeof issuedCapital === "number" && issuedCapital > 0)}>
          {translate("Save", "حفظ")}
        </Button>
      </form>
    </Modal>
  );
}
