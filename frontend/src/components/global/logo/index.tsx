import { useNavigate } from "react-router-dom";
import Img from "@/components/ui/img";
import { useAbout } from "@/context/AboutContext";
import { useLanguage } from "@/context/LanguageContext";

export default function Logo({
  onClick,
  title = "",
  linkToHome = false,
}: {
  onClick?: () => void;
  title?: string;
  linkToHome?: boolean;
}) {
  const navigate = useNavigate();
  const { translations } = useLanguage();
  const { data: about } = useAbout();

  return (
    <button
      className={`flex items-center gap-4 ${linkToHome ? "cursor-pointer transition-opacity hover:opacity-80" : "cursor-default"} `}
      onClick={() => {
        onClick && onClick();
        linkToHome && navigate("/");
      }}
    >
      <Img src={about?.logo || ""} alt={translations.appName} className="h-10 rounded" />
      {title && <span className={`text-lg font-bold`}>{title}</span>}
    </button>
  );
}
