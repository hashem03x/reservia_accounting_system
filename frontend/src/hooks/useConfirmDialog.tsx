import { useCallback, useRef, useState } from "react";
import { Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";

type ConfirmOptions = { message: string; title?: string; confirmLabel?: string; danger?: boolean };

/**
 * ERP CHG-13: an in-app replacement for window.confirm(). Native dialogs can be suppressed by the
 * browser (or by test tools), and the click then silently does nothing. Usage:
 *
 *   const { confirm, dialog } = useConfirmDialog();
 *   if (!(await confirm({ message: "Cancel this order?" }))) return;
 *   ...
 *   return <>{dialog}...</>;
 */
export default function useConfirmDialog() {
  const { translate } = useLanguage();
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setState(o);
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };

  const dialog = (
    <Modal
      opened={!!state}
      onClose={() => close(false)}
      title={state?.title || translate("Please confirm", "يرجى التأكيد")}
      size="sm"
      zIndex={1000}
    >
      <div className="flex flex-col gap-4" data-testid="app-confirm-dialog">
        <p className="text-sm text-gray-700">{state?.message}</p>
        <div className="flex gap-2">
          <Button variant="light" color="dark" fullWidth onClick={() => close(false)} data-testid="app-confirm-cancel">
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button color={state?.danger ? "red" : "teal"} fullWidth onClick={() => close(true)} data-testid="app-confirm-ok">
            {state?.confirmLabel || translate("Confirm", "تأكيد")}
          </Button>
        </div>
      </div>
    </Modal>
  );

  return { confirm, dialog };
}
