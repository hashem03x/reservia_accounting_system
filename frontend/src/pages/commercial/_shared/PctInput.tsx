import { NumberInput, NumberInputProps } from "@mantine/core";

/**
 * QA finding U3 - ONE input behaviour for every percentage lever. The Category Addition field used
 * to append on select-all-and-retype ("019%", "01919%") because its value was a float like
 * 19.000000000000004 and the field let a leading zero through. Every lever now uses this component:
 *   - the displayed value is rounded to 4 decimals (no float noise in the text the user edits);
 *   - leading zeros are not allowed, so typing over a selected "0" replaces it;
 *   - focusing the field selects its whole content, so retyping always replaces;
 *   - an empty field reports 0, never NaN/"".
 */
export function roundPct(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.round(v * 10000) / 10000;
}

/** Fraction (0.19) -> percent (19), without floating-point noise. */
export function toPct(fraction: number | null | undefined): number {
  return roundPct((fraction ?? 0) * 100);
}

export default function PctInput({ value, onChange, ...rest }: Omit<NumberInputProps, "value" | "onChange"> & { value: number; onChange: (v: number) => void }) {
  return (
    <NumberInput
      {...rest}
      value={roundPct(value)}
      onChange={(v) => onChange(typeof v === "number" ? v : Number(v) || 0)}
      onFocus={(e) => e.currentTarget.select()}
      allowLeadingZeros={false}
      allowNegative={false}
      decimalScale={4}
      min={0}
      max={100}
      clampBehavior="strict"
      suffix="%"
    />
  );
}
