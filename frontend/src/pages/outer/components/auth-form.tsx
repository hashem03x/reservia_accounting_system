import { Link } from "react-router-dom";
import { Alert, Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import OAuth from "./o-auth";

type Props = {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  title: string;
  submitLabel: string;
  leave?: { to: string; label: string; hint: string };
  requiredFields?: Record<string, string>;
  isValidated?: boolean;
  error: string;
  loading: boolean;
  withOAuth?: boolean;
  children: React.ReactNode;
};

export default function AuthForm({
  onSubmit,
  title,
  submitLabel,
  leave,
  requiredFields,
  isValidated,
  error,
  loading,
  withOAuth = false,
  children,
}: Props) {
  return (
    <div className="root-flex-1 flex flex-col justify-center p-4 pb-20">
      <div className="mx-auto w-[450px] max-w-full animate-fade-in">
        <h1 className="mb-6 text-center">{title}</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {children}

          <Button
            size="md"
            type="submit"
            disabled={(requiredFields && !hasCompleteData(requiredFields)) || isValidated === false || loading}
          >
            {loading ? <solidIcons.Spinner className="animate-spin" /> : submitLabel}
          </Button>

          {error && (
            <div className="animate-fade-in">
              <Alert color="red" icon={<solidIcons.ExclamationCircle />}>
                {error}
              </Alert>
            </div>
          )}

          {leave && (
            <p className="flex items-center justify-center gap-1">
              <span>{leave.hint}</span>
              <Link to={leave.to} style={{ fontWeight: 500 }} className="text-teal-600 hover:text-teal-700">
                {leave.label}
              </Link>
            </p>
          )}
        </form>
        {withOAuth && <OAuth />}
      </div>
    </div>
  );
}

function hasCompleteData(data: Record<string, string>) {
  return Object.values(data).every((value) => value !== "");
}
