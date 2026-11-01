import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSummarizationSystemInstruction,
  wrapUntrustedContent,
  buildSummarizationUserPrompt,
  truncateForContext,
  splitTakeawayLeadIn,
  parseStructuredSummary,
  formatSummaryAsMarkdown,
  summaryResultSchema,
  DEFAULT_MAX_PAGE_CHARS,
} from '../src/services/ai/promptBuilder.ts';

test('PromptBuilder - System Instruction Construction for English', () => {
  const instruction = buildSummarizationSystemInstruction('en');
  assert.ok(instruction.includes('### 1. TL;DR'), 'Must enforce TL;DR section header');
  assert.ok(instruction.includes('### 2. 5 Key Takeaways'), 'Must enforce 5 Key Takeaways header');
  assert.ok(instruction.includes('### 3. What To Do Next'), 'Must enforce What To Do Next header');
  assert.ok(instruction.includes('<untrusted_webpage_content>'), 'Must enforce injection defense');
  assert.ok(instruction.includes('Bold Lead-in Keyword or Phrase'), 'Must enforce bold lead-in format');
});

test('PromptBuilder - System Instruction Construction for Hinglish', () => {
  const instruction = buildSummarizationSystemInstruction('hinglish');
  assert.ok(instruction.includes('colloquial Hinglish'), 'Must specify colloquial Hinglish');
  assert.ok(instruction.includes('Roman/Latin script'), 'Must enforce Roman script (no Devanagari)');
  assert.ok(instruction.includes('Do NOT use Devanagari script'), 'Must forbid Devanagari script');
  assert.ok(instruction.includes('### 1. TL;DR'), 'Must enforce TL;DR header in Hinglish mode');
  assert.ok(instruction.includes('### 2. 5 Key Takeaways'), 'Must enforce 5 Key Takeaways header');
  assert.ok(instruction.includes('### 3. What To Do Next'), 'Must enforce What To Do Next header');
});

test('PromptBuilder - truncateForContext', () => {
  const shortText = 'This is a short article under limits.';
  const shortResult = truncateForContext(shortText, 100);
  assert.equal(shortResult.truncated, false);
  assert.equal(shortResult.text, shortText);
  assert.equal(shortResult.originalLength, shortText.length);

  const longText = 'Word1 '.repeat(200); // 1200 characters
  const truncatedResult = truncateForContext(longText, 50);
  assert.equal(truncatedResult.truncated, true);
  assert.ok(truncatedResult.text.length <= 50);
  assert.ok(!truncatedResult.text.endsWith(' '));
  assert.equal(truncatedResult.originalLength, longText.length);
});

test('PromptBuilder - wrapUntrustedContent and buildSummarizationUserPrompt', () => {
  const content = 'Chrome extensions run in an isolated environment with sandboxed privileges.';
  const title = 'Chrome Extension Security Guide';
  const url = 'https://developer.chrome.com/docs/extensions/mv3/security';

  const wrapped = wrapUntrustedContent(content, title, url);
  assert.ok(wrapped.includes('<untrusted_webpage_content>'));
  assert.ok(wrapped.includes('</untrusted_webpage_content>'));
  assert.ok(wrapped.includes(`Page Title: ${title}`));
  assert.ok(wrapped.includes(`URL: ${url}`));
  assert.ok(wrapped.includes(content));

  const userPrompt = buildSummarizationUserPrompt(content, { title, url });
  assert.equal(userPrompt, wrapped);

  // Test truncation metadata injection
  const hugeContent = 'A '.repeat(DEFAULT_MAX_PAGE_CHARS + 500);
  const truncatedWrapped = wrapUntrustedContent(hugeContent, title, url, 1000);
  assert.ok(truncatedWrapped.includes('[Note: Document truncated to first'));
});

test('PromptBuilder - splitTakeawayLeadIn', () => {
  // Test double asterisks with colon
  const item1 = '**Zero-Day Defense**: Prompt injection is contained using explicit XML tags.';
  const split1 = splitTakeawayLeadIn(item1);
  assert.equal(split1.leadIn, 'Zero-Day Defense');
  assert.equal(split1.body, 'Prompt injection is contained using explicit XML tags.');

  // Test double asterisks with dash
  const item2 = '**Performance Metric** - The page loads in 120ms with low memory footprint.';
  const split2 = splitTakeawayLeadIn(item2);
  assert.equal(split2.leadIn, 'Performance Metric');
  assert.equal(split2.body, 'The page loads in 120ms with low memory footprint.');

  // Test double asterisks with space
  const item3 = '**Architecture** ASKbro runs as a side panel extension.';
  const split3 = splitTakeawayLeadIn(item3);
  assert.equal(split3.leadIn, 'Architecture');
  assert.equal(split3.body, 'ASKbro runs as a side panel extension.');

  // Test colon without bold
  const item4 = 'Key Insight: Users prefer concise executive summaries.';
  const split4 = splitTakeawayLeadIn(item4);
  assert.equal(split4.leadIn, 'Key Insight');
  assert.equal(split4.body, 'Users prefer concise executive summaries.');

  // Test plain sentence without lead-in
  const item5 = 'Modern browsers restrict content script direct access to internal pages.';
  const split5 = splitTakeawayLeadIn(item5);
  assert.equal(split5.leadIn, '');
  assert.equal(split5.body, item5);
});

test('PromptBuilder - parseStructuredSummary with standard markdown', () => {
  const markdown = `### 1. TL;DR
ASKbro is a Manifest V3 browser agent that safely reads and acts on web pages under human supervision.

### 2. 5 Key Takeaways
- **Side Panel First**: Integrates natively within Chrome side panel without obstructing tab content.
- **Readability Extraction**: Cleans noise and extracts article body text and metadata automatically.
- **Deterministic Guardrails**: Protects banking and credential inputs from synthetic actions.
- **Multilingual Support**: Supports English and conversational Hinglish seamlessly.
- **Local Privacy**: Zero telemetry, with API keys saved locally in chrome.storage.

### 3. What To Do Next
- Test with your favorite tech blog or news article.
- Switch to Hinglish mode to compare summaries.
- Try dry-run execution on interactive forms.`;

  const parsed = parseStructuredSummary(markdown);
  assert.equal(
    parsed.tldr,
    'ASKbro is a Manifest V3 browser agent that safely reads and acts on web pages under human supervision.'
  );
  assert.equal(parsed.keyTakeaways.length, 5);
  assert.ok(parsed.keyTakeaways[0].includes('Side Panel First'));
  assert.ok(parsed.keyTakeaways[4].includes('Local Privacy'));
  assert.equal(parsed.actionableSteps.length, 3);
  assert.ok(parsed.actionableSteps[0].includes('Test with your favorite tech blog'));

  // Test Zod validation
  const valid = summaryResultSchema.safeParse(parsed);
  assert.equal(valid.success, true);
});

test('PromptBuilder - parseStructuredSummary with JSON output', () => {
  const jsonOutput = `\`\`\`json
{
  "tldr": "Vite provides lightning-fast HMR and optimized production bundles for modern web apps.",
  "keyTakeaways": [
    "Native ESM dev server eliminates bundling overhead during development.",
    "Rollup powers robust and tree-shaken production output.",
    "First-class TypeScript support without manual configuration.",
    "Extensible plugin ecosystem compatible with Rollup plugins.",
    "CSS code-splitting and preprocessor support out of the box."
  ],
  "actionableSteps": [
    "Migrate legacy webpack configs using @crxjs/vite-plugin.",
    "Configure alias paths in vite.config.ts."
  ]
}
\`\`\``;

  const parsed = parseStructuredSummary(jsonOutput);
  assert.ok(parsed.tldr.includes('Vite provides'));
  assert.equal(parsed.keyTakeaways.length, 5);
  assert.equal(parsed.actionableSteps.length, 2);

  const valid = summaryResultSchema.safeParse(parsed);
  assert.equal(valid.success, true);
});

test('PromptBuilder - formatSummaryAsMarkdown', () => {
  const summary = {
    tldr: 'One-line overview of the topic.',
    keyTakeaways: [
      '**Point 1**: Detail 1',
      '**Point 2**: Detail 2',
      '**Point 3**: Detail 3',
      '**Point 4**: Detail 4',
      '**Point 5**: Detail 5',
    ],
    actionableSteps: ['Step 1 to take', 'Step 2 to take'],
  };

  const md = formatSummaryAsMarkdown(summary);
  assert.ok(md.includes('### 1. TL;DR\nOne-line overview of the topic.'));
  assert.ok(md.includes('### 2. 5 Key Takeaways\n- **Point 1**: Detail 1'));
  assert.ok(md.includes('### 3. What To Do Next\n- Step 1 to take\n- Step 2 to take'));
});

