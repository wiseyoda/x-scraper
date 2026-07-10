/**
 * Read the previous-visit timestamp surfaced by middleware.ts via the
 * `x-xs-prev-visit` request header. Cookies are written by middleware so
 * we never have to write them from a server component (Next.js 15
 * forbids that).
 */

import 'server-only';

import { headers } from 'next/headers';

const HEADER_NAME = 'x-xs-prev-visit';

export const readLastVisit = async (): Promise<string | null> => {
  const h = await headers();
  const v = h.get(HEADER_NAME);
  return v !== null && v.length > 0 ? v : null;
};
