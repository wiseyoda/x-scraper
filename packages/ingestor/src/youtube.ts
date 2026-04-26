/**
 * YouTube ingestor.
 *
 * Strategy: pull the watch page, parse the JSON-embedded captionTracks
 * descriptor from `ytInitialPlayerResponse`, then fetch the timed-text
 * URL and convert it to plain text. No yt-dlp, no Python — keeps the
 * package self-contained.
 *
 * Failure mode: if the video has no captions (or only auto-generated
 * for an unsupported language), throws EMPTY_BODY. The queue can then
 * route to a transcription path later.
 */

import { MAX_BODY_CHARS, MIN_BODY_CHARS, YOUTUBE_HOSTS } from './constants.js';
import { type FetchOptions, fetchTextWithTimeout } from './http.js';
import { type IngestedSource, type Ingestor, IngestorError } from './types.js';

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
}

export interface YouTubeConfig extends FetchOptions {
  /** Preferred caption language, default 'en'. */
  preferredLanguage?: string;
  now?: () => Date;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const parseYouTubeUrl = (url: string): { videoId: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.includes(parsed.host)) return null;
  if (parsed.host === 'youtu.be') {
    const id = parsed.pathname.slice(1);
    return VIDEO_ID_RE.test(id) ? { videoId: id } : null;
  }
  if (parsed.pathname === '/watch') {
    const id = parsed.searchParams.get('v');
    return id !== null && VIDEO_ID_RE.test(id) ? { videoId: id } : null;
  }
  if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/v/')) {
    const id = parsed.pathname.split('/')[2];
    return id !== undefined && VIDEO_ID_RE.test(id) ? { videoId: id } : null;
  }
  return null;
};

const PLAYER_RESPONSE_MARKER = 'ytInitialPlayerResponse =';

interface PlayerResponse {
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

export const extractPlayerResponse = (html: string): PlayerResponse | null => {
  const start = html.indexOf(PLAYER_RESPONSE_MARKER);
  if (start === -1) return null;
  let i = start + PLAYER_RESPONSE_MARKER.length;
  while (i < html.length && html.charAt(i) !== '{') i += 1;
  if (i >= html.length) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let j = i; j < html.length; j += 1) {
    const ch = html.charAt(j);
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(i, j + 1)) as PlayerResponse;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
};

export const captionsXmlToText = (xml: string): string => {
  // YouTube returns a thin XML wrapper. Strip <text ...> tags and decode
  // a small set of HTML entities — that's all the format ever contains.
  const lines = xml
    .replace(/<\/?(?:transcript|p|s|c)[^>]*>/g, '')
    .split(/<text[^>]*>|<\/text>/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const decoded = lines.map((s) =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n/g, ' '),
  );
  return decoded.join('\n').trim();
};

const pickTrack = (tracks: CaptionTrack[], language: string): CaptionTrack | null => {
  const exact = tracks.find((t) => t.languageCode === language && t.kind !== 'asr');
  if (exact !== undefined) return exact;
  const exactAuto = tracks.find((t) => t.languageCode === language);
  if (exactAuto !== undefined) return exactAuto;
  return tracks[0] ?? null;
};

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

export const createYouTubeIngestor = (config: YouTubeConfig = {}): Ingestor => {
  const now = config.now ?? ((): Date => new Date());
  const language = config.preferredLanguage ?? 'en';

  const matches = (url: string): boolean => parseYouTubeUrl(url) !== null;

  const ingest = async (url: string): Promise<IngestedSource> => {
    const target = parseYouTubeUrl(url);
    if (target === null) {
      throw new IngestorError(`not a YouTube URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const watchUrl = `https://www.youtube.com/watch?v=${target.videoId}`;
    const { text: html } = await fetchTextWithTimeout(watchUrl, config);
    const player = extractPlayerResponse(html);
    if (player === null) {
      throw new IngestorError(`could not parse player response for ${url}`, 'PARSE', { url });
    }
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = pickTrack(tracks, language);
    if (track === null) {
      throw new IngestorError(`no captions available for ${url}`, 'EMPTY_BODY', { url });
    }
    const { text: xml } = await fetchTextWithTimeout(track.baseUrl, {
      ...config,
      accept: 'text/xml',
    });
    const body = captionsXmlToText(xml);
    if (body.length < MIN_BODY_CHARS) {
      throw new IngestorError(
        `transcript too short (${String(body.length)}) for ${url}`,
        'EMPTY_BODY',
        { url },
      );
    }
    return {
      url,
      kind: 'youtube',
      title: player.videoDetails?.title?.trim() ?? null,
      body: clamp(body, MAX_BODY_CHARS),
      byline: player.videoDetails?.author?.trim() ?? null,
      capturedAt: now().toISOString(),
      metadata: {
        videoId: target.videoId,
        language: track.languageCode,
        durationSec:
          player.videoDetails?.lengthSeconds === undefined
            ? null
            : Number(player.videoDetails.lengthSeconds),
      },
    };
  };

  return { kind: 'youtube', matches, ingest };
};
