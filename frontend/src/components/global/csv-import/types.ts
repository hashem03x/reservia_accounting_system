// Shared response shapes for every module's /preview and /commit import endpoints
// (backend/server/services/csvImport/csvImportRunner.js).

export interface CsvRowError {
  column?: string;
  value?: unknown;
  message: string;
  suggestion?: string;
}

export interface CsvPreviewResult {
  columns: string[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  previewRows: { row: number; data: Record<string, string>; errors: CsvRowError[] }[];
  errors: { row: number; errors: CsvRowError[] }[];
}

export interface CsvCommitResult {
  created: { row: number; id: string }[];
  failed: { row: number; errors: CsvRowError[] }[];
}

// The shape of a thrown API error body (utils/apiError.js -> errorMiddleware.js) - apiRequest.ts
// throws this raw JSON object directly, never wrapped in an Error instance.
export interface ApiErrorPayload {
  status?: string;
  message?: string;
  validationErrors?: { row: number; errors: CsvRowError[] }[];
}
