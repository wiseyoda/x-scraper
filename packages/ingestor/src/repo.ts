/**
 * GitHub repo ingestor.
 *
 * Pulls the repo metadata + README via the GitHub REST API. We do NOT
 * shallow-clone — for our knowledge-graph use case the README + repo
 * description carry the bulk of the signal, and avoiding `git` keeps
 * the package dependency-free.
 */

import { Buffer } from 'node:buffer';

import { z } from 'zod';

import {
  GITHUB_API_ACCEPT,
  GITHUB_API_BASE,
  GITHUB_API_VERSION,
  MAX_BODY_CHARS,
} from './constants.js';
import { fetchJsonWithTimeout, type FetchOptions } from './http.js';
import { type IngestedSource, type Ingestor, IngestorError } from './types.js';

const GITHUB_HOSTS = ['github.com', 'www.github.com'];
const HTTP_NOT_FOUND = 404;

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
type ContentBlob = z.infer<typeof ContentBlobSchema>;

export interface RepoConfig extends FetchOptions {
  /** GitHub token for higher rate limits / private repos. */
  token?: string;
  now?: () => Date;
}

/**
 * Only matches repository-root URLs.
 *
 * `https://github.com/owner/repo` and `.../owner/repo.git` and trailing
 * slashes match. URLs that point at a subresource — `/issues/...`,
 * `/blob/...`, `/pull/...`, `/tree/...`, `/wiki/...` etc. — return
 * null so the dispatcher falls through to the article ingestor and the
 * subresource URL is preserved instead of being silently rewritten to
 * the repo's README.
 */
const REPO_RESERVED_SEGMENTS = new Set([
  'issues',
  'pull',
  'pulls',
  'blob',
  'tree',
  'commit',
  'commits',
  'wiki',
  'actions',
  'releases',
  'tags',
  'compare',
  'discussions',
  'projects',
  'security',
  'pulse',
  'graphs',
  'network',
  'settings',
  'archive',
  'raw',
  'branches',
]);

export const parseGitHubUrl = (url: string): { owner: string; repo: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!GITHUB_HOSTS.includes(parsed.host)) return null;
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) return null;
  // Only the repo root (and trailing slash) qualifies as a repo URL.
  if (segments.length > 2) return null;
  const owner = segments[0];
  const repo = segments[1]?.replace(/\.git$/, '');
  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
    return null;
  }
  // Owner cannot be a reserved namespace (defensive — not strictly possible at length 2).
  if (REPO_RESERVED_SEGMENTS.has(owner)) return null;
  return { owner, repo };
};

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

const decodeContent = (blob: ContentBlob): string => {
  if (blob.encoding === 'base64') {
    return Buffer.from(blob.content, 'base64').toString('utf8');
  }
  return blob.content;
};

const buildHeaders = (config: RepoConfig): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: GITHUB_API_ACCEPT,
    'x-github-api-version': GITHUB_API_VERSION,
  };
  if (config.token !== undefined && config.token.length > 0) {
    headers.authorization = `Bearer ${config.token}`;
  }
  return headers;
};

export const createRepoIngestor = (config: RepoConfig = {}): Ingestor => {
  const now = config.now ?? ((): Date => new Date());

  const matches = (url: string): boolean => parseGitHubUrl(url) !== null;

  const ingest = async (url: string): Promise<IngestedSource> => {
    const target = parseGitHubUrl(url);
    if (target === null) {
      throw new IngestorError(`not a GitHub repo URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const headers = buildHeaders(config);
    const fetchConfig: FetchOptions = { ...config, headers, accept: GITHUB_API_ACCEPT };

    const repoUrl = `${GITHUB_API_BASE}/repos/${target.owner}/${target.repo}`;
    const repoRaw = await fetchJsonWithTimeout<unknown>(repoUrl, fetchConfig);
    const repoParsed = RepoInfoSchema.safeParse(repoRaw);
    if (!repoParsed.success) {
      throw new IngestorError(`unexpected GitHub repo JSON shape for ${url}`, 'PARSE', {
        url,
        cause: repoParsed.error,
      });
    }
    const repo = repoParsed.data;

    let readme = '';
    try {
      const readmeRaw = await fetchJsonWithTimeout<unknown>(`${repoUrl}/readme`, fetchConfig);
      const readmeParsed = ContentBlobSchema.safeParse(readmeRaw);
      if (!readmeParsed.success) {
        throw new IngestorError(`unexpected GitHub /readme JSON shape for ${url}`, 'PARSE', {
          url,
          cause: readmeParsed.error,
        });
      }
      readme = decodeContent(readmeParsed.data);
    } catch (err) {
      // README is optional only when the file genuinely doesn't exist
      // (404 / NOT_FOUND). Rate limits, auth failures, and 5xx must
      // propagate so the queue can retry rather than silently emit a
      // description-only source.
      if (err instanceof IngestorError && err.httpStatus !== HTTP_NOT_FOUND) throw err;
    }

    const bodyParts = [
      repo.description !== null && repo.description.length > 0 ? `# ${repo.description}` : '',
      readme.trim(),
    ].filter((s) => s.length > 0);
    const body = clamp(bodyParts.join('\n\n').trim(), MAX_BODY_CHARS);

    return {
      url,
      kind: 'repo',
      title: repo.full_name,
      body,
      byline: repo.owner?.login ?? null,
      capturedAt: now().toISOString(),
      metadata: {
        owner: target.owner,
        repo: target.repo,
        defaultBranch: repo.default_branch,
        stars: repo.stargazers_count ?? null,
        language: repo.language ?? null,
      },
    };
  };

  return { kind: 'repo', matches, ingest };
};
