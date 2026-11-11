/**
 * A readable message for anything apiRequest/privateRequest can throw: an Error, the API's JSON
 * error body ({ message } or express-validator's { errors: [{ msg }] }), or a plain string.
 * Mirrors the extraction handle-request.ts already does, for components that catch errors themselves.
 */
export default function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  const e = err as { message?: unknown; errors?: { msg?: string }[] };
  if (typeof e.message === "string" && e.message) return e.message;
  if (Array.isArray(e.errors) && e.errors[0]?.msg) return e.errors[0].msg;
  return fallback;
}
