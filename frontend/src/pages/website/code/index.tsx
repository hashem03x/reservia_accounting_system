import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Loader, Table, Textarea, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { Panel, useBeforeUnload, useCmsApi, useConfirm, useWebsiteRole } from "../_shared/cms";

// Website Management - Code workspace (administrators only; the server enforces code.manage on
// every request and publish to go live). Changes to the website's source files are commits on a
// separate work branch, never on production; the hosting provider builds a preview of that branch;
// going live is an explicit pull request + merge. Any file can be restored to an earlier version,
// and all unpublished changes can be discarded.

type Status = {
  configured: boolean;
  repo?: string;
  base?: string;
  work?: string;
  workExists?: boolean;
  aheadBy?: number;
  behindBy?: number;
  commits?: { sha: string; message: string; author: string; date: string }[];
  files?: { path: string; status: string; additions: number; deletions: number }[];
  pullRequest?: { number: number; url: string; title: string } | null;
  checks?: { state: string; statuses: { context: string; state: string; description: string; url: string }[] } | null;
  preview?: { state: string; url: string | null; createdAt: string } | null;
};

export default function WebsiteCodeWorkspace() {
  const { language, translate } = useLanguage();
  const { call } = useCmsApi();
  const confirm = useConfirm();
  const { can } = useWebsiteRole();
  useDocumentTitle(`${translate("Code", "الكود المصدري")} | Reservia Website`);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<{ path: string; size: number }[]>([]);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<{ path: string; sha: string; content: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<{ sha: string; message: string; author: string; date: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const dirty = !!open && draft !== open.content;
  useBeforeUnload(dirty);

  async function load() {
    const s = await call<Status>({ url: "website/code/status" }, { silent: true });
    if (!s) {
      setError(translate("The code workspace could not be loaded.", "تعذر تحميل مساحة الكود."));
      return;
    }
    setStatus(s.data);
    if (s.data.configured) {
      const f = await call<{ files: { path: string; size: number }[] }>({ url: "website/code/files" });
      setFiles(f?.data.files || []);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openFile(path: string) {
    if (dirty && !(await confirm({ title: translate("Discard unsaved edits?", "تجاهل التعديلات غير المحفوظة؟"), message: open?.path || "", danger: true, confirmLabel: translate("Discard", "تجاهل") }))) return;
    const [f, h] = await Promise.all([call<{ path: string; sha: string; content: string }>({ url: "website/code/file", params: { path } }), call<typeof history>({ url: "website/code/history", params: { path } }, { silent: true })]);
    if (f) {
      setOpen(f.data);
      setDraft(f.data.content);
      setMessage("");
    }
    setHistory(h?.data || []);
  }

  async function saveFile() {
    if (!open) return;
    setBusy(true);
    const r = await call<{ sha: string }>({ url: "website/code/file", method: "PUT", data: { path: open.path, content: draft, sha: open.sha, message: message || `Edit ${open.path}` } }, { success: "server" });
    setBusy(false);
    if (r) {
      setOpen({ ...open, content: draft, sha: r.data.sha });
      load();
      openFile(open.path);
    }
  }

  const shown = useMemo(() => files.filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())), [files, filter]);
  const changed = new Set((status?.files || []).map((f) => f.path));

  return (
    <AdminLayoutBox header={{ title: translate("Code", "الكود المصدري"), subTitle: translate("Advanced: edit the website's source files on a separate branch, check the preview build, then publish.", "متقدم: عدّل ملفات الموقع المصدرية على فرع منفصل وتحقق من نسخة المعاينة ثم انشر.") }}>
      {error ? (
        <Alert color="red">{error}</Alert>
      ) : !status ? (
        <Loader size="sm" />
      ) : !status.configured ? (
        <Alert color="yellow" variant="light" title={translate("Not connected to the website repository", "غير متصل بمستودع الموقع")} data-testid="code-not-configured">
          {translate(
            "Ask your system administrator to connect the website's code repository on the server. Until then, use the Visual Editor and Custom Code for website changes.",
            "اطلب من مسؤول النظام ربط مستودع كود الموقع على الخادم. حتى ذلك الحين استخدم المحرر المرئي والكود المخصص.",
          )}
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <Alert color="orange" variant="light">
            {translate("Changes here alter the website's program. A broken file can break the build - always check the preview before publishing.", "التغييرات هنا تعدّل برنامج الموقع. قد يكسر ملف خاطئ البناء - تحقق دائمًا من المعاينة قبل النشر.")}
          </Alert>
          <Panel
            title={translate("Unpublished code changes", "تغييرات الكود غير المنشورة")}
            side={
              <div className="flex flex-wrap gap-2">
                {status.preview?.url && (
                  <Button size="xs" variant="light" component="a" href={status.preview.url} target="_blank" rel="noopener noreferrer">
                    {translate("Open preview", "فتح المعاينة")}
                  </Button>
                )}
                {!!status.aheadBy && !status.pullRequest && (
                  <Button size="xs" variant="light" onClick={async () => (await call({ url: "website/code/pull-request", method: "POST", data: {} }, { success: "server" })) && load()}>
                    {translate("Prepare for publishing", "التحضير للنشر")}
                  </Button>
                )}
                {status.pullRequest && can("publish") && (
                  <Button
                    size="xs"
                    color="teal"
                    onClick={async () => {
                      if (!(await confirm({ title: translate("Publish the code changes?", "نشر تغييرات الكود؟"), message: translate("They are merged into the production branch and the live website is rebuilt.", "ستُدمج في فرع الإنتاج ويُعاد بناء الموقع."), confirmLabel: translate("Publish", "نشر") }))) return;
                      if (await call({ url: "website/code/deploy", method: "POST" }, { success: "server" })) load();
                    }}
                  >
                    {translate("Publish", "نشر")}
                  </Button>
                )}
                {!!status.aheadBy && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={async () => {
                      if (!(await confirm({ title: translate("Discard all unpublished code changes?", "تجاهل كل تغييرات الكود غير المنشورة؟"), message: translate("The work branch goes back to the live code.", "سيعود فرع العمل إلى الكود المنشور."), danger: true, confirmLabel: translate("Discard", "تجاهل") }))) return;
                      if (await call({ url: "website/code/discard", method: "POST" }, { success: "server" })) load();
                    }}
                  >
                    {translate("Discard all", "تجاهل الكل")}
                  </Button>
                )}
              </div>
            }
          >
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="light">{status.repo}</Badge>
              <Badge variant="light">
                {status.work} → {status.base}
              </Badge>
              <Badge color={status.aheadBy ? "orange" : "teal"} variant="light">
                {translate(`${status.aheadBy || 0} unpublished change(s)`, `${status.aheadBy || 0} تغيير غير منشور`)}
              </Badge>
              {status.checks && (
                <Badge color={status.checks.state === "success" ? "teal" : status.checks.state === "failure" ? "red" : "yellow"} variant="light">
                  {translate("Preview build", "بناء المعاينة")}: {status.checks.state}
                </Badge>
              )}
              {status.pullRequest && (
                <a href={status.pullRequest.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                  #{status.pullRequest.number}
                </a>
              )}
            </div>
            {!!status.commits?.length && (
              <Table fz="xs" mt="sm">
                <Table.Tbody>
                  {status.commits.map((c) => (
                    <Table.Tr key={c.sha}>
                      <Table.Td className="font-mono">{c.sha.slice(0, 7)}</Table.Td>
                      <Table.Td>{c.message}</Table.Td>
                      <Table.Td>{c.author}</Table.Td>
                      <Table.Td>{c.date ? formatCairoDateTime(c.date, language) : ""}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Panel title={translate("Files", "الملفات")}>
              <TextInput size="xs" placeholder={translate("Filter", "تصفية")} value={filter} onChange={(e) => setFilter(e.currentTarget.value)} mb="xs" />
              <div className="max-h-[60vh] overflow-auto font-mono text-xs">
                {shown.map((f) => (
                  <button key={f.path} type="button" onClick={() => openFile(f.path)} className={`block w-full truncate rounded px-1 py-0.5 text-start hover:bg-gray-100 ${open?.path === f.path ? "bg-blue-50" : ""}`} title={f.path}>
                    {changed.has(f.path) && <span className="text-orange-600">● </span>}
                    {f.path}
                  </button>
                ))}
              </div>
            </Panel>
            <Panel title={open ? open.path : translate("Select a file", "اختر ملفًا")}>
              {open ? (
                <div className="flex flex-col gap-2">
                  <Textarea value={draft} onChange={(e) => setDraft(e.currentTarget.value)} autosize minRows={18} maxRows={40} dir="ltr" spellCheck={false} styles={{ input: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, whiteSpace: "pre", overflowX: "auto" } }} />
                  <div className="flex flex-wrap items-end gap-2">
                    <TextInput className="flex-1" size="xs" label={translate("Describe the change", "صف التغيير")} value={message} onChange={(e) => setMessage(e.currentTarget.value)} maxLength={200} />
                    <Button size="xs" variant="default" disabled={!dirty} onClick={() => setDraft(open.content)}>
                      {translate("Undo edits", "تراجع")}
                    </Button>
                    <Button size="xs" color="teal" disabled={!dirty} loading={busy} onClick={saveFile}>
                      {translate("Save to work branch", "حفظ في فرع العمل")}
                    </Button>
                  </div>
                  {history.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold">{translate("Versions of this file", "نسخ هذا الملف")}</div>
                      <Table fz="xs">
                        <Table.Tbody>
                          {history.map((h) => (
                            <Table.Tr key={h.sha}>
                              <Table.Td className="font-mono">{h.sha.slice(0, 7)}</Table.Td>
                              <Table.Td>{h.message}</Table.Td>
                              <Table.Td>{h.date ? formatCairoDateTime(h.date, language) : ""}</Table.Td>
                              <Table.Td>
                                <Button
                                  size="compact-xs"
                                  variant="subtle"
                                  onClick={async () => {
                                    if (!(await confirm({ title: translate("Restore this version of the file?", "استعادة هذه النسخة من الملف؟"), message: translate("It is saved as a new change on the work branch.", "تُحفظ كتغيير جديد في فرع العمل."), confirmLabel: translate("Restore", "استعادة") }))) return;
                                    if (await call({ url: "website/code/revert", method: "POST", data: { path: open.path, sha: h.sha } }, { success: "server" })) {
                                      load();
                                      openFile(open.path);
                                    }
                                  }}
                                >
                                  {translate("Restore", "استعادة")}
                                </Button>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">{translate("Choose a file on the left to view or edit it.", "اختر ملفًا من اليسار لعرضه أو تعديله.")}</p>
              )}
            </Panel>
          </div>
        </div>
      )}
    </AdminLayoutBox>
  );
}
