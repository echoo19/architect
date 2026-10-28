export type IdPrefix =
  'job' | 'run' | 'rnd' | 'att' | 'grd' | 'cht' | 'msg' | 'chg' | 'req' | 'trn';

/** A short, sortable-enough unique id: `<prefix>_<time36><random>`. */
export function newId(prefix: IdPrefix): string {
  const time = Date.now().toString(36);
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return `${prefix}_${time}${random}`;
}

/** Lowercase slug for file names: letters, digits and dashes. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}
