import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  checkIsYouTubeUrl,
  isYouTubeWatchUrl,
  isYouTubeShortsUrl,
  extractYouTubeVideoId,
  parseTimestampToSeconds,
  formatSecondsToTimestamp,
  extractChaptersFromText,
  extractYouTubeDetails,
  extractYouTubeDetailsAsync,
  extractInitialPlayerResponse,
  extractTranscriptFromDOM,
  fetchTranscriptFromCaptionTracks,
  extractYouTubeTranscript,
  seekYouTubeVideo,
  formatYouTubeContentForSummarizer,
  extractBalancedJson,
  decodeHtmlEntities,
  extractCaptionTracksFromScripts,
  fetchWatchPageMetadata,
} from '../src/content/youtube';
import {
  buildYouTubeSummarizationSystemInstruction,
  buildSummarizationSystemInstruction,
  parseStructuredSummary,
  formatSummaryAsMarkdown,
} from '../src/services/ai/promptBuilder';

test('YouTube URL Utilities - Domain Detection', () => {
  assert.equal(checkIsYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(checkIsYouTubeUrl('https://youtube.com/watch?v=test'), true);
  assert.equal(checkIsYouTubeUrl('https://m.youtube.com/watch?v=test'), true);
  assert.equal(checkIsYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(checkIsYouTubeUrl('https://www.youtube.com/shorts/abcdef'), true);

  assert.equal(checkIsYouTubeUrl('https://google.com'), false);
  assert.equal(checkIsYouTubeUrl('https://vimeo.com/12345'), false);
  assert.equal(checkIsYouTubeUrl(''), false);
  assert.equal(checkIsYouTubeUrl(undefined), false);
  assert.equal(checkIsYouTubeUrl('not-a-url'), false);
});

test('YouTube URL Utilities - Watch and Shorts Detection', () => {
  assert.equal(isYouTubeWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isYouTubeWatchUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  assert.equal(isYouTubeWatchUrl('https://www.youtube.com/feed/subscriptions'), false);
  assert.equal(isYouTubeWatchUrl('https://www.youtube.com/shorts/12345'), false);

  assert.equal(isYouTubeShortsUrl('https://www.youtube.com/shorts/abcdef123'), true);
  assert.equal(isYouTubeShortsUrl('https://www.youtube.com/watch?v=abcdef123'), false);
  assert.equal(isYouTubeShortsUrl('https://google.com'), false);
});

test('YouTube URL Utilities - Video ID Extraction', () => {
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  assert.equal(
    extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ'
  );
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/shorts/xyz98765'),
    'xyz98765'
  );
  assert.equal(extractYouTubeVideoId('https://youtube.com'), '');
  assert.equal(extractYouTubeVideoId(''), '');
});

test('YouTube Timestamp - parseTimestampToSeconds', () => {
  assert.equal(parseTimestampToSeconds('00:00'), 0);
  assert.equal(parseTimestampToSeconds('0:00'), 0);
  assert.equal(parseTimestampToSeconds('0:45'), 45);
  assert.equal(parseTimestampToSeconds('01:23'), 83);
  assert.equal(parseTimestampToSeconds('10:00'), 600);
  assert.equal(parseTimestampToSeconds('1:05:30'), 3930);
  assert.equal(parseTimestampToSeconds('[02:15]'), 135);
  assert.equal(parseTimestampToSeconds('(03:45)'), 225);
  assert.equal(parseTimestampToSeconds('120'), 120);

  // Invalid strings return 0 safely
  assert.equal(parseTimestampToSeconds('invalid'), 0);
  assert.equal(parseTimestampToSeconds(''), 0);
  assert.equal(parseTimestampToSeconds('::'), 0);
});

test('YouTube Timestamp - formatSecondsToTimestamp', () => {
  assert.equal(formatSecondsToTimestamp(0), '00:00');
  assert.equal(formatSecondsToTimestamp(45), '00:45');
  assert.equal(formatSecondsToTimestamp(83), '01:23');
  assert.equal(formatSecondsToTimestamp(600), '10:00');
  assert.equal(formatSecondsToTimestamp(3930), '01:05:30');
  assert.equal(formatSecondsToTimestamp(3665), '01:01:05');

  // Negative or NaN fallback
  assert.equal(formatSecondsToTimestamp(-10), '00:00');
  assert.equal(formatSecondsToTimestamp(NaN), '00:00');
});

test('YouTube Chapter Extraction - extractChaptersFromText', () => {
  const sampleDescription = `
Check out this full tutorial on AI Agents in Chrome!
Links mentioned in video: https://github.com/example

Timestamps:
00:00 - Introduction & Overview
01:30 Setup and Environment
[04:45] Designing the Architecture
1:10:15 - Q&A and Final Thoughts

Subscribe for more videos!
  `;

  const chapters = extractChaptersFromText(sampleDescription);
  assert.equal(chapters.length, 4);

  assert.equal(chapters[0].time, 0);
  assert.equal(chapters[0].timestampStr, '00:00');
  assert.equal(chapters[0].title, 'Introduction & Overview');

  assert.equal(chapters[1].time, 90);
  assert.equal(chapters[1].timestampStr, '01:30');
  assert.equal(chapters[1].title, 'Setup and Environment');

  assert.equal(chapters[2].time, 285);
  assert.equal(chapters[2].timestampStr, '04:45');
  assert.equal(chapters[2].title, 'Designing the Architecture');

  assert.equal(chapters[3].time, 4215);
  assert.equal(chapters[3].timestampStr, '01:10:15');
  assert.equal(chapters[3].title, 'Q&A and Final Thoughts');
});

test('YouTube DOM Details Extraction - Complete Watch Page', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Building Chrome AI Agents - YouTube</title>
        <meta name="title" content="Building Chrome AI Agents" />
        <meta name="description" content="A comprehensive tutorial on building Manifest V3 AI browser agents." />
      </head>
      <body>
        <div id="title">
          <h1>
            <yt-formatted-string>Building Chrome AI Agents with Gemini Flash</yt-formatted-string>
          </h1>
        </div>
        <div id="owner">
          <div id="channel-name">
            <a href="/@CodeMaster">Code Master</a>
          </div>
        </div>
        <div id="description-inline-expander">
          <yt-attributed-string>
            In this video, we build ASKbro Chrome agent.
            00:00 Intro
            02:15 Vite Setup
            05:30 Gemini API Call
            Show less
          </yt-attributed-string>
        </div>
        <video class="html5-main-video"></video>
      </body>
    </html>
  `;

  const dom = new JSDOM(html, { url: 'https://www.youtube.com/watch?v=demo12345' });
  const doc = dom.window.document;

  // Mock video element properties
  const video = doc.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'duration', { value: 600, writable: true });
  Object.defineProperty(video, 'currentTime', { value: 45, writable: true });

  const details = extractYouTubeDetails(doc, 'https://www.youtube.com/watch?v=demo12345');

  assert.equal(details.videoId, 'demo12345');
  assert.equal(details.title, 'Building Chrome AI Agents with Gemini Flash');
  assert.equal(details.channel, 'Code Master');
  assert.equal(details.channelUrl, '/@CodeMaster');
  assert.equal(details.durationSeconds, 600);
  assert.equal(details.durationFormatted, '10:00');
  assert.equal(details.currentTimeSeconds, 45);
  assert.equal(details.isLive, false);
  assert.equal(details.isShorts, false);

  // Verify chapters parsed from description
  assert.equal(details.chapters.length, 3);
  assert.equal(details.chapters[0].timestampStr, '00:00');
  assert.equal(details.chapters[0].title, 'Intro');
  assert.equal(details.chapters[1].timestampStr, '02:15');
  assert.equal(details.chapters[1].title, 'Vite Setup');
  assert.equal(details.chapters[2].timestampStr, '05:30');
  assert.equal(details.chapters[2].title, 'Gemini API Call');
});

test('YouTube DOM Details Extraction - Macro Markers Chapters', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Tech Talk - YouTube</title>
      </head>
      <body>
        <h1 class="ytd-watch-metadata">
          <yt-formatted-string>Tech Talk 2026</yt-formatted-string>
        </h1>
        <div id="channel-name">
          <yt-formatted-string>Tech Org</yt-formatted-string>
        </div>
        <div id="description">
          Some regular description without timestamps.
        </div>
        <!-- YouTube Macro Markers Drawer -->
        <ytd-macro-markers-list-item-renderer>
          <div id="time">0:00</div>
          <div id="details"><h4>Welcome</h4></div>
        </ytd-macro-markers-list-item-renderer>
        <ytd-macro-markers-list-item-renderer>
          <div id="time">03:20</div>
          <div id="details"><h4>Main Keynote</h4></div>
        </ytd-macro-markers-list-item-renderer>
      </body>
    </html>
  `;

  const dom = new JSDOM(html, { url: 'https://www.youtube.com/watch?v=macro123' });
  const details = extractYouTubeDetails(dom.window.document, 'https://www.youtube.com/watch?v=macro123');

  assert.equal(details.title, 'Tech Talk 2026');
  assert.equal(details.channel, 'Tech Org');
  assert.equal(details.chapters.length, 2);
  assert.equal(details.chapters[0].time, 0);
  assert.equal(details.chapters[0].title, 'Welcome');
  assert.equal(details.chapters[1].time, 200);
  assert.equal(details.chapters[1].title, 'Main Keynote');
});

test('YouTube Details Extraction - Prioritizes doc.title over stale og:title during SPA navigation', () => {
  // Simulates DOM where video element has not rendered h1 yet, but doc.title updated
  // while <meta og:title> is stuck on old video.
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>New JavaScript Features 2026 - YouTube</title>
        <!-- Stale meta from previous video -->
        <meta property="og:title" content="Let's build GPT: from scratch, in code, spelled out." />
      </head>
      <body>
        <div id="channel-name">
          <a href="/@JSWorld">JS World</a>
        </div>
      </body>
    </html>
  `;

  const dom = new JSDOM(html, { url: 'https://www.youtube.com/watch?v=newVideo123' });
  const details = extractYouTubeDetails(dom.window.document, 'https://www.youtube.com/watch?v=newVideo123');

  assert.equal(details.title, 'New JavaScript Features 2026');
  assert.notEqual(details.title, "Let's build GPT: from scratch, in code, spelled out.");
});

test('YouTube Video Seeking - seekYouTubeVideo Functionality', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <body>
        <video class="html5-main-video"></video>
      </body>
    </html>
  `;

  const dom = new JSDOM(html);
  const globalDocBackup = global.document;

  try {
    global.document = dom.window.document;
    const video = dom.window.document.querySelector('video') as HTMLVideoElement;

    // 1. Seek to 125 seconds
    const res1 = seekYouTubeVideo(125);
    assert.equal(res1.success, true);
    assert.equal(res1.currentTime, 125);
    assert.equal(video.currentTime, 125);

    // 2. Negative seconds clamps to 0
    const res2 = seekYouTubeVideo(-50);
    assert.equal(res2.success, true);
    assert.equal(res2.currentTime, 0);
    assert.equal(video.currentTime, 0);

    // 3. Remove video element -> handles gracefully
    video.remove();
    const res3 = seekYouTubeVideo(100);
    assert.equal(res3.success, false);
    assert.ok(res3.error?.includes('not found'));
  } finally {
    global.document = globalDocBackup;
  }
});

test('YouTube Prompt Builder - System Instructions', () => {
  const enInstruction = buildYouTubeSummarizationSystemInstruction('en');
  assert.ok(enInstruction.includes('You are ASKbro'));
  assert.ok(enInstruction.includes('<untrusted_webpage_content>'));
  assert.ok(enInstruction.includes('### 1. TL;DR'));
  assert.ok(enInstruction.includes('### 2. 5 Key Takeaways'));
  assert.ok(enInstruction.includes('### 3. Key Moments & Chapters'));
  assert.ok(enInstruction.includes('[mm:ss]'));
  assert.ok(enInstruction.includes('### 4. What To Do Next'));

  const hinglishInstruction = buildYouTubeSummarizationSystemInstruction('hinglish');
  assert.ok(hinglishInstruction.includes('Hinglish'));
  assert.ok(hinglishInstruction.includes('Roman'));
  assert.ok(hinglishInstruction.includes('[mm:ss]'));

  // buildSummarizationSystemInstruction with isYouTube = true
  const routedInstruction = buildSummarizationSystemInstruction('en', true);
  assert.equal(routedInstruction, enInstruction);
});

test('YouTube Prompt Builder - formatYouTubeContentForSummarizer', () => {
  const formatted = formatYouTubeContentForSummarizer({
    videoId: 'abc1234',
    title: 'Intro to React 19',
    channel: 'React Team',
    durationFormatted: '15:30',
    isLive: false,
    isShorts: false,
    description: 'Everything you need to know about React 19.',
    chapters: [
      { time: 0, timestampStr: '00:00', title: 'Intro' },
      { time: 180, timestampStr: '03:00', title: 'Actions & useActionState' },
    ],
  });

  assert.ok(formatted.includes('Video Title: Intro to React 19'));
  assert.ok(formatted.includes('Channel: React Team'));
  assert.ok(formatted.includes('Duration: 15:30'));
  assert.ok(formatted.includes('- [00:00] Intro'));
  assert.ok(formatted.includes('- [03:00] Actions & useActionState'));
  assert.ok(formatted.includes('Everything you need to know'));
});

test('YouTube Summary Parser - parseStructuredSummary with Chapters', () => {
  const mockGeminiOutput = `
### 1. TL;DR
This video explains how Chrome Manifest V3 extensions handle service worker lifecycles and background scripting.

### 2. 5 Key Takeaways
- **Service Worker Lifecycle**: Background workers terminate after 30 seconds of inactivity.
- **Session Storage**: chrome.storage.session preserves state across worker wakes.
- **Declarative Net Request**: Replaces webRequestBlocking for privacy.
- **Side Panel API**: Direct Chrome native side panel replaces cumbersome injected iframes.
- **Offscreen Documents**: Used for DOM-dependent tasks like audio playback or clipboard parsing.

### 3. Key Moments & Chapters
- [00:00] **Introduction**: Overview of Manifest V3 architecture and motivation.
- [02:30] **Worker Hibernation**: Understanding why background scripts shut down.
- [07:15] **State Restoration**: Using session storage to restore pending tasks.
- [12:45] **Side Panel**: Launching and managing the side panel UI.

### 4. What To Do Next
- Update manifest.json with side_panel and storage permissions.
- Test background worker sleep by inspecting in chrome://serviceworker-internals.
  `;

  const parsed = parseStructuredSummary(mockGeminiOutput);

  assert.ok(parsed.tldr.includes('Manifest V3'));
  assert.equal(parsed.keyTakeaways.length, 5);
  assert.ok(parsed.keyTakeaways[0].includes('Service Worker Lifecycle'));

  // Verify chapters parsed
  assert.ok(parsed.chapters);
  assert.equal(parsed.chapters.length, 4);

  assert.equal(parsed.chapters[0].timestamp, '00:00');
  assert.equal(parsed.chapters[0].seconds, 0);
  assert.equal(parsed.chapters[0].title, 'Introduction');
  assert.equal(parsed.chapters[0].note, 'Overview of Manifest V3 architecture and motivation.');

  assert.equal(parsed.chapters[1].timestamp, '02:30');
  assert.equal(parsed.chapters[1].seconds, 150);
  assert.equal(parsed.chapters[1].title, 'Worker Hibernation');

  assert.equal(parsed.chapters[2].timestamp, '07:15');
  assert.equal(parsed.chapters[2].seconds, 435);

  assert.equal(parsed.chapters[3].timestamp, '12:45');
  assert.equal(parsed.chapters[3].seconds, 765);

  assert.equal(parsed.actionableSteps.length, 2);

  // Verify formatSummaryAsMarkdown includes chapters
  const markdown = formatSummaryAsMarkdown(parsed);
  assert.ok(markdown.includes('### 3. Key Moments & Chapters'));
  assert.ok(markdown.includes('- [00:00] **Introduction**: Overview'));
  assert.ok(markdown.includes('### 4. What To Do Next'));
});

test('YouTube Details Extraction - Initial Player Response Extraction from Scripts', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Demo - YouTube</title>
        <script>
          var ytInitialPlayerResponse = {
            "videoDetails": {
              "title": "Embedded Script Title",
              "author": "Embedded Author",
              "shortDescription": "Full uncollapsed description with chapters:\\n00:00 Start\\n02:00 Next",
              "lengthSeconds": "360"
            },
            "captions": {
              "playerCaptionsTracklistRenderer": {
                "captionTracks": [
                  { "baseUrl": "https://www.youtube.com/api/timedtext?test=1", "languageCode": "en" }
                ]
              }
            }
          };
        </script>
      </head>
      <body></body>
    </html>
  `;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/watch?v=scriptTest' });
  const doc = dom.window.document;

  const playerResp = extractInitialPlayerResponse(doc);
  assert.ok(playerResp);
  assert.equal(playerResp.videoDetails?.title, 'Embedded Script Title');
  assert.equal(playerResp.videoDetails?.author, 'Embedded Author');
  assert.equal(playerResp.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length, 1);

  // Test that extractYouTubeDetails picks up the uncollapsed shortDescription from player response
  const details = extractYouTubeDetails(doc, 'https://www.youtube.com/watch?v=scriptTest');
  assert.equal(details.title, 'Embedded Script Title');
  assert.equal(details.channel, 'Embedded Author');
  assert.ok(details.description.includes('Full uncollapsed description with chapters'));
  assert.equal(details.chapters.length, 2);
  assert.equal(details.chapters[0].title, 'Start');
  assert.equal(details.chapters[1].title, 'Next');
});

test('YouTube Transcript Extraction - Extract from DOM segments', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Transcript Test - YouTube</title></head>
      <body>
        <div id="segments-container">
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">0:00</div>
            <div class="segment-text">Welcome to this comprehensive tutorial.</div>
          </ytd-transcript-segment-renderer>
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">0:15</div>
            <div class="segment-text">We are exploring AI Agents inside Chrome extensions.</div>
          </ytd-transcript-segment-renderer>
          <ytd-transcript-segment-renderer>
            <div class="segment-timestamp">1:30</div>
            <div class="segment-text">Here is the architecture breakdown.</div>
          </ytd-transcript-segment-renderer>
        </div>
      </body>
    </html>
  `;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/watch?v=transTest' });
  const doc = dom.window.document;

  const extracted = extractTranscriptFromDOM(doc);
  assert.ok(extracted);
  assert.equal(extracted.segmentsCount, 3);
  assert.ok(extracted.transcript.includes('[0:00] Welcome to this comprehensive tutorial.'));
  assert.ok(extracted.transcript.includes('[0:15] We are exploring AI Agents inside Chrome extensions.'));
  assert.ok(extracted.transcript.includes('[1:30] Here is the architecture breakdown.'));

  // Verify extractYouTubeDetails includes transcript when present in DOM
  const details = extractYouTubeDetails(doc, 'https://www.youtube.com/watch?v=transTest');
  assert.equal(details.transcriptSegmentsCount, 3);
  assert.equal(details.transcriptSource, 'panel');
  assert.ok(details.transcript?.includes('[0:00] Welcome to this comprehensive tutorial.'));

  // Verify formatYouTubeContentForSummarizer includes Video Transcript
  const formatted = formatYouTubeContentForSummarizer(details);
  assert.ok(formatted.includes('Video Transcript / Spoken Content:'));
  assert.ok(formatted.includes('We are exploring AI Agents inside Chrome extensions.'));
});

test('YouTube Transcript Extraction - fetchTranscriptFromCaptionTracks XML', async () => {
  const mockXml = `
    <?xml version="1.0" encoding="utf-8" ?>
    <transcript>
      <text start="0" dur="2.5">Hello world &amp; welcome.</text>
      <text start="3.5" dur="4.2">In this video we build an AI browser assistant.</text>
      <text start="8.1" dur="3.0">&quot;Let&#39;s get started.&quot;</text>
    </transcript>
  `;

  const globalFetchBackup = global.fetch;
  try {
    (global as any).fetch = async (url: string) => {
      if (url.includes('fmt=json3')) {
        return { ok: false, status: 404 };
      }
      return {
        ok: true,
        text: async () => mockXml,
      };
    };

    const tracks = [
      {
        baseUrl: 'https://www.youtube.com/api/timedtext?v=test',
        languageCode: 'en',
      },
    ];

    const result = await fetchTranscriptFromCaptionTracks(tracks);
    assert.ok(result);
    assert.equal(result.segmentsCount, 3);
    assert.ok(result.transcript.includes('[00:00] Hello world & welcome.'));
    assert.ok(result.transcript.includes('[00:03] In this video we build an AI browser assistant.'));
    assert.ok(result.transcript.includes('[00:08] "Let\'s get started."'));
  } finally {
    global.fetch = globalFetchBackup;
  }
});

test('YouTube Details Async - extractYouTubeDetailsAsync End-to-End', async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Async Video Test - YouTube</title>
      </head>
      <body>
        <h1 class="ytd-watch-metadata"><yt-formatted-string>Async Video</yt-formatted-string></h1>
        <div id="channel-name"><a href="/@Test">Test Channel</a></div>
        <ytd-transcript-segment-renderer>
          <div class="segment-timestamp">00:05</div>
          <div class="segment-text">Spoken detail 1</div>
        </ytd-transcript-segment-renderer>
      </body>
    </html>
  `;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/watch?v=async1' });
  const details = await extractYouTubeDetailsAsync(dom.window.document, 'https://www.youtube.com/watch?v=async1');

  assert.equal(details.title, 'Async Video');
  assert.equal(details.channel, 'Test Channel');
  assert.equal(details.transcriptSegmentsCount, 1);
  assert.ok(details.transcript?.includes('[00:05] Spoken detail 1'));
});

test('YouTube JSON Helper - extractBalancedJson with nested objects and strings', () => {
  const sample = 'const obj = {"key": "val;with;semicolon", "nested": {"arr": [1, 2, {"a": "}"}]}};\nmore code';
  const braceIdx = sample.indexOf('{');
  const parsed = extractBalancedJson(sample, braceIdx, '{', '}');

  assert.ok(parsed);
  assert.equal(parsed.key, 'val;with;semicolon');
  assert.equal(parsed.nested.arr[2].a, '}');

  // Test array extraction
  const arraySample = 'const tracks = [{"baseUrl": "https://example.com/timedtext", "name": "English"}];';
  const bracketIdx = arraySample.indexOf('[');
  const parsedArr = extractBalancedJson(arraySample, bracketIdx, '[', ']');

  assert.ok(Array.isArray(parsedArr));
  assert.equal(parsedArr.length, 1);
  assert.equal(parsedArr[0].baseUrl, 'https://example.com/timedtext');
});

test('YouTube Entity Helper - decodeHtmlEntities', () => {
  assert.equal(decodeHtmlEntities('Hello &amp; welcome &#39;world&#39;'), "Hello & welcome 'world'");
  assert.equal(decodeHtmlEntities('&quot;Quotes&quot; &lt;tag&gt; &#x2F;'), '"Quotes" <tag> /');
});

test('YouTube Script Extraction - extractCaptionTracksFromScripts directly', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <script>
          // YouTube complex script without standard ytInitialPlayerResponse assignment
          window["ytcfg"] = { "SOMETHING": 123 };
          const data = {
            "captions": {
              "playerCaptionsTracklistRenderer": {
                "captionTracks": [
                  { "baseUrl": "https://www.youtube.com/api/timedtext?v=direct", "languageCode": "en" }
                ]
              }
            }
          };
        </script>
      </head>
      <body></body>
    </html>
  `;
  const dom = new JSDOM(html);
  const tracks = extractCaptionTracksFromScripts(dom.window.document);

  assert.ok(tracks);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].baseUrl, 'https://www.youtube.com/api/timedtext?v=direct');
});

test('YouTube Watch Page Fetch Fallback - fetchWatchPageMetadata and extractYouTubeTranscript Method D', async () => {
  const mockWatchPageHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script>
          var ytInitialPlayerResponse = {
            "videoDetails": {
              "videoId": "fetchFallback123",
              "title": "Fetched Video Title",
              "shortDescription": "Full uncollapsed description recovered from server HTML."
            },
            "captions": {
              "playerCaptionsTracklistRenderer": {
                "captionTracks": [
                  { "baseUrl": "https://www.youtube.com/api/timedtext?v=fetchFallback123", "languageCode": "en" }
                ]
              }
            }
          };
        </script>
      </head>
    </html>
  `;

  const mockXml = `
    <transcript>
      <text start="1.0" dur="3.0">Recovered transcript via watch page fetch.</text>
    </transcript>
  `;

  const globalFetchBackup = global.fetch;
  try {
    (global as any).fetch = async (url: string) => {
      if (url.includes('youtube.com/watch?v=fetchFallback123')) {
        return {
          ok: true,
          text: async () => mockWatchPageHtml,
        };
      }
      if (url.includes('timedtext')) {
        return {
          ok: true,
          text: async () => mockXml,
        };
      }
      return { ok: false, status: 404 };
    };

    const dom = new JSDOM('<html><body><div id="empty"></div></body></html>', {
      url: 'https://www.youtube.com/watch?v=fetchFallback123',
    });

    const result = await extractYouTubeTranscript(dom.window.document, 'https://www.youtube.com/watch?v=fetchFallback123');
    assert.ok(result);
    assert.equal(result.source, 'captions');
    assert.ok(result.transcript.includes('Recovered transcript via watch page fetch.'));
    assert.equal(result.overrideDescription, 'Full uncollapsed description recovered from server HTML.');
  } finally {
    global.fetch = globalFetchBackup;
  }
});

test('YouTube Content Formatter - Fallback notice when transcript is unavailable', () => {
  const formatted = formatYouTubeContentForSummarizer({
    videoId: 'noSub123',
    title: 'Silent Tutorial',
    channel: 'Creator',
    description: 'This is a tutorial on CSS grid with no speaking.',
    chapters: [],
  });

  assert.ok(formatted.includes('Video Title: Silent Tutorial'));
  assert.ok(formatted.includes('Spoken subtitles/transcript unavailable for this video. Use video title, chapters, and description for core takeaways and answers.'));
});


