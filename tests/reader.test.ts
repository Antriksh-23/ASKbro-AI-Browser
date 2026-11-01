import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  extractPageContent,
  calculateReadingTime,
  cleanExtractedText,
  checkIsYouTube,
  extractAuthorFromDOM,
  extractTitleFromDOM,
  extractSiteNameFromDOM,
  extractExcerptFromDOM,
  extractFallbackBodyText,
} from '../src/content/reader.ts';

test('Reader Utility - cleanExtractedText normalization', () => {
  const dirty = '  Paragraph 1 with   extra    spaces.\r\n\r\n\r\n\r\n\r\nParagraph 2.\t\tTabs here.  \n\n\n';
  const cleaned = cleanExtractedText(dirty);

  assert.equal(
    cleaned,
    'Paragraph 1 with extra spaces.\n\nParagraph 2. Tabs here.'
  );
});

test('Reader Utility - calculateReadingTime calculations', () => {
  // Empty
  assert.deepEqual(calculateReadingTime(''), { wordCount: 0, readingTimeMinutes: 0 });
  assert.deepEqual(calculateReadingTime('   \n  \t  '), { wordCount: 0, readingTimeMinutes: 0 });

  // 50 words (less than 200) -> 1 min
  const fiftyWords = Array(50).fill('word').join(' ');
  const r50 = calculateReadingTime(fiftyWords);
  assert.equal(r50.wordCount, 50);
  assert.equal(r50.readingTimeMinutes, 1);

  // 200 words -> 1 min
  const twoHundredWords = Array(200).fill('apple').join(' ');
  const r200 = calculateReadingTime(twoHundredWords);
  assert.equal(r200.wordCount, 200);
  assert.equal(r200.readingTimeMinutes, 1);

  // 450 words -> 3 min (ceil(450/200) = 3)
  const fourFiftyWords = Array(450).fill('browser').join(' ');
  const r450 = calculateReadingTime(fourFiftyWords);
  assert.equal(r450.wordCount, 450);
  assert.equal(r450.readingTimeMinutes, 3);
});

test('Reader Utility - checkIsYouTube detection', () => {
  assert.equal(checkIsYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(checkIsYouTube('https://youtube.com/watch?v=test1234'), true);
  assert.equal(checkIsYouTube('https://m.youtube.com/watch?v=mobileId'), true);
  assert.equal(checkIsYouTube('https://www.youtube.com/shorts/shortId123'), true);
  assert.equal(checkIsYouTube('https://youtu.be/watch?v=xyz'), true);

  // Non-video YouTube or third-party pages
  assert.equal(checkIsYouTube('https://www.youtube.com/'), false);
  assert.equal(checkIsYouTube('https://www.youtube.com/feed/subscriptions'), false);
  assert.equal(checkIsYouTube('https://en.wikipedia.org/wiki/Artificial_intelligence'), false);
  assert.equal(checkIsYouTube('invalid-url-string'), false);
});

test('Reader Metadata - extractTitleFromDOM, extractAuthorFromDOM, extractSiteNameFromDOM', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Document HTML Title</title>
        <meta property="og:title" content="OpenGraph Article Title" />
        <meta name="author" content="Dr. Alan Turing" />
        <meta property="og:site_name" content="Tech Gazette" />
        <meta property="og:description" content="A comprehensive analysis of intelligence." />
      </head>
      <body>
        <h1>Heading 1 Title</h1>
      </body>
    </html>
  `;
  const dom = new JSDOM(html, { url: 'https://techgazette.com/articles/turing' });
  const doc = dom.window.document;

  assert.equal(extractTitleFromDOM(doc), 'OpenGraph Article Title');
  assert.equal(extractAuthorFromDOM(doc), 'Dr. Alan Turing');
  assert.equal(extractSiteNameFromDOM(doc), 'Tech Gazette');
  assert.equal(extractExcerptFromDOM(doc, 'Some text'), 'A comprehensive analysis of intelligence.');
});

test('Reader Article Extraction - Mozilla Readability on Standard Blog/News Page', () => {
  const articleHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>The Architecture of Modern Neural Networks - Tech Digest</title>
        <meta name="author" content="Sarah Connor" />
        <meta property="og:site_name" content="Tech Digest" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/news">News</a>
        </nav>
        <div class="cookie-banner">Please accept cookies to continue reading.</div>
        <main>
          <article>
            <h1 class="entry-title">The Architecture of Modern Neural Networks</h1>
            <p class="byline">By Sarah Connor</p>
            <p>
              Neural networks have undergone tremendous structural evolution over the past decade.
              From deep convolutional networks to self-attention transformers, the algorithmic fundamentals
              have shifted towards scalable parallelization across tensor processing units and cluster accelerators.
            </p>
            <p>
              The emergence of dense matrix multiplies as the core workload enabled specialized silicon architectures.
              Hardware and software co-design now dictates model convergence rates, parameter efficiency, and memory bandwidth utilization.
            </p>
            <p>
              Looking forward, mixture-of-experts architectures allow conditional computation where only a fraction
              of parameters activate for any single token. This significantly reduces inference latency while maintaining high capacity.
            </p>
          </article>
        </main>
        <footer>
          <p>© 2026 Tech Digest Inc. All rights reserved.</p>
        </footer>
      </body>
    </html>
  `;

  const dom = new JSDOM(articleHtml, { url: 'https://techdigest.example.com/posts/neural-arch' });
  const doc = dom.window.document;

  // Execute extraction
  const result = extractPageContent(doc);

  assert.equal(result.success, true);
  assert.equal(result.extractedWith, 'readability');
  assert.ok(result.title.includes('The Architecture of Modern Neural Networks'));
  assert.ok(result.byline?.includes('Sarah Connor'));
  assert.ok(result.textContent.includes('Neural networks have undergone tremendous structural evolution'));
  assert.ok(result.textContent.includes('mixture-of-experts architectures'));

  // Ensure navigation and footer clutter were stripped by Readability
  assert.equal(result.textContent.includes('Please accept cookies'), false);
  assert.equal(result.textContent.includes('Home\nNews'), false);

  assert.ok(result.wordCount > 50, `Word count should be > 50, got ${result.wordCount}`);
  assert.ok(result.readingTimeMinutes >= 1, `Reading time should be >= 1 min`);
  assert.ok(result.length > 200, `Character length should be > 200`);
});

test('Reader Article Extraction - Graceful Fallback when Readability fails or on non-article pages', () => {
  // A dashboard or web-app page with minimal article semantics where Readability returns null
  const appHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Cloud Console Dashboard</title>
        <meta name="description" content="Monitor your cloud infrastructure metrics and deployment pipelines." />
      </head>
      <body>
        <script>console.log('init');</script>
        <style>.hidden { display: none; }</style>
        <nav class="nav">
          <ul><li>Overview</li><li>Billing</li></ul>
        </nav>
        <div class="cookie-notice">We use cookies.</div>
        <div id="content">
          <h1>Cluster Status Overview</h1>
          <p>Production cluster eu-central-1 is healthy with 12 active nodes running workload deployments.</p>
          <p>Database replica latency is currently under 4 milliseconds across all availability zones.</p>
          <p>Next scheduled maintenance window is set for Sunday 02:00 UTC.</p>
        </div>
        <footer id="footer">
          <p>Privacy Policy | Terms of Service</p>
        </footer>
      </body>
    </html>
  `;

  const dom = new JSDOM(appHtml, { url: 'https://cloud.example.com/dashboard' });
  const doc = dom.window.document;

  // Force fallback or let natural fallback trigger
  const result = extractPageContent(doc, { forceFallback: true });

  assert.equal(result.success, true);
  assert.equal(result.extractedWith, 'fallback');
  assert.equal(result.title, 'Cloud Console Dashboard');
  assert.ok(result.textContent.includes('Cluster Status Overview'));
  assert.ok(result.textContent.includes('Production cluster eu-central-1 is healthy'));
  assert.ok(result.textContent.includes('Database replica latency'));

  // Clutter elements must be stripped
  assert.equal(result.textContent.includes('init'), false);
  assert.equal(result.textContent.includes('We use cookies'), false);
  assert.equal(result.textContent.includes('Privacy Policy | Terms'), false);

  assert.ok(result.wordCount > 15);
  assert.equal(result.readingTimeMinutes, 1);
  assert.ok(result.excerpt?.includes('Monitor your cloud infrastructure'));
});

test('Reader Article Extraction - options.maxLength truncates properly', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Long Document</title></head>
      <body>
        <article>
          <h1>Long Document Title</h1>
          <p>${Array(100).fill('Content line sentence for testing truncation limits.').join(' ')}</p>
        </article>
      </body>
    </html>
  `;

  const dom = new JSDOM(html, { url: 'https://example.com/long' });
  const doc = dom.window.document;

  const result = extractPageContent(doc, { maxLength: 250 });

  assert.equal(result.success, true);
  assert.ok(result.textContent.length <= 250);
});

test('Reader Article Extraction - extractFallbackBodyText handles empty body', () => {
  const emptyDom = new JSDOM('<!DOCTYPE html><html><head><title>Empty</title></head><body></body></html>');
  const text = extractFallbackBodyText(emptyDom.window.document);
  assert.equal(text, '');
});

test('Reader YouTube - Homepage extraction ignores stale og:title and returns clean YouTube info', () => {
  // Simulates YouTube SPA where user was previously on a video page ("Let\'s build GPT...")
  // and navigated back to the YouTube home page.
  const ytHomeHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>YouTube</title>
        <!-- Stale og:title left behind by YouTube SPA router -->
        <meta property="og:title" content="Let's build GPT: from scratch, in code, spelled out." />
        <meta name="title" content="Let's build GPT: from scratch, in code, spelled out." />
      </head>
      <body>
        <ytd-app>
          <!-- Hidden residual video container from previous watch session in SPA -->
          <ytd-watch-flexy hidden style="display:none;">
            <h1><yt-formatted-string>Let's build GPT: from scratch, in code, spelled out.</yt-formatted-string></h1>
          </ytd-watch-flexy>
          <!-- Active home feed container -->
          <ytd-browse role="main">
            <div id="contents">YouTube Home Feed Recommendations</div>
          </ytd-browse>
        </ytd-app>
      </body>
    </html>
  `;

  const dom = new JSDOM(ytHomeHtml, { url: 'https://www.youtube.com/' });
  const doc = dom.window.document;

  // Title extractor should prioritize doc.title on YouTube
  const title = extractTitleFromDOM(doc, 'https://www.youtube.com/');
  assert.equal(title, 'YouTube');
  assert.notEqual(title, "Let's build GPT: from scratch, in code, spelled out.");

  // Page content extraction on YouTube homepage should return clean YouTube browsing context
  const result = extractPageContent(doc);
  assert.equal(result.success, true);
  assert.equal(result.title, 'YouTube');
  assert.equal(result.siteName, 'YouTube');
  assert.equal(result.isYouTube, true);
  assert.equal(result.videoDetails, undefined);
  assert.notEqual(result.title, "Let's build GPT: from scratch, in code, spelled out.");
  assert.ok(result.textContent.includes('Browsing YouTube'));
});

