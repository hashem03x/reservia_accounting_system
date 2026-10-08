export function formatDate(date: string | Date, language: string) {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  return new Intl.DateTimeFormat(language === 'en-US' ? 'en-US' : 'ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD" from the date the user picked (local calendar day) - sent to the API instead of an
// ISO timestamp, so the day (and month) never shifts across time zones.
export function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// "YYYY-MM" from a picked month - e.g. the depreciation month.
export function toMonthOnly(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}
