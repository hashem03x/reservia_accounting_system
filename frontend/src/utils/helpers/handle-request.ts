import { Language } from "@/types/language";
import { logError } from "@/utils/helpers/loggers";
import translate from "@/utils/helpers/translate";

export default async function handleRequest(
  language: Language,
  setLoading: (loading: boolean) => void,
  setError: (error: string) => void,
  callback: () => Promise<void>,
  canceled: { current: boolean } = { current: false },
): Promise<void> {
  try {
    if (!canceled.current) setError("");
    if (!canceled.current) setLoading(true);
    await callback();
  } catch (err) {
    let error;
    if ((err as Error)?.message) error = (err as Error)?.message;
    else if ((err as any)?.errors) error = (err as any)?.errors[0].msg;
    else
      error = translate(
        language,
        "Something went wrong. Please try again later.",
        "حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقًا.",
      );
    logError("handleRequest", error);
    if (!canceled.current) setError(error);
  } finally {
    if (!canceled.current) setLoading(false);
  }
}
