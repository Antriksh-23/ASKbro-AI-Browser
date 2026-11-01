/**
 * ASKbro YouTube Video Extractor & Controller (Slice 1.5)
 *
 * Provides:
 * - Detection of YouTube watch pages, Shorts, and live streams
 * - Extraction of video title, channel, description, chapters, and player state
 * - Robust timestamp parsing (hh:mm:ss, mm:ss, bracketed)
 * - Video seeking via HTML5 video element on timestamp click
 * - Runtime messaging listener for SEEK_VIDEO
 */

import {
  YouTubeVideoChapter,
  YouTubeVideoDetails,
  SeekVideoResponse,
} from '../types/messages';
import { cleanExtractedText } from './reader';

/**
 * Checks if a given URL is a YouTube domain
 */
export function checkIsYouTubeUrl(urlStr?: string): boolean {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    return (
      host === 'www.youtube.com' ||
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtu.be'
    );
  } catch {
    return false;
  }
}

/**
 * Checks if a given URL is a standard YouTube video watch page (/watch?v=...)
 */
export function isYouTubeWatchUrl(urlStr?: string): boolean {
  if (!checkIsYouTubeUrl(urlStr)) return false;
  try {
    const url = new URL(urlStr!);
    if (url.hostname === 'youtu.be') {
      return url.pathname.length > 1;
    }
    return url.pathname === '/watch' && Boolean(url.searchParams.get('v'));
  } catch {
    return false;
  }
}

/**
 * Checks if a given URL is a YouTube Shorts page (/shorts/...)
 */
export function isYouTubeShortsUrl(urlStr?: string): boolean {
  if (!checkIsYouTubeUrl(urlStr)) return false;
  try {
    const url = new URL(urlStr!);
    return url.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

/**
 * Extracts YouTube video ID from URL
 */
export function extractYouTubeVideoId(urlStr?: string): string {
  if (!urlStr) return '';
  try {
    const url = new URL(urlStr);
    if (url.hostname === 'youtu.be') {
      return url.pathname.replace(/^\//, '').split('/')[0] || '';
    }
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/')[2] || '';
    }
    return url.searchParams.get('v') || '';
  } catch {
    return '';
  }
}

/**
 * Parses timestamp string (e.g. "01:23", "1:05:30", "[02:15]") to total seconds
 */
export function parseTimestampToSeconds(timestamp: string): number {
  if (!timestamp || typeof timestamp !== 'string') return 0;

  // Strip brackets, parentheses, spaces
  const clean = timestamp.replace(/[\[\]\(\)\s]/g, '').trim();
  const parts = clean.split(':').map((p) => parseInt(p, 10));

  if (parts.some((p) => isNaN(p) || p < 0)) {
    return 0;
  }

  if (parts.length === 2) {
    // mm:ss
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // hh:mm:ss
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 1) {
    // raw seconds
    return parts[0];
  }

  return 0;
}

/**
 * Formats seconds into standard timestamp string (mm:ss or hh:mm:ss)
 */
export function formatSecondsToTimestamp(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';

  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

const SEP_CLASS = '[' + '\\-\\:\\u2013\\u2014' + ']';
const TIMESTAMP_REGEX = new RegExp(
  `^(?:[\\s\\-\\*•]*)(?:\\[|\\()?((?:\\d{1,2}:)?\\d{1,2}:\\d{2})(?:\\]|\\))?\\s*${SEP_CLASS}?\\s*(.+)$`
);
const STRIP_SEP_PREFIX = new RegExp(`^${SEP_CLASS}\\s*`);
const STRIP_SEP_SUFFIX = new RegExp(`\\s*${SEP_CLASS}\\s*$`);

/**
 * Extracts timestamped chapters from unstructured text (like video descriptions)
 */
export function extractChaptersFromText(text: string): YouTubeVideoChapter[] {
  if (!text) return [];

  const chapters: YouTubeVideoChapter[] = [];
  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(TIMESTAMP_REGEX);
    if (match && match[1] && match[2]) {
      const timestampStr = match[1].trim();
      const title = match[2]
        .replace(STRIP_SEP_PREFIX, '')
        .replace(STRIP_SEP_SUFFIX, '')
        .trim();

      const seconds = parseTimestampToSeconds(timestampStr);

      if (title.length > 0 && title.length < 120) {
        chapters.push({
          time: seconds,
          timestampStr: formatSecondsToTimestamp(seconds),
          title,
        });
      }
    }
  }

  // Deduplicate and sort by time
  const uniqueMap = new Map<number, YouTubeVideoChapter>();
  for (const ch of chapters) {
    if (!uniqueMap.has(ch.time)) {
      uniqueMap.set(ch.time, ch);
    }
  }

  return Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
}

/**
 * Extracts a balanced JSON object ({...}) or array ([...]) starting from startIndex.
 * Properly ignores strings and escaped characters so nested braces or semicolons don't truncate the parse.
 */
export function extractBalancedJson(
  text: string,
  startIndex: number,
  openChar: '{' | '[' = '{',
  closeChar: '}' | ']' = '}'
): any | null {
  if (!text || startIndex < 0 || startIndex >= text.length || text[startIndex] !== openChar) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === '\\') {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === openChar) {
        depth++;
      } else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          const jsonStr = text.slice(startIndex, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Decodes standard XML / HTML numeric and named entities
 */
export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/**
 * Extracts YouTube's embedded ytInitialPlayerResponse or player data
 */
export function extractInitialPlayerResponse(doc: Document = document): any {
  try {
    const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (win && (win as any).ytInitialPlayerResponse) {
      return (win as any).ytInitialPlayerResponse;
    }

    const moviePlayer = doc.getElementById('movie_player') as any;
    if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
      const resp = moviePlayer.getPlayerResponse();
      if (resp) return resp;
    }

    // Search scripts in document for embedded player response JSON
    const scripts = doc.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent || '';
      if (text.includes('ytInitialPlayerResponse')) {
        // Method 1: Balanced JSON extraction
        const idx = text.indexOf('ytInitialPlayerResponse');
        const braceIdx = text.indexOf('{', idx);
        if (braceIdx !== -1) {
          const parsed = extractBalancedJson(text, braceIdx, '{', '}');
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        }

        // Method 2: Regex fallback
        const match =
          text.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:\s*var|\s*window|\s*<\/script>|$)/s) ||
          text.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?});/s) ||
          text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
        if (match && match[1]) {
          try {
            return JSON.parse(match[1]);
          } catch {
            // continue
          }
        }
      }
    }
  } catch (err) {
    console.warn('[ASKbro YouTube] Error extracting initial player response:', err);
  }
  return null;
}

/**
 * Directly extracts captionTracks array from scripts without relying on full playerResponse parsing
 */
export function extractCaptionTracksFromScripts(doc: Document = document): any[] | null {
  try {
    const scripts = doc.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i++) {
      const text = scripts[i].textContent || '';
      const ctIdx = text.indexOf('"captionTracks":');
      if (ctIdx !== -1) {
        const bracketIdx = text.indexOf('[', ctIdx);
        if (bracketIdx !== -1) {
          const tracks = extractBalancedJson(text, bracketIdx, '[', ']');
          if (Array.isArray(tracks) && tracks.length > 0) {
            return tracks;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[ASKbro YouTube] Error extracting caption tracks from scripts:', err);
  }
  return null;
}

/**
 * Fetches server-rendered watch page HTML to recover fresh captionTracks and shortDescription
 */
export async function fetchWatchPageMetadata(videoId: string): Promise<{
  captionTracks?: any[];
  description?: string;
  playerResponse?: any;
} | null> {
  if (!videoId || typeof fetch === 'undefined') return null;

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const html = await res.text();

    let playerResponse: any = null;
    const respIdx = html.indexOf('ytInitialPlayerResponse');
    if (respIdx !== -1) {
      const braceIdx = html.indexOf('{', respIdx);
      if (braceIdx !== -1) {
        playerResponse = extractBalancedJson(html, braceIdx, '{', '}');
      }
    }

    let captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      const ctIdx = html.indexOf('"captionTracks":');
      if (ctIdx !== -1) {
        const bracketIdx = html.indexOf('[', ctIdx);
        if (bracketIdx !== -1) {
          const parsed = extractBalancedJson(html, bracketIdx, '[', ']');
          if (Array.isArray(parsed) && parsed.length > 0) {
            captionTracks = parsed;
          }
        }
      }
    }

    let description = playerResponse?.videoDetails?.shortDescription;
    if (!description) {
      const sdIdx = html.indexOf('"shortDescription":');
      if (sdIdx !== -1) {
        const quoteStart = html.indexOf('"', sdIdx + 19);
        if (quoteStart !== -1) {
          let isEscaped = false;
          let strEnd = -1;
          for (let i = quoteStart + 1; i < html.length; i++) {
            if (isEscaped) {
              isEscaped = false;
              continue;
            }
            if (html[i] === '\\') {
              isEscaped = true;
              continue;
            }
            if (html[i] === '"') {
              strEnd = i;
              break;
            }
          }
          if (strEnd !== -1) {
            try {
              description = JSON.parse(html.slice(quoteStart, strEnd + 1));
            } catch {
              // ignore
            }
          }
        }
      }
    }

    return {
      captionTracks: Array.isArray(captionTracks) && captionTracks.length > 0 ? captionTracks : undefined,
      description: description || undefined,
      playerResponse: playerResponse || undefined,
    };
  } catch (err) {
    console.warn('[ASKbro YouTube] Error fetching watch page metadata:', err);
    return null;
  }
}

/**
 * Extracts transcript text from DOM rendered segments (ytd-transcript-segment-renderer)
 */
export function extractTranscriptFromDOM(
  doc: Document = document
): { transcript: string; segmentsCount: number } | null {
  const segmentElements = doc.querySelectorAll(
    'ytd-transcript-segment-renderer, [class*="transcript-segment"], ytd-transcript-search-panel-renderer ytd-transcript-segment-renderer'
  );
  if (!segmentElements || segmentElements.length === 0) {
    return null;
  }

  const lines: string[] = [];
  segmentElements.forEach((segment) => {
    const timeEl =
      segment.querySelector('.segment-timestamp') ||
      segment.querySelector('[class*="timestamp"]') ||
      segment.querySelector('#timestamp') ||
      segment.querySelector('.ytd-transcript-segment-renderer .segment-timestamp');
    const textEl =
      segment.querySelector('.segment-text') ||
      segment.querySelector('yt-formatted-string.segment-text') ||
      segment.querySelector('[class*="text"]') ||
      segment.querySelector('#text');

    const timestamp = timeEl?.textContent?.trim() || '';
    const text = textEl?.textContent?.trim() || '';

    if (text) {
      if (timestamp) {
        lines.push(`[${timestamp}] ${text}`);
      } else {
        lines.push(text);
      }
    }
  });

  if (lines.length === 0) return null;

  return {
    transcript: lines.join('\n'),
    segmentsCount: lines.length,
  };
}

/**
 * Attempts to find and click the YouTube "Show transcript" button in the DOM
 */
export async function triggerOpenTranscriptInDOM(doc: Document = document): Promise<boolean> {
  try {
    // 1. If description expander is present, click to expand it
    const expandBtn = doc.querySelector<HTMLElement>(
      '#description-inline-expander #expand, #description #expand, tp-yt-paper-button#expand, ytd-text-inline-expander #expand, #expand-sizer, ytd-watch-metadata #description-inline-expander'
    );
    if (expandBtn && typeof expandBtn.click === 'function') {
      try {
        expandBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        // ignore
      }
    }

    // 2. Look for transcript trigger button in description or page body
    let transcriptBtn =
      doc.querySelector<HTMLElement>('ytd-video-description-transcript-section-renderer button') ||
      doc.querySelector<HTMLElement>('ytd-video-description-transcript-section-renderer ytd-button-renderer') ||
      doc.querySelector<HTMLElement>('ytd-video-description-transcript-section-renderer') ||
      doc.querySelector<HTMLElement>('button[aria-label*="transcript" i]') ||
      doc.querySelector<HTMLElement>('ytd-button-renderer button[aria-label*="transcript" i]') ||
      Array.from(doc.querySelectorAll<HTMLElement>('button, tp-yt-paper-button, yt-button-shape button')).find((b) => {
        const text = (b.textContent || '').toLowerCase();
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return (
          (text.includes('transcript') && (text.includes('show') || text.includes('open') || text.includes('view'))) ||
          (label.includes('transcript') && (label.includes('show') || label.includes('open') || label.includes('view')))
        );
      });

    // 3. Fallback: Check YouTube action bar overflow menu ("..." button)
    if (!transcriptBtn) {
      const moreActionsBtn =
        doc.querySelector<HTMLElement>('#actions ytd-menu-renderer yt-icon-button button') ||
        doc.querySelector<HTMLElement>('#actions ytd-menu-renderer button[aria-label*="More" i]') ||
        doc.querySelector<HTMLElement>('#actions button[aria-label*="More actions" i]') ||
        doc.querySelector<HTMLElement>('ytd-watch-metadata #actions ytd-menu-renderer button');

      if (moreActionsBtn && typeof moreActionsBtn.click === 'function') {
        try {
          moreActionsBtn.click();
          await new Promise((resolve) => setTimeout(resolve, 150));
          transcriptBtn = Array.from(
            doc.querySelectorAll<HTMLElement>(
              'ytd-menu-service-item-renderer, tp-yt-paper-item, [role="menuitem"], ytd-menu-popup-renderer tp-yt-paper-item'
            )
          ).find((item) => (item.textContent || '').toLowerCase().includes('transcript'));
        } catch {
          // ignore
        }
      }
    }

    if (transcriptBtn && typeof transcriptBtn.click === 'function') {
      transcriptBtn.click();
      // Poll up to 2500ms (25 x 100ms) for segments to render
      for (let i = 0; i < 25; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const segs = doc.querySelectorAll('ytd-transcript-segment-renderer, [class*="transcript-segment"]');
        if (segs.length > 0) {
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('[ASKbro YouTube] Error triggering transcript in DOM:', err);
  }
  return false;
}

/**
 * Fetches and parses timedtext captions from caption tracks (JSON3, XML, or auto-translate)
 */
export async function fetchTranscriptFromCaptionTracks(
  tracks: any[]
): Promise<{ transcript: string; segmentsCount: number } | null> {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  // Prefer manual English track, then any English, then any manual, then first track
  const preferredTrack =
    tracks.find((t) => (t.languageCode === 'en' || t.languageCode === 'en-US') && !t.kind) ||
    tracks.find((t) => t.languageCode === 'en' || t.languageCode?.startsWith('en')) ||
    tracks.find((t) => !t.kind) ||
    tracks[0];

  if (!preferredTrack || !preferredTrack.baseUrl) {
    return null;
  }

  try {
    // 1. Attempt JSON3 format
    const jsonUrl = preferredTrack.baseUrl.includes('fmt=json3')
      ? preferredTrack.baseUrl
      : `${preferredTrack.baseUrl}&fmt=json3`;

    const res = await fetch(jsonUrl, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.events)) {
        const lines: string[] = [];
        for (const ev of data.events) {
          let text = '';
          if (Array.isArray(ev.segs)) {
            text = ev.segs
              .map((s: any) => s.utf8 || '')
              .join('')
              .replace(/\n/g, ' ')
              .trim();
          } else if (typeof ev.utf8 === 'string') {
            text = ev.utf8.replace(/\n/g, ' ').trim();
          }
          if (text) {
            const seconds = Math.floor((ev.tStartMs || 0) / 1000);
            lines.push(`[${formatSecondsToTimestamp(seconds)}] ${text}`);
          }
        }
        if (lines.length > 0) {
          return {
            transcript: lines.join('\n'),
            segmentsCount: lines.length,
          };
        }
      }
    }
  } catch {
    // JSON3 failed, fallback to XML
  }

  try {
    // 2. Fallback to XML timedtext
    const xmlUrl = preferredTrack.baseUrl.replace(/[&?]fmt=json3/g, '');
    const res = await fetch(xmlUrl, { credentials: 'include' });
    if (res.ok) {
      const xml = await res.text();
      if (xml && (xml.includes('<text') || xml.includes('<p '))) {
        const lines: string[] = [];
        const regex = /<(?:text|p)\s+[^>]*(?:start|t)="([\d\.]+)"[^>]*>([\s\S]*?)<\/(?:text|p)>/gi;
        let match;
        while ((match = regex.exec(xml)) !== null) {
          const rawSeconds = parseFloat(match[1]) || 0;
          const seconds = match[0].includes(' t="') && rawSeconds > 1000
            ? Math.floor(rawSeconds / 1000)
            : Math.floor(rawSeconds);
          const rawText = decodeHtmlEntities(
            match[2].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
          );
          if (rawText) {
            lines.push(`[${formatSecondsToTimestamp(seconds)}] ${rawText}`);
          }
        }
        if (lines.length > 0) {
          return {
            transcript: lines.join('\n'),
            segmentsCount: lines.length,
          };
        }
      }
    }
  } catch {
    // XML failed
  }

  // 3. Fallback: If non-English, try auto-translate to English
  if (!preferredTrack.languageCode?.startsWith('en')) {
    try {
      const autoTransUrl = `${preferredTrack.baseUrl}&tlang=en&fmt=json3`;
      const res = await fetch(autoTransUrl, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.events)) {
          const lines: string[] = [];
          for (const ev of data.events) {
            let text = '';
            if (Array.isArray(ev.segs)) {
              text = ev.segs
                .map((s: any) => s.utf8 || '')
                .join('')
                .replace(/\n/g, ' ')
                .trim();
            } else if (typeof ev.utf8 === 'string') {
              text = ev.utf8.replace(/\n/g, ' ').trim();
            }
            if (text) {
              const seconds = Math.floor((ev.tStartMs || 0) / 1000);
              lines.push(`[${formatSecondsToTimestamp(seconds)}] ${text}`);
            }
          }
          if (lines.length > 0) {
            return {
              transcript: lines.join('\n'),
              segmentsCount: lines.length,
            };
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export interface YouTubeTranscriptResult {
  transcript: string;
  source: 'panel' | 'captions' | 'description';
  segmentsCount: number;
  playerResponse?: any;
  overrideDescription?: string;
}

/**
 * Extracts transcript via DOM segments, DOM button trigger, caption tracks, or watch page metadata fetch
 */
export async function extractYouTubeTranscript(
  doc: Document = document,
  targetUrl?: string,
  playerResponse?: any
): Promise<YouTubeTranscriptResult> {
  const currentUrl =
    targetUrl ||
    (doc.defaultView && doc.defaultView.location?.href) ||
    doc.location?.href ||
    (typeof window !== 'undefined' ? window.location.href : '');
  const videoId = extractYouTubeVideoId(currentUrl);

  // Method A: Transcript panel is already open in DOM
  const existingDom = extractTranscriptFromDOM(doc);
  if (existingDom && existingDom.transcript) {
    return {
      transcript: existingDom.transcript,
      source: 'panel',
      segmentsCount: existingDom.segmentsCount,
    };
  }

  // Method B: Caption tracks from playerResponse or DOM scripts
  let resp = playerResponse || extractInitialPlayerResponse(doc);
  if (resp?.videoDetails?.videoId && videoId && resp.videoDetails.videoId !== videoId) {
    resp = null;
  }

  let captionTracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    captionTracks = extractCaptionTracksFromScripts(doc) || undefined;
  }

  if (captionTracks && captionTracks.length > 0) {
    const fromTracks = await fetchTranscriptFromCaptionTracks(captionTracks);
    if (fromTracks && fromTracks.transcript) {
      return {
        transcript: fromTracks.transcript,
        source: 'captions',
        segmentsCount: fromTracks.segmentsCount,
        playerResponse: resp,
      };
    }
  }

  // Method C: Try to open transcript panel in DOM
  const opened = await triggerOpenTranscriptInDOM(doc);
  if (opened) {
    const afterOpenDom = extractTranscriptFromDOM(doc);
    if (afterOpenDom && afterOpenDom.transcript) {
      return {
        transcript: afterOpenDom.transcript,
        source: 'panel',
        segmentsCount: afterOpenDom.segmentsCount,
        playerResponse: resp,
      };
    }
  }

  // Method D: Fetch watch page HTML to retrieve fresh captionTracks and uncollapsed shortDescription
  if (videoId) {
    try {
      const fetched = await fetchWatchPageMetadata(videoId);
      if (fetched) {
        if (fetched.captionTracks && fetched.captionTracks.length > 0) {
          const fromFetchedTracks = await fetchTranscriptFromCaptionTracks(fetched.captionTracks);
          if (fromFetchedTracks && fromFetchedTracks.transcript) {
            return {
              transcript: fromFetchedTracks.transcript,
              source: 'captions',
              segmentsCount: fromFetchedTracks.segmentsCount,
              playerResponse: fetched.playerResponse,
              overrideDescription: fetched.description,
            };
          }
        }
        return {
          transcript: '',
          source: 'description',
          segmentsCount: 0,
          playerResponse: fetched.playerResponse,
          overrideDescription: fetched.description,
        };
      }
    } catch (err) {
      console.warn('[ASKbro YouTube] Error in Method D watch page fetch:', err);
    }
  }

  return {
    transcript: '',
    source: 'description',
    segmentsCount: 0,
    playerResponse: resp,
  };
}

/**
 * Scrapes video title, channel, description, chapters, transcript, and player status from YouTube DOM
 */
export function extractYouTubeDetails(
  doc: Document = document,
  targetUrl?: string,
  transcriptInfo?: {
    transcript?: string;
    source?: 'captions' | 'panel' | 'description';
    segmentsCount?: number;
    playerResponse?: any;
    overrideDescription?: string;
  }
): YouTubeVideoDetails {
  const currentUrl =
    targetUrl ||
    (doc.defaultView && doc.defaultView.location?.href) ||
    doc.location?.href ||
    (typeof window !== 'undefined' ? window.location.href : '');
  const videoId = extractYouTubeVideoId(currentUrl);
  const isShorts = isYouTubeShortsUrl(currentUrl);

  let playerResponse = transcriptInfo?.playerResponse;
  if (!playerResponse) {
    playerResponse = extractInitialPlayerResponse(doc);
    if (playerResponse?.videoDetails?.videoId && videoId && playerResponse.videoDetails.videoId !== videoId) {
      playerResponse = null;
    }
  }

  // 1. Title Extraction
  let title = '';
  const titleEl =
    doc.querySelector<HTMLElement>('h1.ytd-watch-metadata yt-formatted-string') ||
    doc.querySelector<HTMLElement>('#title h1 yt-formatted-string') ||
    doc.querySelector<HTMLElement>('h1.title.style-scope.ytd-video-primary-info-renderer') ||
    doc.querySelector<HTMLElement>('h1.title') ||
    doc.querySelector<HTMLElement>('h1');

  if (titleEl && titleEl.textContent?.trim()) {
    title = titleEl.textContent.trim();
  } else if (playerResponse?.videoDetails?.title) {
    title = playerResponse.videoDetails.title.trim();
  } else if (doc.title && doc.title.replace(/ - YouTube$/, '').trim()) {
    // Prefer doc.title over static meta tags because YouTube SPA updates doc.title, not og:title
    title = doc.title.replace(/ - YouTube$/, '').trim();
  } else {
    // Only trust og:title if og:url matches the current video
    const ogUrl = doc.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
    const ogVideoId = extractYouTubeVideoId(ogUrl);
    if (!ogVideoId || !videoId || ogVideoId === videoId) {
      const metaTitle =
        doc.querySelector('meta[name="title"]')?.getAttribute('content') ||
        doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
      if (metaTitle && metaTitle.trim()) {
        title = metaTitle.trim();
      }
    }
  }

  // 2. Channel Extraction
  let channel = '';
  let channelUrl: string | undefined = undefined;

  const channelLinkEl =
    doc.querySelector<HTMLAnchorElement>('#owner #channel-name a') ||
    doc.querySelector<HTMLAnchorElement>('ytd-channel-name a') ||
    doc.querySelector<HTMLAnchorElement>('#channel-name a');

  if (channelLinkEl) {
    channel = channelLinkEl.textContent?.trim() || '';
    channelUrl = channelLinkEl.getAttribute('href') || undefined;
  }

  if (!channel && playerResponse?.videoDetails?.author) {
    channel = playerResponse.videoDetails.author.trim();
  }

  if (!channel) {
    const channelNameEl =
      doc.querySelector('#channel-name yt-formatted-string') ||
      doc.querySelector('ytd-channel-name yt-formatted-string');
    if (channelNameEl && channelNameEl.textContent?.trim()) {
      channel = channelNameEl.textContent.trim();
    } else {
      const metaAuthor =
        doc.querySelector('link[itemprop="name"]')?.getAttribute('content') ||
        doc.querySelector('[itemprop="author"] link[itemprop="name"]')?.getAttribute('content');
      if (metaAuthor && metaAuthor.trim()) {
        channel = metaAuthor.trim();
      }
    }
  }

  // 3. Description Extraction
  let description = transcriptInfo?.overrideDescription || '';

  if (!description) {
    const descEl =
      doc.querySelector<HTMLElement>('#description-inline-expander #content yt-attributed-string') ||
      doc.querySelector<HTMLElement>('#description-inline-expander yt-attributed-string') ||
      doc.querySelector<HTMLElement>('#description-inline-expander') ||
      doc.querySelector<HTMLElement>('#description-inner') ||
      doc.querySelector<HTMLElement>('#description yt-formatted-string') ||
      doc.querySelector<HTMLElement>('#description');

    if (descEl && descEl.textContent?.trim()) {
      // Strip trailing "Show less" if present
      description = descEl.textContent.replace(/Show less\s*$/i, '').trim();
    }
  }

  // If playerResponse contains the uncollapsed full shortDescription, prefer it when longer
  const playerDesc = playerResponse?.videoDetails?.shortDescription;
  if (playerDesc && playerDesc.trim().length > description.length) {
    description = playerDesc.trim();
  }

  if (!description || description.length < 20) {
    // Only trust og:description if og:url matches the current video
    const ogUrl = doc.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
    const ogVideoId = extractYouTubeVideoId(ogUrl);
    if (!ogVideoId || !videoId || ogVideoId === videoId) {
      const metaDesc =
        doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
        doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
      if (metaDesc && metaDesc.trim()) {
        description = metaDesc.trim();
      }
    }
  }

  description = cleanExtractedText(description);

  // 4. Chapters Extraction
  const chapters: YouTubeVideoChapter[] = [];

  // Check if active watch element matches current video to avoid residual chapters from previous video in SPA
  const watchFlexy = doc.querySelector('ytd-watch-flexy[video-id]');
  const flexyVideoId = watchFlexy?.getAttribute('video-id');
  const isWatchElementMatching = !flexyVideoId || !videoId || flexyVideoId === videoId;

  // A. Native macro markers (YouTube chapter list / drawer)
  const markerElements = isWatchElementMatching
    ? doc.querySelectorAll('ytd-macro-markers-list-item-renderer')
    : [];
  if (markerElements.length > 0) {
    markerElements.forEach((marker) => {
      const timeEl =
        marker.querySelector('[id="time"]') ||
        marker.querySelector('#time') ||
        marker.querySelector('.ytd-macro-markers-list-item-renderer #time');
      const titleEl =
        marker.querySelector('[id="details"] h4') ||
        marker.querySelector('#details h4') ||
        marker.querySelector('h4') ||
        marker.querySelector('#endpoint #details') ||
        marker.querySelector('.macro-markers');

      const timeText = timeEl?.textContent?.trim();
      const titleText = titleEl?.textContent?.trim();

      if (timeText && titleText) {
        const seconds = parseTimestampToSeconds(timeText);
        chapters.push({
          time: seconds,
          timestampStr: formatSecondsToTimestamp(seconds),
          title: titleText,
        });
      }
    });
  }

  // B. Timestamp links inside description (e.g. <a href="...&t=123s">01:23</a>)
  if (chapters.length === 0) {
    const descTimeLinks = doc.querySelectorAll<HTMLAnchorElement>(
      '#description a[href*="t="], #description-inline-expander a[href*="t="]'
    );
    descTimeLinks.forEach((link) => {
      const text = link.textContent?.trim() || '';
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
        const seconds = parseTimestampToSeconds(text);
        // Find adjacent text node for chapter label
        let label = '';
        const parent = link.parentElement;
        if (parent) {
          const parentText = parent.textContent || '';
          const match = parentText.match(new RegExp(`${text}\\s*${SEP_CLASS}?\\s*([^\\n]+)`));
          if (match && match[1]) {
            label = match[1].trim();
          }
        }
        chapters.push({
          time: seconds,
          timestampStr: formatSecondsToTimestamp(seconds),
          title: label || `Chapter at ${text}`,
        });
      }
    });
  }

  // C. Fallback: Parse description text directly with regex
  if (chapters.length === 0 && description) {
    const parsedFromDesc = extractChaptersFromText(description);
    chapters.push(...parsedFromDesc);
  }

  // Sort and deduplicate chapters
  const uniqueChaptersMap = new Map<number, YouTubeVideoChapter>();
  for (const ch of chapters) {
    if (!uniqueChaptersMap.has(ch.time)) {
      uniqueChaptersMap.set(ch.time, ch);
    }
  }
  const sortedChapters = Array.from(uniqueChaptersMap.values()).sort((a, b) => a.time - b.time);

  // 5. Video Element & Player Status
  const videoEl =
    doc.querySelector<HTMLVideoElement>('video.html5-main-video') ||
    doc.querySelector<HTMLVideoElement>('video');

  const isLive = Boolean(
    doc.querySelector('.ytp-live') ||
    doc.querySelector('.ytp-live-badge') ||
    (videoEl && videoEl.duration === Infinity)
  );

  let durationSeconds: number | undefined = undefined;
  let durationFormatted: string | undefined = undefined;

  if (videoEl && videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0) {
    durationSeconds = Math.floor(videoEl.duration);
    durationFormatted = formatSecondsToTimestamp(durationSeconds);
  }

  const currentTimeSeconds =
    videoEl && videoEl.currentTime !== undefined ? Math.floor(videoEl.currentTime) : undefined;

  // 6. Transcript resolution
  let transcript = transcriptInfo?.transcript;
  let transcriptSource = transcriptInfo?.source;
  let transcriptSegmentsCount = transcriptInfo?.segmentsCount;

  // If not provided by async caller, check if transcript segments exist in DOM right now
  if (!transcript) {
    const domTranscript = extractTranscriptFromDOM(doc);
    if (domTranscript && domTranscript.transcript) {
      transcript = domTranscript.transcript;
      transcriptSource = 'panel';
      transcriptSegmentsCount = domTranscript.segmentsCount;
    }
  }

  return {
    videoId,
    title: title || 'Untitled YouTube Video',
    channel: channel || 'Unknown Channel',
    channelUrl,
    description,
    chapters: sortedChapters,
    durationSeconds,
    durationFormatted,
    currentTimeSeconds,
    isLive,
    isShorts,
    transcript,
    transcriptSource,
    transcriptSegmentsCount,
  };
}

/**
 * Asynchronously extracts complete YouTube details including transcript
 */
export async function extractYouTubeDetailsAsync(
  doc: Document = document,
  targetUrl?: string
): Promise<YouTubeVideoDetails> {
  const currentUrl =
    targetUrl ||
    (doc.defaultView && doc.defaultView.location?.href) ||
    doc.location?.href ||
    (typeof window !== 'undefined' ? window.location.href : '');

  const videoId = extractYouTubeVideoId(currentUrl);
  let playerResponse = extractInitialPlayerResponse(doc);
  if (playerResponse?.videoDetails?.videoId && videoId && playerResponse.videoDetails.videoId !== videoId) {
    playerResponse = null;
  }

  const transcriptResult = await extractYouTubeTranscript(doc, currentUrl, playerResponse);

  const resolvedPlayerResponse = transcriptResult.playerResponse || playerResponse;
  const resolvedOverrideDescription = transcriptResult.overrideDescription;

  return extractYouTubeDetails(doc, currentUrl, {
    transcript: transcriptResult.transcript,
    source: transcriptResult.source,
    segmentsCount: transcriptResult.segmentsCount,
    playerResponse: resolvedPlayerResponse,
    overrideDescription: resolvedOverrideDescription,
  });
}

/**
 * Seeks YouTube video element to the given time in seconds
 */
export function seekYouTubeVideo(seconds: number): SeekVideoResponse {
  try {
    const video =
      document.querySelector<HTMLVideoElement>('video.html5-main-video') ||
      document.querySelector<HTMLVideoElement>('video');

    if (!video) {
      console.warn('[ASKbro YouTube] HTML5 video element not found on page.');
      return {
        success: false,
        error: 'YouTube HTML5 video player not found on the active page.',
      };
    }

    const targetTime = Math.max(0, seconds);
    video.currentTime = targetTime;

    console.log(`[ASKbro YouTube] Successfully sought video to ${targetTime}s (${formatSecondsToTimestamp(targetTime)})`);

    return {
      success: true,
      currentTime: targetTime,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[ASKbro YouTube] Error seeking video:', err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Formats YouTube details into high-density prompt text for Gemini summarizer
 */
export function formatYouTubeContentForSummarizer(details: YouTubeVideoDetails): string {
  const parts: string[] = [];

  parts.push(`Video Title: ${details.title}`);
  parts.push(`Channel: ${details.channel}`);
  if (details.videoId) {
    parts.push(`YouTube Video ID: ${details.videoId}`);
  }
  if (details.durationFormatted) {
    parts.push(`Duration: ${details.durationFormatted}`);
  }
  if (details.isLive) {
    parts.push(`Broadcast Status: Live Stream`);
  }
  if (details.isShorts) {
    parts.push(`Video Format: YouTube Shorts clip`);
  }

  if (details.chapters && details.chapters.length > 0) {
    parts.push('\nAvailable Creator Chapter Markers:');
    details.chapters.forEach((ch) => {
      parts.push(`- [${ch.timestampStr}] ${ch.title}`);
    });
  }

  if (details.description && details.description.trim()) {
    parts.push('\nVideo Description:');
    parts.push(details.description);
  } else {
    parts.push('\nVideo Description: [No description provided by creator]');
  }

  if (details.transcript && details.transcript.trim()) {
    parts.push('\nVideo Transcript / Spoken Content:');
    parts.push(details.transcript.trim());
  } else {
    parts.push('\nVideo Transcript: [Spoken subtitles/transcript unavailable for this video. Use video title, chapters, and description for core takeaways and answers.]');
  }

  return parts.join('\n');
}

/**
 * Registers message listener for SEEK_VIDEO and YouTube interactions
 */
export function registerYouTubeListener(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SEEK_VIDEO') {
      const seconds = typeof message.seconds === 'number' ? message.seconds : 0;
      const result = seekYouTubeVideo(seconds);
      sendResponse(result);
      return true;
    }
    return false;
  });

  // Listen for YouTube SPA navigation events to notify side panel of in-tab URL changes
  if (typeof window !== 'undefined') {
    let lastUrl = window.location.href;

    const notifyNavigation = () => {
      const currentUrl = window.location.href;
      if (currentUrl === lastUrl) return;
      lastUrl = currentUrl;

      try {
        chrome.runtime.sendMessage({
          type: 'YOUTUBE_NAVIGATED',
          url: currentUrl,
          title: document.title ? document.title.replace(/ - YouTube$/, '').trim() : 'YouTube',
        });
      } catch {
        // Extension context invalidated or sidepanel closed
      }
    };

    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(notifyNavigation, 300);
    });
    window.addEventListener('yt-page-data-updated', () => {
      setTimeout(notifyNavigation, 300);
    });
    window.addEventListener('popstate', () => {
      setTimeout(notifyNavigation, 300);
    });
  }

  console.log('[ASKbro YouTube] YouTube seek and SPA navigation listeners registered successfully.');
}
