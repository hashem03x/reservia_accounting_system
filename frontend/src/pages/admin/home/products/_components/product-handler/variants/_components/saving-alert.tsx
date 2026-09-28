import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";
import { Button } from "@mantine/core";

export default function SavingAlert({ toBasicInfo }: { toBasicInfo: () => void }) {
  const { translate } = useLanguage();

  return (
    <div className="flex-center root-flex-1 flex-col gap-2 rounded-xl bg-white p-4 shadow">
      <solidIcons.ExclamationCircle size={25} className="mb-1.5 text-yellow-500" />
      <h3 className="text-center text-sm sm:text-base">
        {translate("Please Save the Basic Information!", "الرجاء حفظ المعلومات الاساسية!")}
      </h3>
      <p className="max-w-[325px] text-center sm:text-sm">
        {translate(
          "You need to save the basic information of the product before you can control the variants.",
          "يجب حفظ المعلومات الاساسية للمنتج قبل ان تتمكن من التحكم في الأصناف.",
        )}
      </p>
      <Button color="blue" onClick={toBasicInfo}>
        {translate("Back to Basic Information", "عودة الى المعلومات الاساسية")}
      </Button>
    </div>
  );
}
