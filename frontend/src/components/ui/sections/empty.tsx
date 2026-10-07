import { useLanguage } from "@/context/LanguageContext";
import translate from "@/utils/helpers/translate";
import defaultImage from "@/assets/hot-air-balloon.png";
import Img from "@/components/ui/img";

type Props = {
  message?: string;
  img?: string | null;
  useDefaultImg?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export default function EmptySection({ message = "", img = null, useDefaultImg = false, className = "", children }: Props) {
  const { language } = useLanguage();

  return (
    <section className={`flex-center flex-1 flex-col gap-4 rounded-lg bg-gray-100 p-10 ${className}`}>
      {img ? (
        <Img src={img} alt={message || translate(language, "Empty", "فارغ")} height="65px" />
      ) : useDefaultImg ? (
        <Img src={defaultImage} alt={message || translate(language, "Empty", "فارغ")} height="50px" />
      ) : null}
      <p>{message || translate(language, "Empty", "فارغ")}</p>
      {children}
    </section>
  );
}
