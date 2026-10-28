import { useEffect, useState } from "react";
import { Badge, Button, Collapse, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError } from "@/utils/helpers/notifiers";
import { solidIcons } from "@/components/icons";

type FieldSpec = { column: string; required: "yes" | "no" | "conditional"; description: string; format?: string; maxLength?: number; example?: string };
type Guide = { general: { topic: string; text: string }[]; columns: FieldSpec[] };

/**
 * The format guide of a CSV import (client requirement "Import Files - Format Documentation"):
 * every column's purpose, required / optional, accepted format and values, maximum length and an
 * example - served by the importer itself (backend utils/csvImport/formatGuide.js, specs kept next to
 * each importer's validation), so it always matches what the import accepts. Shown here and
 * downloadable as a separate CSV - the data template itself never carries instruction rows.
 */
export default function ImportFormatGuide({ guideUrl, filename }: { guideUrl: string; filename: string }) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [opened, setOpened] = useState(false);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!opened || guide) return;
    privateRequest({ url: guideUrl, language })
      .then((res) => setGuide(res.data))
      .catch(() => setGuide({ general: [], columns: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  async function download() {
    setDownloading(true);
    try {
      await privateRequest({ url: guideUrl, params: { format: "csv" }, download: true, filename, language });
    } catch {
      notifyError({ language, message: translate("Could not download the format guide.", "تعذر تحميل دليل التنسيق.") });
    } finally {
      setDownloading(false);
    }
  }

  const requiredBadge = (r: FieldSpec["required"]) =>
    r === "yes" ? (
      <Badge size="xs" color="red" variant="light">{translate("Required", "مطلوب")}</Badge>
    ) : r === "conditional" ? (
      <Badge size="xs" color="yellow" variant="light">{translate("Conditional", "مشروط")}</Badge>
    ) : (
      <Badge size="xs" color="gray" variant="light">{translate("Optional", "اختياري")}</Badge>
    );

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="subtle" onClick={() => setOpened((o) => !o)} leftSection={opened ? <solidIcons.ArrowUp size={12} /> : <solidIcons.ArrowDown size={12} />}>
          {translate("Column format guide", "دليل تنسيق الأعمدة")}
        </Button>
        <Button size="xs" variant="light" color="gray" leftSection={<solidIcons.Download />} onClick={download} loading={downloading}>
          {translate("Download Format Guide", "تحميل دليل التنسيق")}
        </Button>
      </div>
      <Collapse in={opened}>
        {!guide ? (
          <p className="text-sm text-gray-500">{translate("Loading...", "جاري التحميل...")}</p>
        ) : guide.columns.length === 0 ? (
          <p className="text-sm text-gray-500">{translate("The format guide is not available.", "دليل التنسيق غير متاح.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="list-disc ps-5 text-xs text-gray-600">
              {guide.general.map((g) => (
                <li key={g.topic}>
                  <b>{g.topic}:</b> {g.text}
                </li>
              ))}
            </ul>
            <div className="max-h-80 overflow-auto rounded border border-gray-200">
              <Table striped stickyHeader className="text-xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Column", "العمود")}</Table.Th>
                    <Table.Th>{translate("Required", "الإلزام")}</Table.Th>
                    <Table.Th>{translate("Description", "الوصف")}</Table.Th>
                    <Table.Th>{translate("Format / allowed values", "التنسيق / القيم المسموحة")}</Table.Th>
                    <Table.Th>{translate("Max length", "أقصى طول")}</Table.Th>
                    <Table.Th>{translate("Example", "مثال")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {guide.columns.map((c) => (
                    <Table.Tr key={c.column}>
                      <Table.Td className="font-mono font-semibold">{c.column}</Table.Td>
                      <Table.Td>{requiredBadge(c.required)}</Table.Td>
                      <Table.Td className="min-w-[220px]">{c.description}</Table.Td>
                      <Table.Td className="min-w-[180px]">{c.format || "-"}</Table.Td>
                      <Table.Td>{c.maxLength ?? "-"}</Table.Td>
                      <Table.Td className="font-mono">{c.example || "-"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </div>
        )}
      </Collapse>
    </div>
  );
}
