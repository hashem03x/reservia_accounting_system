import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";

export default function LoadingSection({ message, className = "" }: { message?: string; className?: string }) {
  const { translations } = useLanguage();

  return (
    <section className={`flex-center flex-1 flex-col gap-4 rounded-lg bg-gray-100 p-10 ${className}`}>
      <div className="animate-spin text-gray-600">{<solidIcons.Spinner size={20} />}</div>
      <p>{message || translations.loading}</p>
    </section>
  );
}
