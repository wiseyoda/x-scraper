/**
 * ISO 8601 week-of-year helpers.
 *
 * Pure: takes a Date, returns a week number / year. Used to build the
 * digest filename `digests/2026-W17.md` deterministically.
 */

const DAYS_TO_THURSDAY = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;
const MONDAY = 1;

/**
 * Returns the ISO week number (1..53) of `date`.
 *
 * Uses the standard "Thursday in this week is the week that contains
 * January 4th" pivot.
 */
export const isoWeek = (date: Date): { year: number; week: number } => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + DAYS_TO_THURSDAY - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return { year: target.getUTCFullYear(), week };
};

export const isoWeekStart = (date: Date): Date => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() - dayNum + MONDAY);
  return target;
};

export const formatIsoWeek = (date: Date): string => {
  const { year, week } = isoWeek(date);
  return `${String(year)}-W${week.toString().padStart(2, '0')}`;
};
