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
      className="flex w-full items-center gap-6 rounded-lg border bg-gray-100 px-6 py-5 transition-colors hover:border-sky-200 hover:bg-sky-100"
    >
      <Img src={img} alt={title} width="35px" />
      <div className="flex flex-col gap-[2px]">
        <p className="font-medium text-gray-800">{title}</p>
        {subTitle && <span className="text-xs text-gray-600 sm:text-sm">{subTitle}</span>}
      </div>
    </Link>
  );
}
