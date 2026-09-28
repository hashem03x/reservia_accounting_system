import { Alert } from "@mantine/core";
import { solidIcons } from "@/components/icons";

export default function ErrorAlert({
  error,
  fade = false,
  radius = "md",
}: {
  error: string;
  fade?: boolean;
  radius?: "xs" | "sm" | "md" | "lg" | "xl";
}) {
  return (
    <Alert color="red" icon={<solidIcons.ExclamationCircle />} className={fade ? "animate-fade-in" : ""} radius={radius}>
      {error}
    </Alert>
  );
}
