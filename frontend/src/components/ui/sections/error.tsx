import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";

type Props = {
  errorTitle: string;
  errorMessage: string;
  button?: {
    text: string;
    onClick: () => void;
  };
  className?: string;
};

export default function ErrorSection({ errorTitle, errorMessage, button, className = "" }: Props) {
  return (
    <section className={`flex-center flex-1 flex-col gap-4 rounded-lg bg-red-50 p-10 text-red-600 ${className}`}>
      <solidIcons.ExclamationCircle size={23.5} />
      <div className="flex-center flex-col gap-2">
        <span className="max-w-[500px] text-center font-bold">{errorTitle}</span>
        <span className="max-w-[500px] text-center">{errorMessage}</span>
      </div>
      {button && (
        <Button variant="light" color="dark" onClick={button.onClick}>
          {button.text}
        </Button>
      )}
    </section>
  );
}
