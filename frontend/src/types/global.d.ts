declare global {
  interface Window {
    fbq: (command: string, eventName: string, params?: Record<string, unknown>) => void;
  }
}

export type LocalizedLabel<T extends string> = {
  value: T;
  label: {
    en: string;
    ar: string;
  };
};

export type LocalizedEntity<T extends string> = Record<T, LocalizedLabel<T>>;

export type ContextProps<T> = {
  data: T;
  setData: React.Dispatch<React.SetStateAction<T>>;
  loading: boolean;
  error: string;
  reFetch: () => void;
};

export type PaginatedData<T> = {
  data: T[];
  results: number;
  paginationResult: {
    numberOfPages: number;
    currentPage: string;
    limit: string;
  };
} | null;

export type UploadedImage = { _id: string; url: string };

export type SortOrder = "asc" | "desc";
