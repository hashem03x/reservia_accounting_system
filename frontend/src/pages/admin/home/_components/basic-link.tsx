import { Link } from "react-router-dom";
import Img from "@/components/ui/img";

export default function BasicLink({
  link: { to, img, title, subTitle },
}: {
  link: {
    to: string;
    img: string;
    title: string;
    subTitle?: string;
  };
}) {
  return (
    <Link
      to={to}
      className="flex w-full items-center gap-4 rounded-lg border border-gray-100 bg-white px-5 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent-200 hover:shadow-md"
    >
      <div className="flex-center h-12 w-12 shrink-0 rounded-lg bg-accent-50">
        <Img src={img} alt={title} width="26px" />
      </div>
      <div className="flex flex-col gap-[2px]">
        <p className="font-medium text-gray-800">{title}</p>
        {subTitle && <span className="text-xs text-gray-500 sm:text-sm">{subTitle}</span>}
      </div>
    </Link>
  );
}
