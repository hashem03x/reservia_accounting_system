import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import { Modal as M } from "@mantine/core";

export default function Modal({
  opened,
  onClose,
  title = "",
  centerTitle = false,
  size = "md",
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title?: string;
  centerTitle?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}) {
  const { language } = useLanguage();

  return (
    <M
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      centered
      radius="lg"
      shadow="xl"
      dir={translate(language, "ltr", "rtl")}
      size={size}
    >
      <div className="p-[10px]">
        {title && <h3 className={`mb-3 pb-3 border-b border-gray-100 ${centerTitle ? "text-center" : ""}`}>{title}</h3>}
        {children}
      </div>
    </M>
  );
}
