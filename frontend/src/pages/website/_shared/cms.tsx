import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import Modal from "@/components/ui/modal";
import { hasWebsiteCapability, SectionRegistry, WebsiteCapability, WebsiteRole } from "@/types/website";

// Website Management - small shared building blocks for the CMS screens: the role/capability
// hook, an API helper that reports errors the same way everywhere, a promise-based confirm dialog
// (destructive actions always ask first) and the section registry, loaded once from the backend.

export function useWebsiteRole() {
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;
  const can = useCallback((c: WebsiteCapability) => hasWebsiteCapability(role, c), [role]);
  return { role, can };
}

export const errorMessage = (err: unknown, fallback: string) => {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  const e = err as { message?: string; errors?: { msg?: string }[] };
  if (Array.isArray(e.errors) && e.errors[0]?.msg) return e.errors.map((x) => x.msg).join(" · ");
  return e.message || fallback;
};

/** `call` runs a request, shows a success toast (optional) and an error toast on failure; returns the body or null. */
export function useCmsApi() {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const call = useCallback(
    async <T = unknown,>(
      opts: { url: string; method?: string; data?: unknown; params?: Record<string, unknown> },
      messages: { success?: string; error?: string; silent?: boolean } = {},
    ): Promise<{ data: T; message?: string; results?: number; paginationResult?: unknown } | null> => {
      try {
        const res = await privateRequest({ url: opts.url, method: opts.method || "GET", data: (opts.data as never) ?? null, params: (opts.params as never) || {}, language });
        if (messages.success) notifySuccess({ language, message: messages.success === "server" ? res?.message || "" : messages.success });
        return res;
      } catch (err) {
        if (!messages.silent) notifyError({ language, message: errorMessage(err, messages.error || translate("Something went wrong", "حدث خطأ ما")) });
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );
  return { call, privateRequest, language, translate };
}

// ---------------- confirm dialog ----------------
type ConfirmOptions = { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { translate } = useLanguage();
  const [state, setState] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  const resolver = useRef<(v: boolean) => void>();
  const confirm = useCallback((o: ConfirmOptions) => {
    setState({ ...o, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const close = (v: boolean) => {
    resolver.current?.(v);
    setState((s) => (s ? { ...s, open: false } : s));
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* Above every website-module overlay (the Visual Editor is z-150, its drawers z-400): a confirmation always belongs on top of whatever asked for it. */}
      <Modal opened={!!state?.open} onClose={() => close(false)} title={state?.title || ""} size="sm" zIndex={1000}>
        <div className="flex flex-col gap-4" data-testid="confirm-dialog">
          <div className="text-sm text-gray-700">{state?.message}</div>
          <div className="flex justify-end gap-2">
            <Button variant="default" onClick={() => close(false)}>
              {translate("Cancel", "إلغاء")}
            </Button>
            <Button color={state?.danger ? "red" : "teal"} onClick={() => close(true)} data-testid="confirm-ok">
              {state?.confirmLabel || translate("Confirm", "تأكيد")}
            </Button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ---------------- section registry ----------------
let registryCache: SectionRegistry | null = null;
let registryPromise: Promise<SectionRegistry | null> | null = null;

export function useSectionRegistry() {
  const { privateRequest, language } = useCmsApi();
  const [registry, setRegistry] = useState<SectionRegistry | null>(registryCache);
  const [error, setError] = useState("");
  useEffect(() => {
    if (registryCache) return;
    registryPromise =
      registryPromise ||
      privateRequest({ url: "website/section-types", language })
        .then((r: { data: SectionRegistry }) => (registryCache = r.data))
        .catch((e: unknown) => {
          registryPromise = null;
          throw e;
        });
    registryPromise.then((r) => setRegistry(r)).catch((e) => setError(errorMessage(e, "Could not load section types")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { registry, error };
}

// ---------------- unsaved changes ----------------
/** Warns before leaving the browser tab while `dirty`. */
export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

export const formatBytes = (n?: number | null) => {
  if (!n) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export function Panel({ title, children, side, description }: { title: string; children: ReactNode; side?: ReactNode; description?: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
        {side}
      </div>
      {children}
    </section>
  );
}
