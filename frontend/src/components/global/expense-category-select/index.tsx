import { useEffect, useState } from "react";
import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { ExpenseCategory } from "@/types/accounting-period";

/**
 * Expense Category picker. For a new choice only active categories are offered; an inactive
 * category is still shown when it is the current value (an expense keeps its category). In filter
 * mode every category is listed, plus "No category".
 */
export default function ExpenseCategorySelect({
  value,
  onChange,
  mode = "choose",
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  mode?: "choose" | "filter";
  label?: string;
  className?: string;
}) {
  const { language, translate } = useLanguage();
  const { privateRequest } = useDataHandler({ initialData: null });
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);

  useEffect(() => {
    privateRequest({ url: "expense-categories", language })
      .then((res) => setCategories(res.data || []))
      .catch(() => setCategories([]));
  }, []);

  const nameOf = (c: ExpenseCategory) => (language === "ar-EG" && c.nameAr ? c.nameAr : c.name);
  const data = [
    ...(mode === "filter" ? [{ value: "none", label: translate("No category", "بدون تصنيف") }] : []),
    ...categories
      .filter((c) => mode === "filter" || c.isActive || c._id === value)
      .map((c) => ({ value: c._id, label: c.isActive ? nameOf(c) : `${nameOf(c)} (${translate("inactive", "غير نشط")})` })),
  ];

  return (
    <Select
      label={label ?? translate("Expense Category", "تصنيف المصروف")}
      placeholder={
        mode === "filter"
          ? translate("All categories", "كل التصنيفات")
          : translate("Select category (optional)", "اختر التصنيف (اختياري)")
      }
      value={value || null}
      onChange={(v) => onChange(v || "")}
      data={data}
      searchable
      clearable
      className={className}
    />
  );
}
