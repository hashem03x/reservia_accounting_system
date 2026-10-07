import Img from "@/components/ui/img";
import defaultImage from "@/assets/hot-air-balloon.png";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@mantine/core";

type Props = {
  keyword: string;
  img?: string | null;
  useDefaultImg?: boolean;
  className?: string;
  button?: {
    text: string;
    onClick: () => void;
  };
};

export default function NoResultsSection({ keyword, img = null, useDefaultImg = false, className = "", button }: Props) {
  const { translate } = useLanguage();

  const alt = translate("No results found", "لا توجد نتائج");

  return (
    <section className={`flex-center flex-1 flex-col gap-4 rounded-lg bg-gray-100 p-10 ${className}`}>
      {img ? (
        <Img src={img} alt={alt} height="65px" />
      ) : useDefaultImg ? (
        <Img src={defaultImage} alt={alt} height="50px" />
      ) : null}
      <p className="text-gray-800">{translate(`No results found for "${keyword}"`, `لا توجد نتائج لـ"${keyword}"`)}</p>
      {button && <Button onClick={button.onClick}>{button.text}</Button>}
    </section>
  );
}
