/**
 * Volumes. The generator and the rules keep every volume as whole nanolitres, so sums and
 * differences are exact; a lab writes them in its own unit, and the ANSWER lines give microlitres.
 */

export type Unit = 'uL' | 'mL' | 'nL';
export const UNITS: readonly Unit[] = ['uL', 'mL', 'nL'];

/** How each unit is written after a number. */
export const UNIT_TEXT: Record<Unit, string> = { uL: 'µL', mL: 'mL', nL: 'nL' };

const NL_PER: Record<Unit, number> = { uL: 1_000, mL: 1_000_000, nL: 1 };

/** A number with no trailing zeros after its point: 0.0150 as `0.015`, 45.0 as `45`. */
function plain(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return decimals === 0 ? text : text.replace(/0+$/, '').replace(/\.$/, '');
}

/** A volume of whole nanolitres in a unit: 45500 as `45.5 µL`, `0.0455 mL` or `45500 nL`. */
export function writeVolume(nl: number, unit: Unit): string {
  const decimals = { uL: 3, mL: 6, nL: 0 }[unit];
  return `${plain(nl / NL_PER[unit], decimals)} ${UNIT_TEXT[unit]}`;
}

/** Microlitres, as an ANSWER line gives them. */
export function microlitres(nl: number): number {
  return nl / 1_000;
}
