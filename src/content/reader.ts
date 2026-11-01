/**
 * ASKbro Content Script - Article & Page Text Extractor
 * Leverages @mozilla/readability with intelligent fallback DOM parsing
 */

import { Readability } from '@mozilla/readability';
import {
  ExtractPageContentOptions,
  PageContentResponse,
} from '../types/messages';
import {
  checkIsYouTubeUrl,
  isYouTubeWatchUrl,
  isYouTubeShortsUrl,
  extractYouTubeDetails,
  extractYouTubeDetailsAsync,
  extractYouTubeVideoId,
  formatYouTubeContentForSummarizer,
} from './youtube';

/**
 * Standard adult reading speed in words per minute
 */
const WORDS_PER_MINUTE = 200;

/**
 * Non-content selectors stripped during fallback extraction
 */
const CLUTTER_SELECTORS = [
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'nav',
  'footer',
  'header',
  'aside',
  'template',
  'dialog',
  'select',
  'textarea',
  '[aria-hidden="true"]',
  '[hidden]',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="alert"]',
  '.cookie-banner',
  '.cookie-consent',
  '.cookie-notice',
  '#cookie-banner',
  '#cookie-notice',
  '#cookie-consent',
  '.ad',
  '.advertisement',
  '.adsbygoogle',
  '.social-share',
  '.share-buttons',
  '.social-links',
  '.sidebar',
  '#sidebar',
];

/**
 * Normalizes extracted text: collapses whitespace, limits blank lines, trims edges
 */
export function cleanExtractedText(text: string): string {
  if (!text) return '';

  return text
    // Normalize newlines
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Replace tabs and multiple horizontal spaces with a single space
    .replace(/[ \t]+/g, ' ')
    // Replace 3 or more consecutive newlines with 2 newlines (paragraph separator)
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    // Trim each line
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    // Trim whole string
    .trim();
}

/**
 * Calculates estimated reading time in minutes and word count
 */
export function calculateReadingTime(text: string): { wordCount: number; readingTimeMinutes: number } {
  if (!text || !text.trim()) {
    return { wordCount: 0, readingTimeMinutes: 0 };
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readingTimeMinutes = wordCount > 0 ? Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE)) : 0;

  return { wordCount, readingTimeMinutes };
}

/**
 * Extracts author / byline from document metadata and DOM microdata
 */
export function extractAuthorFromDOM(doc: Document): string | undefined {
  // Check standard meta tags
  const metaAuthor =
    doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
    doc.querySelector('meta[property="article:author"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:creator"]')?.getAttribute('content') ||
    doc.querySelector('meta[property="og:article:author"]')?.getAttribute('content');

  if (metaAuthor && metaAuthor.trim()) {
    return metaAuthor.trim();
  }

  // Check author elements
  const authorEl = doc.querySelector(
    '[rel="author"], [itemprop="author"], .author, .byline, .author-name, .entry-author'
  );
  if (authorEl && authorEl.textContent) {
    const text = authorEl.textContent.trim().replace(/^by:?\s+/i, '');
    if (text.length > 0 && text.length < 100) {
      return text;
    }
  }

  return undefined;
}

/**
 * Extracts page title from document and meta tags
 */
export function extractTitleFromDOM(doc: Document, targetUrl?: string): string {
  const currentUrl =
    targetUrl ||
    (doc.defaultView && doc.defaultView.location?.href) ||
    doc.location?.href ||
    (typeof window !== 'undefined' ? window.location.href : '');
  const isYouTube = checkIsYouTubeUrl(currentUrl);

  // For YouTube or SPA pages, document.title is dynamically updated by the client router,
  // whereas <meta property="og:title"> remains stuck on the first page loaded in that session.
  if (isYouTube) {
    if (doc.title && doc.title.trim()) {
      const cleanTitle = doc.title.replace(/ - YouTube$/, '').trim();
      if (cleanTitle) {
        return cleanTitle;
      }
    }
  }

  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
  if (ogTitle && ogTitle.trim()) {
    return ogTitle.trim();
  }

  const twitterTitle = doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content');
  if (twitterTitle && twitterTitle.trim()) {
    return twitterTitle.trim();
  }

  if (doc.title && doc.title.trim()) {
    return doc.title.trim();
  }

  const h1 = doc.querySelector('h1')?.textContent?.trim();
  if (h1) {
    return h1;
  }

  return 'Untitled Page';
}

/**
 * Extracts site name from meta tags or hostname
 */
export function extractSiteNameFromDOM(doc: Document): string {
  const ogSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (ogSiteName && ogSiteName.trim()) {
    return ogSiteName.trim();
  }

  const appName = doc.querySelector('meta[name="application-name"]')?.getAttribute('content');
  if (appName && appName.trim()) {
    return appName.trim();
  }

  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname.replace(/^www\./, '');
  }

  return '';
}

/**
 * Extracts excerpt from meta tags or first paragraph of text
 */
export function extractExcerptFromDOM(doc: Document, fallbackText: string): string {
  const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content');
  if (ogDesc && ogDesc.trim()) {
    return ogDesc.trim();
  }

  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content');
  if (metaDesc && metaDesc.trim()) {
    return metaDesc.trim();
  }

  const twitterDesc = doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content');
  if (twitterDesc && twitterDesc.trim()) {
    return twitterDesc.trim();
  }

  // Create clean snippet from first ~200 characters of text
  if (fallbackText) {
    const snippet = fallbackText.substring(0, 240).trim();
    if (snippet.length >= 240) {
      const lastSpace = snippet.lastIndexOf(' ');
      return (lastSpace > 160 ? snippet.substring(0, lastSpace) : snippet) + '...';
    }
    return snippet;
  }

  return '';
}

/**
 * Detects if the current URL is a YouTube video page
 */
export function checkIsYouTube(urlStr: string): boolean {
  if (!urlStr) return false;
  return isYouTubeWatchUrl(urlStr) || isYouTubeShortsUrl(urlStr);
}

/**
 * Fallback DOM text extractor for pages where Readability returns null or empty content
 */
export function extractFallbackBodyText(doc: Document): string {
  if (!doc.body) {
    return '';
  }

  // 1. Clone body to safely mutate without affecting host page layout
  let bodyClone: HTMLElement;
  try {
    bodyClone = doc.body.cloneNode(true) as HTMLElement;
  } catch {
    return cleanExtractedText(doc.body.innerText || doc.body.textContent || '');
  }

  // 2. Strip non-content and clutter elements
  CLUTTER_SELECTORS.forEach((selector) => {
    try {
      const elements = bodyClone.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    } catch {
      // Ignore query selector issues on unusual pseudo-elements
    }
  });

  // 3. Look for primary main content container
  const mainCandidate = bodyClone.querySelector<HTMLElement>(
    'main, [role="main"], article, #content, .content, #main, .main, .post-content, .article-content, .entry-content'
  );

  const targetNode = mainCandidate && (mainCandidate.textContent?.trim().length || 0) > 100
    ? mainCandidate
    : bodyClone;

  // 4. Extract structured text from block level elements
  const blockElements = targetNode.querySelectorAll<HTMLElement>(
    'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd, pre, code'
  );

  let accumulatedText = '';
  if (blockElements.length > 0) {
    const textPieces: string[] = [];
    blockElements.forEach((el) => {
      const line = el.textContent?.trim();
      if (line && line.length > 0) {
        textPieces.push(line);
      }
    });
    accumulatedText = textPieces.join('\n\n');
  }

  // 5. If block elements were sparse, use innerText / textContent
  if (!accumulatedText || accumulatedText.trim().length < 60) {
    accumulatedText = targetNode.innerText || targetNode.textContent || '';
  }

  return cleanExtractedText(accumulatedText);
}

/**
 * Core article extractor: applies @mozilla/readability on cloned DOM with graceful fallback
 */
export function extractPageContent(
  doc: Document = document,
  options?: ExtractPageContentOptions
): PageContentResponse {
  const currentUrl =
    (doc.defaultView && doc.defaultView.location?.href) ||
    doc.location?.href ||
    (typeof window !== 'undefined' ? window.location.href : '');
  const isYTDomain = checkIsYouTubeUrl(currentUrl);
  const isYouTubeWatch = checkIsYouTube(currentUrl);
  const isYouTube = isYTDomain;

  const defaultTitle = extractTitleFromDOM(doc, currentUrl);
  const siteName = isYTDomain ? 'YouTube' : extractSiteNameFromDOM(doc);
  const domAuthor = extractAuthorFromDOM(doc);
  let videoDetails: PageContentResponse['videoDetails'] = undefined;

  // Case 1: Active YouTube watch/shorts video page
  if (isYouTubeWatch && !options?.forceFallback) {
    try {
      videoDetails = extractYouTubeDetails(doc, currentUrl);
      const formattedContent = formatYouTubeContentForSummarizer(videoDetails);
      const finalContent = options?.maxLength
        ? formattedContent.slice(0, options.maxLength)
        : formattedContent;
      const { wordCount, readingTimeMinutes } = calculateReadingTime(finalContent);
      const excerpt = extractExcerptFromDOM(doc, videoDetails.description || finalContent);

      return {
        success: true,
        title: videoDetails.title || defaultTitle,
        url: currentUrl,
        textContent: finalContent,
        excerpt: excerpt || videoDetails.description.slice(0, 200),
        byline: videoDetails.channel || domAuthor,
        author: videoDetails.channel || domAuthor,
        siteName: 'YouTube',
        length: finalContent.length,
        wordCount,
        readingTimeMinutes,
        extractedWith: 'youtube',
        timestamp: Date.now(),
        isYouTube: true,
        videoDetails,
      };
    } catch (e) {
      console.warn('[ASKbro Reader] Error executing extractYouTubeDetails, continuing to fallback:', e);
    }
  }

  // Case 2: YouTube non-watch page (Home / Feed / Channel / Search)
  // Prevents Readability from scraping stale og:title or hidden SPA watch elements
  if (isYTDomain && !isYouTubeWatch) {
    const rawTitle = doc.title ? doc.title.replace(/ - YouTube$/, '').trim() : '';
    const pageTitle = rawTitle && rawTitle.toLowerCase() !== 'youtube' ? rawTitle : 'YouTube';
    const cleanContent = `YouTube Page: ${pageTitle}\nURL: ${currentUrl}\nStatus: Browsing YouTube. Open or select any video to summarize, inspect chapters, or ask questions with ASKbro.`;
    const { wordCount, readingTimeMinutes } = calculateReadingTime(cleanContent);

    return {
      success: true,
      title: pageTitle,
      url: currentUrl,
      textContent: cleanContent,
      excerpt: `Browsing YouTube (${pageTitle}). Click any video to analyze its content.`,
      byline: 'YouTube',
      author: 'YouTube',
      siteName: 'YouTube',
      length: cleanContent.length,
      wordCount,
      readingTimeMinutes,
      extractedWith: 'youtube',
      timestamp: Date.now(),
      isYouTube: true,
      videoDetails: undefined,
    };
  }

  // Handle force fallback test mode or non-Readability flow
  if (options?.forceFallback) {
    const fallbackText = extractFallbackBodyText(doc);
    const { wordCount, readingTimeMinutes } = calculateReadingTime(fallbackText);
    const excerpt = extractExcerptFromDOM(doc, fallbackText);

    return {
      success: true,
      title: defaultTitle,
      url: currentUrl,
      textContent: options.maxLength ? fallbackText.slice(0, options.maxLength) : fallbackText,
      excerpt,
      byline: domAuthor,
      author: domAuthor,
      siteName,
      length: fallbackText.length,
      wordCount,
      readingTimeMinutes,
      extractedWith: 'fallback',
      timestamp: Date.now(),
      isYouTube,
      videoDetails,
    };
  }

  // Attempt Readability extraction on cloned document
  let readabilityArticle: ReturnType<InstanceType<typeof Readability>['parse']> = null;

  try {
    // Clone document DOM so Readability can freely strip and mutate nodes
    let docClone: Document;
    try {
      docClone = doc.cloneNode(true) as Document;
    } catch {
      // Fallback DOM parser if direct clone throws
      const parser = new DOMParser();
      docClone = parser.parseFromString(doc.documentElement.outerHTML, 'text/html');
    }

    const reader = new Readability(docClone, {
      charThreshold: 30,
      classesToPreserve: ['highlight', 'code', 'pre'],
    });

    readabilityArticle = reader.parse();
  } catch (error) {
    console.warn('[ASKbro Reader] Readability parsing threw error, falling back to body extractor:', error);
    readabilityArticle = null;
  }

  // Check if Readability returned a viable article with text content
  const rawReadabilityText = readabilityArticle?.textContent ? cleanExtractedText(readabilityArticle.textContent) : '';
  const isReadabilityViable = Boolean(rawReadabilityText && rawReadabilityText.length >= 80);

  if (isReadabilityViable && readabilityArticle) {
    const finalContent = options?.maxLength
      ? rawReadabilityText.slice(0, options.maxLength)
      : rawReadabilityText;
    const { wordCount, readingTimeMinutes } = calculateReadingTime(finalContent);

    const title = (readabilityArticle.title && readabilityArticle.title.trim()) || defaultTitle;
    const author = (readabilityArticle.byline && readabilityArticle.byline.trim()) || domAuthor;
    const articleExcerpt = (readabilityArticle.excerpt && readabilityArticle.excerpt.trim()) ||
      extractExcerptFromDOM(doc, finalContent);

    return {
      success: true,
      title,
      url: currentUrl,
      textContent: finalContent,
      excerpt: articleExcerpt,
      byline: author,
      author,
      siteName: (readabilityArticle.siteName && readabilityArticle.siteName.trim()) || siteName,
      length: finalContent.length,
      wordCount,
      readingTimeMinutes,
      extractedWith: 'readability',
      timestamp: Date.now(),
      isYouTube,
      videoDetails,
    };
  }

  // Graceful Fallback: Readability returned null or sparse content
  const fallbackText = extractFallbackBodyText(doc);
  const finalFallbackContent = options?.maxLength
    ? fallbackText.slice(0, options.maxLength)
    : fallbackText;
  const { wordCount, readingTimeMinutes } = calculateReadingTime(finalFallbackContent);
  const excerpt = extractExcerptFromDOM(doc, finalFallbackContent);

  return {
    success: true,
    title: defaultTitle,
    url: currentUrl,
    textContent: finalFallbackContent,
    excerpt,
    byline: domAuthor,
    author: domAuthor,
    siteName,
    length: finalFallbackContent.length,
    wordCount,
    readingTimeMinutes,
    extractedWith: isYouTube ? 'youtube' : 'fallback',
    timestamp: Date.now(),
    isYouTube,
    videoDetails,
  };
}

/**
 * Asynchronous page extractor: leverages extractYouTubeDetailsAsync on YouTube watch pages
 * to ensure spoken transcripts and uncollapsed video descriptions are retrieved.
 */
export async function extractPageContentAsync(
  doc: Document = document,
  options?: ExtractPageContentOptions
): Promise<PageContentResponse> {
  const currentUrl =
    (doc.defaultView && doc.defaultView.location?.href) ||
    doc.location?.href ||
    (typeof window !== 'undefined' ? window.location.href : '');
  const isYouTubeWatch = checkIsYouTube(currentUrl);

  // For YouTube watch pages, use async video details extractor with transcript scraping
  if (isYouTubeWatch && !options?.forceFallback) {
    try {
      const videoDetails = await extractYouTubeDetailsAsync(doc, currentUrl);
      const formattedContent = formatYouTubeContentForSummarizer(videoDetails);
      const finalContent = options?.maxLength
        ? formattedContent.slice(0, options.maxLength)
        : formattedContent;
      const { wordCount, readingTimeMinutes } = calculateReadingTime(finalContent);
      const excerpt = extractExcerptFromDOM(doc, videoDetails.description || finalContent);

      return {
        success: true,
        title: videoDetails.title || extractTitleFromDOM(doc, currentUrl),
        url: currentUrl,
        textContent: finalContent,
        excerpt: excerpt || videoDetails.description.slice(0, 200),
        byline: videoDetails.channel || extractAuthorFromDOM(doc),
        author: videoDetails.channel || extractAuthorFromDOM(doc),
        siteName: 'YouTube',
        length: finalContent.length,
        wordCount,
        readingTimeMinutes,
        extractedWith: 'youtube',
        timestamp: Date.now(),
        isYouTube: true,
        videoDetails,
      };
    } catch (e) {
      console.warn('[ASKbro Reader] Error executing extractYouTubeDetailsAsync, continuing to fallback:', e);
    }
  }

  // Fallback to standard extraction
  return extractPageContent(doc, options);
}

/**
 * Initializes runtime message listener for article extraction in content script
 */
export function registerReaderListener(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'EXTRACT_PAGE_CONTENT') {
      (async () => {
        try {
          const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
          const isWatch = checkIsYouTube(currentUrl);

          if (isWatch && typeof document !== 'undefined') {
            const urlVideoId = extractYouTubeVideoId(currentUrl);
            const watchFlexy = document.querySelector('ytd-watch-flexy[video-id]');
            const flexyVideoId = watchFlexy?.getAttribute('video-id');

            // If YouTube SPA router is transitioning and DOM still holds previous video-id, wait for DOM swap
            if (flexyVideoId && urlVideoId && flexyVideoId !== urlVideoId) {
              await new Promise((resolve) => setTimeout(resolve, 350));
            }
          }

          const result = await extractPageContentAsync(document, message.options);
          sendResponse(result);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error('[ASKbro Reader] Error executing EXTRACT_PAGE_CONTENT:', err);
          sendResponse({
            success: false,
            error: errorMessage,
            title: document.title || 'Error',
            url: window.location.href,
            textContent: '',
            length: 0,
            wordCount: 0,
            readingTimeMinutes: 0,
            extractedWith: 'fallback',
            timestamp: Date.now(),
          } as PageContentResponse);
        }
      })();
      return true; // Keep channel open for asynchronous reply
    }
    return false;
  });

  console.log('[ASKbro Reader] Reader listener registered successfully.');
}

