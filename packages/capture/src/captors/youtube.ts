/**
 * YouTube captor — store raw watch HTML + raw caption XML + parsed
 * timed segments. Re-transcription can run offline against the XML
 * without re-fetching the video.
 */

import { canonicalizeUrl } from '@x-scraper/core';
import type { FetchOptions } from '@x-scraper/ingestor';
import {
  captionsXmlToText,
  extractPlayerResponse,
  fetchTextWithTimeout,
  parseYouTubeUrl,
} from '@x-scraper/ingestor';

import { CAPTURE_SCHEMA_VERSION } from '../constants.js';
import { type Captor, CaptureError, type YouTubeCaptured } from '../types.js';

const MAX_BODY_CHARS = 250_000;
const MIN_BODY_CHARS = 300;

export interface YouTubeCaptorConfig extends FetchOptions {
  preferredLanguage?: string;
  now?: () => Date;
}

const clamp = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

interface TimedSegment {
  start_sec: number;
  duration_sec: number;
  text: string;
}

/**
 * Parse YouTube's caption XML into timed segments. Each <text> tag has
 * start/dur attributes (in seconds) and an HTML-escaped body. We keep
 * the timing because a future video-aware refiner can "this point at
 * 2:17 the speaker says..." without re-pulling the source.
 */
const parseCaptionSegments = (xml: string): TimedSegment[] => {
  const segments: TimedSegment[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const startMatch = /start="([^"]+)"/.exec(attrs);
    const durMatch = /dur="([^"]+)"/.exec(attrs);
    const decoded = body
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n/g, ' ')
      .trim();
    if (decoded.length === 0) continue;
    segments.push({
      start_sec: startMatch === null ? 0 : Number(startMatch[1]),
      duration_sec: durMatch === null ? 0 : Number(durMatch[1]),
      text: decoded,
    });
  }
  return segments;
};

export const createYouTubeCaptor = (config: YouTubeCaptorConfig = {}): Captor => {
  const now = config.now ?? ((): Date => new Date());
  const language = config.preferredLanguage ?? 'en';

  const matches = (url: string): boolean => parseYouTubeUrl(url) !== null;

  const capture = async (url: string): Promise<YouTubeCaptured> => {
    const target = parseYouTubeUrl(url);
    if (target === null) {
      throw new CaptureError(`not a YouTube URL: ${url}`, 'UNSUPPORTED_URL', { url });
    }
    const watchUrl = `https://www.youtube.com/watch?v=${target.videoId}`;
    const { text: html } = await fetchTextWithTimeout(watchUrl, config);
    const player = extractPlayerResponse(html);
    if (player === null) {
      throw new CaptureError(`could not parse player response for ${url}`, 'PARSE', { url });
    }
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const exact = tracks.find((t) => t.languageCode === language && t.kind !== 'asr');
    const exactAuto = tracks.find((t) => t.languageCode === language);
    const track = exact ?? exactAuto ?? tracks[0] ?? null;
    if (track === null) {
      throw new CaptureError(`no captions available for ${url}`, 'EMPTY_BODY', { url });
    }
    const { text: xml } = await fetchTextWithTimeout(track.baseUrl, {
      ...config,
      accept: 'text/xml',
    });
    const body = captionsXmlToText(xml);
    if (body.length < MIN_BODY_CHARS) {
      throw new CaptureError(
        `transcript too short (${String(body.length)}) for ${url}`,
        'EMPTY_BODY',
        {
          url,
        },
      );
    }
    const segments = parseCaptionSegments(xml);

    return {
      schema_version: CAPTURE_SCHEMA_VERSION,
      url,
      canonical_url: canonicalizeUrl(url),
      fetched_at: now().toISOString(),
      http_status: 200,
      captor: 'youtube',
      content_type: 'youtube',
      raw_watch_html: html,
      raw_caption_xml: xml,
      transcript_segments: segments,
      parsed: {
        title: player.videoDetails?.title?.trim() ?? null,
        byline: player.videoDetails?.author?.trim() ?? null,
        body: clamp(body, MAX_BODY_CHARS),
        metadata: {
          video_id: target.videoId,
          language: track.languageCode,
          duration_sec:
            player.videoDetails?.lengthSeconds === undefined
              ? null
              : Number(player.videoDetails.lengthSeconds),
        },
      },
    };
  };

  return { id: 'youtube', matches, capture };
};
