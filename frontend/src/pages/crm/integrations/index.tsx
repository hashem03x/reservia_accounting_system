import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { Alert, Badge, Button, Select, Table, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import copyToClipboard from "@/utils/helpers/copy-to-clipboard";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import Modal from "@/components/ui/modal";
import DeleteModal from "@/components/ui/delete-modal";
import { solidIcons } from "@/components/icons";
import { CrmIntakeEvent, CrmIntegrationChannel, CrmIntegrationKey, CrmIntegrationState, CrmIntegrationStatus } from "@/types/crm";
import { formatCairoDateTime } from "../_shared/business-date";

// Reservia CRM - the five lead doors (Change Request 2, section 4) for MD/Admin: whether each one
// is configured and actually receiving leads, its API keys, and recent deliveries. A door is only
// ever shown as "Receiving" once a REAL lead has been processed through it - configuration alone
// is "Waiting for the first lead", never "operational". Secret values are never displayed: only
// whether each server setting is present.

const CHANNELS: { value: CrmIntegrationChannel; label: string }[] = [
  { value: "website", label: "Website form" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meta", label: "Meta Lead Ads" },
  { value: "tiktok", label: "TikTok Lead Generation" },
  { value: "google_ads", label: "Google Ads lead form" },
];

const STATE_BADGE: Record<CrmIntegrationState, { color: string; en: string; ar: string }> = {
  not_configured: { color: "gray", en: "Not configured", ar: "غير مُعد" },
  awaiting_first_event: { color: "yellow", en: "Waiting for the first lead", ar: "بانتظار أول عميل" },
  receiving: { color: "teal", en: "Receiving leads", ar: "يستقبل العملاء" },
  errors: { color: "red", en: "Errors in the last 7 days", ar: "أخطاء خلال 7 أيام" },
};

const EVENT_COLOR: Record<CrmIntakeEvent["status"], string> = { processed: "teal", failed: "red", ignored: "gray", processing: "blue" };

const apiBase = () => String(import.meta.env.VITE_API_URL || "").replace(/\/api\/v1\/?$/, "");

export default function CrmIntegrations() {
  const { language, translate } = useLanguage();
  const { systems } = useSystemAccess();
  const isMd = systems?.CRM?.role === "md";
  useDocumentTitle(`${translate("Integrations", "التكاملات")} | Reservia CRM`);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<{
    status: CrmIntegrationStatus;
    keys: CrmIntegrationKey[];
    events: CrmIntakeEvent[];
  } | null>({ initialData: null, initialLoading: true });

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const [status, keys, events] = await Promise.all([
        privateRequest({ url: "crm/integrations/status", language }),
        privateRequest({ url: "crm/integrations/keys", language }),
        privateRequest({ url: "crm/integrations/events", params: { limit: "50" }, language }),
      ]);
      setData({ status: status.data, keys: keys.data, events: events.data });
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Lead integrations", "تكاملات العملاء المحتملين"),
        subTitle: translate("The five doors into the CRM and their health", "الأبواب الخمسة إلى النظام وحالتها"),
        sideElements: (
          <Button variant="light" color="teal" onClick={load}>
            {translate("Refresh", "تحديث")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading integrations...", "جاري تحميل التكاملات...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Could not load integrations", "تعذر تحميل التكاملات")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        data && (
          <div className="flex flex-col gap-5">
            {data.status.assignmentPoolSize === 0 && (
              <Alert color="red" variant="light" title={translate("No one to assign new leads to", "لا يوجد من يُسند إليه العملاء الجدد")}>
                {translate(
                  "No active user has the CRM 'sales' role, so leads from the website, WhatsApp, ad forms and CSV imports will arrive UNASSIGNED and nobody will be notified. Grant the sales role in User Management.",
                  "لا يوجد مستخدم نشط بدور 'مبيعات' في النظام، لذا ستصل العملاء من الموقع وواتساب ونماذج الإعلانات والاستيراد دون مسؤول ولن يُخطَر أحد. امنح دور المبيعات من إدارة المستخدمين.",
                )}
              </Alert>
            )}
            <StatusTable status={data.status} />
            <KeysSection keys={data.keys} isMd={isMd} onChanged={load} />
            <EventsSection events={data.events} />
            <EndpointsSection endpoints={data.status.endpoints} />
          </div>
        )
      )}
    </AdminLayoutBox>
  );
}

function Section({ title, children, side }: { title: string; children: ReactNode; side?: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-100 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#00656A]">{title}</h3>
        {side}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function StatusTable({ status }: { status: CrmIntegrationStatus }) {
  const { language, translate } = useLanguage();
  return (
    <Section title={translate("Status", "الحالة")}>
      <Table verticalSpacing="xs" fz="sm" miw={720}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{translate("Door", "الباب")}</Table.Th>
            <Table.Th>{translate("State", "الحالة")}</Table.Th>
            <Table.Th>{translate("Source given to leads", "المصدر")}</Table.Th>
            <Table.Th>{translate("Server settings", "إعدادات الخادم")}</Table.Th>
            <Table.Th className="text-right">{translate("Keys", "المفاتيح")}</Table.Th>
            <Table.Th>{translate("Last lead", "آخر عميل")}</Table.Th>
            <Table.Th className="text-right">{translate("7 days: ok / failed / ignored", "7 أيام: ناجح / فشل / تجاهل")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {status.channels.map(c => {
            const badge = STATE_BADGE[c.state];
            return (
              <Table.Tr key={c.channel}>
                <Table.Td className="font-medium">{c.label}</Table.Td>
                <Table.Td>
                  <Badge color={badge.color} variant="light">
                    {translate(badge.en, badge.ar)}
                  </Badge>
                </Table.Td>
                <Table.Td className="text-gray-600">{c.source || (c.channel === "website" ? translate("From UTM", "من UTM") : c.channel === "whatsapp" ? translate("Ref code, else WhatsApp Direct", "رمز المرجع وإلا واتساب مباشر") : translate("From the file", "من الملف"))}</Table.Td>
                <Table.Td>
                  {c.settings.length === 0 ? (
                    <span className="text-xs text-gray-400">{c.channel === "website" || c.channel === "csv" ? translate("none needed", "لا يلزم") : translate("API key only", "مفتاح فقط")}</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.settings.map(s => (
                        <Tooltip key={s.name} label={s.set ? translate("Set on the server", "مُعد على الخادم") : translate("Missing - set it in the backend environment", "مفقود - أضفه إلى بيئة الخادم")}>
                          <Badge size="xs" variant="outline" color={s.set ? "teal" : "red"} className="font-mono normal-case">
                            {s.set ? "✓" : "✗"} {s.name}
                          </Badge>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </Table.Td>
                <Table.Td className="text-right">{c.channel === "csv" ? "-" : c.activeKeys}</Table.Td>
                <Table.Td className="whitespace-nowrap text-gray-600">{c.lastProcessedAt ? formatCairoDateTime(c.lastProcessedAt, language) : translate("never", "أبداً")}</Table.Td>
                <Table.Td className="text-right tabular-nums">
                  {c.last7Days.processed} / <span className={c.last7Days.failed ? "font-semibold text-red-600" : ""}>{c.last7Days.failed}</span> / {c.last7Days.ignored}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Section>
  );
}

function KeysSection({ keys, isMd, onChanged }: { keys: CrmIntegrationKey[]; isMd: boolean; onChanged: () => void }) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [channel, setChannel] = useState<CrmIntegrationChannel | "">("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<CrmIntegrationKey | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  async function create() {
    if (!channel) return;
    setCreating(true);
    try {
      const res = await privateRequest({ url: "crm/integrations/keys", method: "POST", data: { channel, label: label.trim() }, language });
      setNewKey(res.data.key);
      setChannel("");
      setLabel("");
      onChanged();
    } catch (err) {
      notifyError({ language, message: (err as { message?: string })?.message || translate("Could not create the key.", "تعذر إنشاء المفتاح.") });
    } finally {
      setCreating(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setRevokeLoading(true);
    try {
      await privateRequest({ url: `crm/integrations/keys/${revoking._id}/revoke`, method: "PATCH", language });
      notifySuccess({ language, message: translate("Key revoked - it stops working immediately.", "تم إلغاء المفتاح - يتوقف فوراً.") });
      setRevoking(null);
      onChanged();
    } catch (err) {
      notifyError({ language, message: (err as { message?: string })?.message || translate("Could not revoke the key.", "تعذر إلغاء المفتاح.") });
    } finally {
      setRevokeLoading(false);
    }
  }

  function closeCreateModal() {
    closeCreate();
    setNewKey(null);
    setCopied(false);
  }

  return (
    <Section
      title={translate("API keys", "مفاتيح الواجهة")}
      side={
        isMd ? (
          <Button size="xs" color="teal" leftSection={<solidIcons.Plus size={12} />} onClick={openCreate}>
            {translate("New key", "مفتاح جديد")}
          </Button>
        ) : (
          <span className="text-xs text-gray-400">{translate("Only the MD can create or revoke keys.", "المدير العام فقط يمكنه إنشاء أو إلغاء المفاتيح.")}</span>
        )
      }
    >
      {keys.length === 0 ? (
        <p className="text-sm text-gray-400">{translate("No keys yet. Each external sender (TikTok relay, Google Ads form, Cangrow) needs its own key.", "لا توجد مفاتيح بعد. كل مُرسل خارجي يحتاج مفتاحه الخاص.")}</p>
      ) : (
        <Table verticalSpacing="xs" fz="sm" miw={640}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Channel", "القناة")}</Table.Th>
              <Table.Th>{translate("Label", "الوصف")}</Table.Th>
              <Table.Th>{translate("Key", "المفتاح")}</Table.Th>
              <Table.Th>{translate("Created", "أُنشئ")}</Table.Th>
              <Table.Th>{translate("Last used", "آخر استخدام")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {keys.map(k => (
              <Table.Tr key={k._id} className={k.active ? "" : "opacity-50"}>
                <Table.Td>{CHANNELS.find(c => c.value === k.channel)?.label || k.channel}</Table.Td>
                <Table.Td>{k.label || "-"}</Table.Td>
                <Table.Td className="font-mono text-xs">
                  rsv_{k.channel}_{k.keyId}.…{k.hint}
                </Table.Td>
                <Table.Td className="whitespace-nowrap text-xs text-gray-500">
                  {formatCairoDateTime(k.createdAt, language)}
                  {k.createdBy?.name ? ` - ${k.createdBy.name}` : ""}
                </Table.Td>
                <Table.Td className="whitespace-nowrap text-xs text-gray-500">{k.lastUsedAt ? formatCairoDateTime(k.lastUsedAt, language) : translate("never", "أبداً")}</Table.Td>
                <Table.Td className="text-right">
                  {k.active ? (
                    isMd && (
                      <Button size="compact-xs" variant="light" color="red" onClick={() => setRevoking(k)}>
                        {translate("Revoke", "إلغاء")}
                      </Button>
                    )
                  ) : (
                    <Badge size="xs" color="gray" variant="light">
                      {translate("Revoked", "ملغى")} {k.revokedAt ? formatCairoDateTime(k.revokedAt, language) : ""}
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={createOpened} onClose={closeCreateModal} title={translate("New integration key", "مفتاح تكامل جديد")} size="md">
        {newKey ? (
          <div className="flex flex-col gap-3">
            <Alert color="orange" variant="light" title={translate("Copy this key now", "انسخ هذا المفتاح الآن")}>
              {translate(
                "This is the only time it is shown. Store it in the sender's settings (never in website code). If it is lost, create a new key and revoke this one.",
                "هذه هي المرة الوحيدة التي يظهر فيها. احفظه في إعدادات المُرسل (وليس في كود الموقع). إذا فُقد، أنشئ مفتاحاً جديداً وألغِ هذا.",
              )}
            </Alert>
            <code className="break-all rounded bg-gray-100 p-2 text-xs" dir="ltr">
              {newKey}
            </code>
            <Button onClick={() => copyToClipboard(newKey, setCopied)} color="teal" leftSection={copied ? <solidIcons.Check size={12} /> : undefined}>
              {copied ? translate("Copied", "تم النسخ") : translate("Copy key", "نسخ المفتاح")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Select label={translate("Channel", "القناة")} data={CHANNELS} value={channel || null} onChange={v => setChannel((v as CrmIntegrationChannel) || "")} required />
            <TextInput label={translate("Label", "الوصف")} placeholder={translate("e.g. Cangrow TikTok relay", "مثال: وسيط تيك توك من كانجرو")} value={label} onChange={e => setLabel(e.target.value)} maxLength={100} />
            <p className="text-xs text-gray-400">
              {translate("A key only works for its own channel. To rotate a key, create a new one, switch the sender over, then revoke the old one.", "المفتاح يعمل لقناته فقط. للتدوير: أنشئ مفتاحاً جديداً، حدّث المُرسل، ثم ألغِ القديم.")}
            </p>
            <Button onClick={create} loading={creating} disabled={!channel} color="teal">
              {translate("Create key", "إنشاء المفتاح")}
            </Button>
          </div>
        )}
      </Modal>

      <DeleteModal
        opened={!!revoking}
        onClose={() => setRevoking(null)}
        title={translate("Revoke this key?", "إلغاء هذا المفتاح؟")}
        subTitle={translate("Anything still using it will be rejected immediately. This cannot be undone.", "أي مُرسل يستخدمه سيُرفض فوراً. لا يمكن التراجع.")}
        action={revoke}
        loading={revokeLoading}
        error=""
      />
    </Section>
  );
}

function EventsSection({ events }: { events: CrmIntakeEvent[] }) {
  const { language, translate } = useLanguage();
  return (
    <Section title={translate("Recent deliveries", "آخر الإرسالات")}>
      {events.length === 0 ? (
        <p className="text-sm text-gray-400">{translate("No deliveries recorded yet.", "لا توجد إرسالات مسجلة بعد.")}</p>
      ) : (
        <Table verticalSpacing={4} fz="xs" miw={640}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Received", "الاستلام")}</Table.Th>
              <Table.Th>{translate("Channel", "القناة")}</Table.Th>
              <Table.Th>{translate("Result", "النتيجة")}</Table.Th>
              <Table.Th>{translate("Lead", "العميل")}</Table.Th>
              <Table.Th>{translate("Details", "التفاصيل")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {events.map(e => (
              <Table.Tr key={e._id}>
                <Table.Td className="whitespace-nowrap">{formatCairoDateTime(e.createdAt, language)}</Table.Td>
                <Table.Td>{e.channel}</Table.Td>
                <Table.Td>
                  <Badge size="xs" color={EVENT_COLOR[e.status]} variant="light">
                    {e.status}
                    {e.status === "processed" ? (e.leadCreated ? ` - ${translate("new lead", "عميل جديد")}` : ` - ${translate("merged", "دُمج")}`) : ""}
                  </Badge>
                </Table.Td>
                <Table.Td>{e.lead ? <Link className="font-mono text-teal-700 hover:underline" to={`/${paths.crm}/${paths.leads}/${e.lead._id}`}>{e.lead.refCode}</Link> : "-"}</Table.Td>
                <Table.Td className="text-gray-500">
                  {e.lastError || e.ignoredReason || (e.attempts > 1 ? translate(`${e.attempts} attempts`, `${e.attempts} محاولات`) : "")}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Section>
  );
}

function EndpointsSection({ endpoints }: { endpoints: Record<string, string> }) {
  const { translate } = useLanguage();
  const rows: [string, string, string][] = [
    [translate("Unified intake (any channel, X-Api-Key)", "الاستقبال الموحد (أي قناة، X-Api-Key)"), "POST", endpoints.unified],
    [translate("Meta Lead Ads webhook", "ويب هوك إعلانات ميتا"), "GET/POST", endpoints.metaWebhook],
    [translate("WhatsApp Cloud API webhook", "ويب هوك واتساب"), "GET/POST", endpoints.whatsappWebhook],
    [translate("Google Ads lead form webhook (google_key = a google_ads key)", "ويب هوك نموذج جوجل (google_key)"), "POST", endpoints.googleAdsWebhook],
    [translate("Website form (public, existing)", "نموذج الموقع (عام، قائم)"), "POST", endpoints.websiteForm],
  ];
  return (
    <Section title={translate("Endpoints to give each platform", "العناوين لكل منصة")}>
      <Table verticalSpacing={4} fz="xs" miw={560}>
        <Table.Tbody>
          {rows.map(([name, method, url]) => (
            <Table.Tr key={url}>
              <Table.Td>{name}</Table.Td>
              <Table.Td className="font-mono">{method}</Table.Td>
              <Table.Td className="break-all font-mono" dir="ltr">
                {apiBase()}
                {url}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <p className="mt-2 text-xs text-gray-400">
        {translate("Full setup steps per platform: docs/crm-integrations.md in the repository.", "خطوات الإعداد الكاملة لكل منصة: docs/crm-integrations.md في المستودع.")}
      </p>
    </Section>
  );
}
