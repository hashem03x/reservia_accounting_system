import { useState } from "react";
import { Alert, Badge, Button, PasswordInput, Switch, TextInput } from "@mantine/core";
import errorMessage from "@/utils/helpers/error-message";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { CrmIntegrationState, CrmIntegrationStatusRow } from "@/types/crm";
import { formatCairoDateTime } from "../../_shared/business-date";

export const STATE_BADGE: Record<CrmIntegrationState, { color: string; en: string; ar: string }> = {
  not_configured: { color: "gray", en: "Not configured", ar: "غير مُعد" },
  awaiting_verification: { color: "yellow", en: "Awaiting verification", ar: "بانتظار التحقق" },
  connected: { color: "teal", en: "Connected", ar: "متصل" },
  error: { color: "red", en: "Error", ar: "خطأ" },
  disabled: { color: "dark", en: "Disabled", ar: "معطل" },
};

/**
 * One integration's configuration card (CRM C6). Secret fields are write-only: the page shows
 * "set (from the page / from the server environment)" and a 4-character hint, never the value; a
 * saved secret is replaced by typing a new one, cleared with "Clear". "Test connection" makes a real
 * authenticated API call on the server. The badge reflects what has been VERIFIED, never just
 * "credentials were entered".
 */
export default function ChannelConfig({ row, isMd, canTest, webhookUrl, onChanged }: { row: CrmIntegrationStatusRow; isMd: boolean; canTest: boolean; webhookUrl?: string; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<"" | "save" | "test" | "toggle">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const badge = STATE_BADGE[row.state];
  const dirty = Object.keys(draft).length > 0;

  async function run(kind: "save" | "test" | "toggle", fn: () => Promise<{ message?: string; success?: boolean }>) {
    setBusy(kind);
    setMessage(null);
    try {
      const res = await fn();
      setMessage({ ok: res.success !== false, text: res.message || translate("Done.", "تم.") });
      if (kind === "save") setDraft({});
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-gray-800">{row.label}</h4>
          <Badge color={badge.color} variant="light">{translate(badge.en, badge.ar)}</Badge>
        </div>
        {isMd && (
          <Switch
            size="sm"
            label={translate("Enabled", "مفعل")}
            checked={row.enabled}
            disabled={busy !== ""}
            onChange={(e) => run("toggle", () => privateRequest({ url: `crm/integrations/settings/${row.channel}/enabled`, method: "PATCH", data: { enabled: e.currentTarget.checked }, language }))}
          />
        )}
      </div>

      <div className="mb-2 grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-3">
        <span>{translate("Last success", "آخر نجاح")}: {row.lastSuccessAt ? formatCairoDateTime(row.lastSuccessAt, language) : translate("never", "أبداً")}</span>
        <span>{translate("Webhook verified", "تحقق الويب هوك")}: {row.webhookVerifiedAt ? formatCairoDateTime(row.webhookVerifiedAt, language) : "-"}</span>
        <span>{translate("Last test", "آخر اختبار")}: {row.lastTest ? `${row.lastTest.ok ? "OK" : translate("failed", "فشل")} - ${formatCairoDateTime(row.lastTest.at, language)}` : "-"}</span>
      </div>
      {row.lastError?.message && row.state === "error" && <Alert color="red" variant="light" mb="xs" p="xs">{row.lastError.message}</Alert>}
      {row.lastTest?.message && row.lastTest.ok && <p className="mb-2 text-xs text-teal-700">{row.lastTest.message}</p>}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {row.settings.map((s) => {
          const current = s.set ? (s.secret ? `${translate("set", "مُعد")} ${s.display || ""} (${s.source === "env" ? translate("server env", "بيئة الخادم") : translate("saved here", "محفوظ هنا")})` : s.display || "") : translate("not set", "غير مُعد");
          const label = `${s.label}${s.required ? " *" : ""}`;
          const value = draft[s.key] ?? "";
          const common = {
            size: "xs" as const,
            label,
            description: `${s.env} - ${current}`,
            value: value || "",
            disabled: !isMd,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [s.key]: e.currentTarget.value })),
            placeholder: s.secret ? (s.set ? translate("Leave blank to keep the current value", "اتركه فارغاً للإبقاء على القيمة الحالية") : "") : s.display || "",
          };
          return (
            <div key={s.key} className="flex items-end gap-1">
              <div className="flex-1">{s.secret ? <PasswordInput {...common} autoComplete="new-password" /> : <TextInput {...common} />}</div>
              {isMd && s.source === "page" && (
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => setDraft((d) => ({ ...d, [s.key]: null }))}>
                  {translate("Clear", "مسح")}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {webhookUrl && (
        <p className="mt-2 break-all text-xs text-gray-500">
          {translate("Webhook / callback URL", "رابط الويب هوك")}: <code>{webhookUrl}</code>
        </p>
      )}
      {row.setup.length > 0 && (
        <details className="mt-2 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium">{translate("Setup instructions", "تعليمات الإعداد")}</summary>
          <ol className="mt-1 list-decimal space-y-1 ps-5">
            {row.setup.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </details>
      )}

      {message && <p className={`mt-2 text-xs ${message.ok ? "text-teal-700" : "text-red-600"}`}>{message.text}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {isMd && (
          <Button
            size="xs"
            color="teal"
            disabled={!dirty}
            loading={busy === "save"}
            onClick={() => {
              const values = Object.fromEntries(Object.entries(draft).filter(([, v]) => v === null || (typeof v === "string" && v.trim() !== "")));
              return run("save", () => privateRequest({ url: `crm/integrations/settings/${row.channel}`, method: "PUT", data: { values }, language }));
            }}
          >
            {translate("Save settings", "حفظ الإعدادات")}
          </Button>
        )}
        {canTest && (
          <Button size="xs" variant="light" loading={busy === "test"} onClick={() => run("test", () => privateRequest({ url: `crm/integrations/settings/${row.channel}/test`, method: "POST", language }))}>
            {translate("Test connection", "اختبار الاتصال")}
          </Button>
        )}
      </div>
    </div>
  );
}
