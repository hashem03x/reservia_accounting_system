import { useLanguage } from "@/context/LanguageContext";
import Img from "@/components/ui/img";
import defaultImage from "@/assets/unauthorized.png";

type Props = {
  message?: string;
  img?: string | null;
  useDefaultImg?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export default function UnauthorizedSection({ message = "", img = null, className = "", children }: Props) {
  const { translate } = useLanguage();

  return (
    <section className={`flex-center flex-1 flex-col gap-4 rounded-lg bg-gray-100 p-10 ${className}`}>
      <Img src={img ? img : defaultImage} alt={message || translate("Unauthorized Access", "دخول غير مصرح")} height="75px" />
      <p>{message || translate("You don't have permission to access this data.", "ليس لديك إذن للوصول إلى هذه البيانات")}</p>
      {children}
    </section>
  );
}
