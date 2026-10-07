import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import img from "@/assets/error-404.png";
import Img from "@/components/ui/img";

function NotFound() {
  const navigate = useNavigate();

  const { translate } = useLanguage();

  return (
    <div className="flex-center h-full flex-1 flex-col gap-6 p-4 pb-20">
      <Img src={img} alt="404" className="h-28" />
      <h1 className="text-3xl">{translate("Page not found", "الصفحة غير موجودة")}</h1>
      <p>{translate("The page you're looking for doesn't exist.", "الصفحة التي تبحث عنها غير موجودة.")}</p>
      <div className="flex flex-col gap-4">
        <Button variant="light" onClick={() => navigate("/")}>
          {translate("Go to Dashboard", "الذهاب إلى لوحة التحكم")}
        </Button>
      </div>
    </div>
  );
}

export default NotFound;
