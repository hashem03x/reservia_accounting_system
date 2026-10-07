import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import { useLanguage } from "@/context/LanguageContext";

export default function AdminLayoutBox({
  header,
  children,
}: {
  header?: { title: string; subTitle?: string; backLink?: string | boolean; sideElements?: ReactNode; border?: boolean };
  children: ReactNode;
}) {
  const { translate, translations } = useLanguage();

  const navigate = useNavigate();

  const backLinkRef = typeof header?.backLink === "string" ? header.backLink : -1;

  return (
    <div className="root-flex-1 flex min-h-full flex-col gap-5 rounded-lg border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      {header && (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              {header.backLink && (
                <Button
                  onClick={() => navigate(backLinkRef as string)}
                  title={translations.back}
                  variant="light"
                  color="dark"
                  radius={20}
                  p={0}
                  h={40}
                  w={40}
                >
                  <solidIcons.ArrowLeft style={{ transform: `rotateY(${translate("0", "180deg")})` }} />
                </Button>
              )}
              <h1 className="tracking-tight">{header.title}</h1>
            </div>
            {header.subTitle && <p>{header.subTitle}</p>}
          </div>
          {header.sideElements && header.sideElements}
        </header>
      )}

      {header?.border && <hr className="border-gray-100" />}

      {children}
    </div>
  );
}
