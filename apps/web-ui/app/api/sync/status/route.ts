/**
 * Sync status route handler — replaces the server-action poll path.
 *
 * Server actions trigger RSC tree re-renders on every call, which is
 * expensive in Next.js dev (full page recompile). A plain route
 * handler returning JSON skips all that and returns in single-digit ms.
 */

import { NextResponse } from 'next/server';

import { latestSyncState, readSyncState } from '@/lib/sync-runner';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const runId = url.searchParams.get('id');
  const state = runId !== null ? await readSyncState(runId) : await latestSyncState();
  return NextResponse.json(state);
}
