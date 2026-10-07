import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { DatePickerInput } from "@mantine/dates";
import { solidIcons } from "@/components/icons";

export default function Header({
  dateRange,
  setDateRange,
}: {
  dateRange: [Date | null, Date | null];
  setDateRange: (date: [Date | null, Date | null]) => void;
}) {
  const { language } = useLanguage();

  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>{translate(language, "Analytics", "التحليلات")}</h1>
        <p className="mt-1 text-xs sm:text-base">
          {translate(
            language,
            "This section provides an overview and insights into the system's performance.",
            "يوفر هذا القسم نظرة عامة وأفكارًا حول أداء النظام.",
          )}
        </p>
      </div>

      <DatePickerInput
        type="range"
        placeholder={translate(language, "Select date range", "حدد نطاق التاريخ")}
        value={dateRange}
        onChange={setDateRange}
        leftSection={<solidIcons.Calendar />}
        size="md"
      />
    </header>
  );
}
