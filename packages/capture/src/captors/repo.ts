/**
 * Repo captor — GitHub /repos + /readme.
 *
 * Stores raw repo JSON + decoded README markdown so a future re-extract
 * doesn't need to re-hit the GitHub API (which has aggressive rate
 * limits without a token).
 */

import { Buffer } from 'node:buffer';

import { canonicalizeUrl } from '@x-scraper/core';
import type { FetchOptions } from '@x-scraper/ingestor';
import { fetchJsonWithTimeout, parseGitHubUrl } from '@x-scraper/ingestor';
import { z } from 'zod';

import { CAPTURE_SCHEMA_VERSION } from '../constants.js';
import { type Captor, CaptureError, type RepoCaptured } from '../types.js';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_ACCEPT = 'application/vnd.github+json';
const GITHUB_API_VERSION = '2022-11-28';
const HTTP_NOT_FOUND = 404;
const MAX_BODY_CHARS = 250_000;

const RepoInfoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  default_branch: z.string(),
  owner: z.object({ login: z.string() }).nullable(),
  stargazers_count: z.number().optional(),
  language: z.string().nullable().optional(),
});
const ContentBlobSchema = z.object({
  content: z.string(),
  encoding: z.string(),
});

export interface RepoCaptorConfig extends FetchOptions {
  /** GitHub token for higher rate limits / private repos. */
  token?: string;
  now?: () => Date;
}

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

const buildHeaders = (config: RepoCaptorConfig): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: GITHUB_API_ACCEPT,
    'x-github-api-version': GITHUB_API_VERSION,
  };
  if (config.token !== undefined && config.token.length > 0) {
    headers.authorization = `Bearer ${config.token}`;
  }
  return headers;
};

export const createRepoCaptor = (config: RepoCaptorConfig = {}): Captor => {
  const now = config.now ?? ((): Date => new Date());

  const matches = (url: string): boolean => parseGitHubUrl(url) !== null;

  const capture = async (url: string): Promise<RepoCaptured> => {
    const target = parseGitHubUrl(url);
    if (target === null) {
      throw new CaptureError(`not a GitHub repo URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const headers = buildHeaders(config);
    const fetchConfig: FetchOptions = { ...config, headers, accept: GITHUB_API_ACCEPT };

    const repoUrl = `${GITHUB_API_BASE}/repos/${target.owner}/${target.repo}`;
    const repoRaw = await fetchJsonWithTimeout<unknown>(repoUrl, fetchConfig);
    const repoParsed = RepoInfoSchema.safeParse(repoRaw);
    if (!repoParsed.success) {
      throw new CaptureError(`unexpected GitHub repo JSON shape for ${url}`, 'PARSE', {
        url,
        cause: repoParsed.error,
      });
    }
    const repo = repoParsed.data;
    const repoJson = JSON.stringify(repoRaw);

    let readme = '';
    try {
      const readmeRaw = await fetchJsonWithTimeout<unknown>(`${repoUrl}/readme`, fetchConfig);
      const readmeParsed = ContentBlobSchema.safeParse(readmeRaw);
      if (readmeParsed.success) {
        readme =
          readmeParsed.data.encoding === 'base64'
            ? Buffer.from(readmeParsed.data.content, 'base64').toString('utf8')
            : readmeParsed.data.content;
      }
    } catch (err) {
      // README is optional only when the file genuinely doesn't exist.
      // Rate limits / 5xx must propagate.
      if (
        err !== null &&
        typeof err === 'object' &&
        'httpStatus' in err &&
        (err as { httpStatus?: number }).httpStatus !== HTTP_NOT_FOUND
      ) {
        throw new CaptureError(`README fetch failed for ${url}`, 'PROVIDER', {
          url,
          cause: err,
        });
      }
    }

    const bodyParts = [
      repo.description !== null && repo.description.length > 0 ? `# ${repo.description}` : '',
      readme.trim(),
    ].filter((s) => s.length > 0);
    const body = clamp(bodyParts.join('\n\n').trim(), MAX_BODY_CHARS);

    return {
      schema_version: CAPTURE_SCHEMA_VERSION,
      url,
      canonical_url: canonicalizeUrl(url),
      fetched_at: now().toISOString(),
      http_status: 200,
      captor: 'repo',
      content_type: 'repo',
      raw_repo_json: repoJson,
      raw_readme_md: readme,
      parsed: {
        title: repo.full_name,
        byline: repo.owner?.login ?? null,
        body,
        metadata: {
          owner: target.owner,
          repo: target.repo,
          default_branch: repo.default_branch,
          stars: repo.stargazers_count ?? null,
          language: repo.language ?? null,
        },
      },
    };
  };

  return { id: 'repo', matches, capture };
};
