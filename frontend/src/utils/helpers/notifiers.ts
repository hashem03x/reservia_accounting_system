import { Language } from "@/types/language";
import { notifications } from "@mantine/notifications";
import translate from "@/utils/helpers/translate";

type NotificationPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right"; // Simulate the NotificationPosition type

export function notifyError({ language, title, message }: { language: Language; title?: string; message: string }) {
  notifications.show({
    title: title || false,
    message,
    color: "red",
    dir: translate(language, "ltr", "rtl"),
    position: translate(language, "bottom-right", "bottom-left") as NotificationPosition,
    radius: "md",
  });
}

export function notifySuccess({ language, title, message }: { language: Language; title?: string; message: string }) {
  notifications.show({
    title: title || false,
    message,
    // Success semantics specifically - not the same "teal" used for primary CTA buttons
    // elsewhere (see theme.ts), which now resolves to the accent gold and would be the wrong
    // color for a success toast.
    color: "green",
    dir: translate(language, "ltr", "rtl"),
    position: translate(language, "bottom-right", "bottom-left") as NotificationPosition,
    radius: "md",
  });
}
