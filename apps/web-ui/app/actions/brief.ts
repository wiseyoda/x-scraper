'use server';

import { revalidatePath } from 'next/cache';

import type { CapturedContentType } from '@/lib/capture-cache';
import { generateBrief } from '@/lib/ai-brief';

export interface BriefResult {
  brief: string;
  cached: boolean;
  error?: string;
}

export async function generateBriefAction(input: {
  sourceId: string;
  contentType: CapturedContentType;
  body: string;
  url: string;
}): Promise<BriefResult> {
  try {
    const r = await generateBrief({
      sourceId: input.sourceId,
      contentType: input.contentType,
      body: input.body,
      url: input.url,
    });
    revalidatePath(`/sources/${input.sourceId}`);
    return r;
  } catch (err) {
    return {
      brief: '',
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
