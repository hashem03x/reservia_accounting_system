import { Language } from "@/types/language";

export type ApiRequestOptions = {
  url: string;
  method?: string;
  headers?: HeadersInit;
  params?: Record<string, string | number | boolean>;
  data?: Record | string | FormData | null;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  download?: boolean;
  filename?: string;
  language?: Language;
  responseType?: 'json' | 'blob' | 'text' | 'arraybuffer';
};
