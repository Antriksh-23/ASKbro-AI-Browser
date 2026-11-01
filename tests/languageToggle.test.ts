import test from 'node:test';
import assert from 'node:assert/strict';
import { getLanguage, setLanguage, getSettings } from '../src/services/storage/settingsStore.ts';
import {
  buildSummarizationSystemInstruction,
  buildYouTubeSummarizationSystemInstruction,
  parseStructuredSummary,
  formatSummaryAsMarkdown,
  splitTakeawayLeadIn,
  summaryResultSchema,
} from '../src/services/ai/promptBuilder.ts';

// Setup mock chrome.storage.local environment for testing
const testStore: Record<string, any> = {
  askbro_settings: {
    geminiApiKey: 'AIzaSyTestKey1234567890',
    model: 'gemini-1.5-flash-lite',
    language: 'en',
  },
};

(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: testStore[key] }),
      set: async (items: Record<string, any>) => Object.assign(testStore, items),
      remove: async (key: string) => delete testStore[key],
    },
    session: {
      get: async (key: string) => ({ [key]: testStore[key] }),
      set: async (items: Record<string, any>) => Object.assign(testStore, items),
    },
  },
};

test('Slice 1.6 - Persistent Language State in chrome.storage.local', async () => {
  // Initial language should be 'en'
  const initialLang = await getLanguage();
  assert.equal(initialLang, 'en');

  // Switch to Hinglish and verify persistence
  const updatedSettings = await setLanguage('hinglish');
  assert.equal(updatedSettings.language, 'hinglish');
  assert.equal(testStore.askbro_settings.language, 'hinglish');

  // Verify getLanguage retrieves updated value
  const persistedLang = await getLanguage();
  assert.equal(persistedLang, 'hinglish');

  // Switch back to English and verify persistence
  await setLanguage('en');
  const enLang = await getLanguage();
  assert.equal(enLang, 'en');
  assert.equal(testStore.askbro_settings.language, 'en');
});

test('Slice 1.6 - Article Summarization System Instruction (Hinglish Mode)', () => {
  const instruction = buildSummarizationSystemInstruction('hinglish', false);

  // Exact Slice 1.6 instruction details
  assert.ok(
    instruction.includes('colloquial Hinglish'),
    'Should explicitly require colloquial Hinglish'
  );
  assert.ok(
    instruction.includes('Hindi written in Roman English script'),
    'Should explicitly require Hindi written in Roman English script'
  );
  assert.ok(
    instruction.includes('keeping technical terms intact'),
    'Should explicitly instruct to keep technical terms intact'
  );
  assert.ok(
    instruction.includes('Do NOT use Devanagari script'),
    'Should strictly forbid Devanagari script'
  );

  // Structural requirements
  assert.ok(instruction.includes('### 1. TL;DR'), 'Must enforce TL;DR section header');
  assert.ok(instruction.includes('### 2. 5 Key Takeaways'), 'Must enforce 5 Key Takeaways header');
  assert.ok(instruction.includes('### 3. What To Do Next'), 'Must enforce What To Do Next header');
  assert.ok(
    instruction.includes('<untrusted_webpage_content>'),
    'Must enforce prompt injection protection tags'
  );
});

test('Slice 1.6 - YouTube Video Summarization System Instruction (Hinglish Mode)', () => {
  const ytInstruction = buildYouTubeSummarizationSystemInstruction('hinglish');

  assert.ok(
    ytInstruction.includes('colloquial Hinglish'),
    'Should explicitly require colloquial Hinglish for YouTube'
  );
  assert.ok(
    ytInstruction.includes('Hindi written in Roman English script'),
    'Should require Roman script for YouTube'
  );
  assert.ok(
    ytInstruction.includes('keeping technical terms intact'),
    'Should require technical terms intact for YouTube'
  );
  assert.ok(
    ytInstruction.includes('Do NOT use Devanagari script'),
    'Should forbid Devanagari script for YouTube'
  );

  // 4 sections for YouTube
  assert.ok(ytInstruction.includes('### 1. TL;DR'));
  assert.ok(ytInstruction.includes('### 2. 5 Key Takeaways'));
  assert.ok(ytInstruction.includes('### 3. Key Moments & Chapters'));
  assert.ok(ytInstruction.includes('### 4. What To Do Next'));
});

test('Slice 1.6 - Resilient Hinglish Summary Parsing and Zod Validation', () => {
  const sampleHinglishSummary = `### 1. TL;DR
Yeh article explain karta hai ki Next.js 15 aur React Server Components se web applications ki performance aur SEO kaise improve hoti hai.

### 2. 5 Key Takeaways
- **Server-Side Rendering**: Server pe HTML render hone se Initial Page Load speed drastically fast ho jati hai.
- **Turbopack Engine**: Local development ke time build aur HMR updates seconds mein complete ho jate hain.
- **Async Request APIs**: Cookies aur headers ab async functions ban gaye hain, jisse better caching support milta hai.
- **Enhanced Security**: Server Actions automatically CSRF protection provide karte hain.
- **Backward Compatibility**: Existing Page Router codebase ko step-by-step App Router mein migrate kiya ja sakta hai.

### 3. What To Do Next
- Node.js 18+ version pe environment upgrade karein.
- Next.js codemod chala kar automatic syntax fixes apply karein.
- Local sandbox project mein React 19 canary features test karein.`;

  const parsed = parseStructuredSummary(sampleHinglishSummary);

  assert.ok(parsed.tldr.startsWith('Yeh article explain karta hai'));
  assert.equal(parsed.keyTakeaways.length, 5);
  assert.equal(parsed.actionableSteps.length, 3);

  // Verify lead-in extraction on Hinglish bullet points
  const split1 = splitTakeawayLeadIn(parsed.keyTakeaways[0]);
  assert.equal(split1.leadIn, 'Server-Side Rendering');
  assert.ok(split1.body.includes('Server pe HTML render hone se'));

  const split2 = splitTakeawayLeadIn(parsed.keyTakeaways[1]);
  assert.equal(split2.leadIn, 'Turbopack Engine');
  assert.ok(split2.body.includes('Local development ke time'));

  // Validate against Zod schema
  const validation = summaryResultSchema.safeParse(parsed);
  assert.equal(validation.success, true);

  // Format as markdown and verify
  const formattedMd = formatSummaryAsMarkdown(parsed);
  assert.ok(formattedMd.includes('### 1. TL;DR'));
  assert.ok(formattedMd.includes('Yeh article explain karta hai'));
  assert.ok(formattedMd.includes('### 2. 5 Key Takeaways'));
  assert.ok(formattedMd.includes('### 3. What To Do Next'));
});

test('Slice 1.6 - Resilient Hinglish YouTube Video Summary with Timestamps Parsing', () => {
  const sampleYtHinglishSummary = `### 1. TL;DR
Yeh video batata hai ki Docker containers aur Kubernetes pods kaise microservices architecture ko scale karte hain.

### 2. 5 Key Takeaways
- **Containerization Basics**: Docker lightweight images create karta hai jo kisi bhi host machine pe smoothly execute hoti hain.
- **Pod Networking**: Kubernetes pods internally localhost ke through communicate kar sakte hain.
- **Auto-Scaling**: Horizontal Pod Autoscaler load increase hone pe automated replica count badha deta hai.
- **Secrets Management**: Sensitive credentials ko ConfigMaps aur Secrets mein safely store kiya jata hai.
- **Rolling Deployments**: Zero downtime ke sath naye application versions deploy kiye ja sakte hain.

### 3. Key Moments & Chapters
- [00:00] **Introduction**: Microservices challenge aur Docker ka introduction.
- [03:45] **Architecture Deep Dive**: Container runtime aur control plane components ki functioning.
- [08:20] **Kubernetes Cluster Setup**: Minikube aur kubectl configure karne ka practical demo.
- [14:10] **Deployment Walkthrough**: YAML manifests create aur apply karne ka step-by-step process.

### 4. What To Do Next
- Docker Desktop install karke hello-world container run karein.
- Sample Express API ke liye Dockerfile write karein.`;

  const parsed = parseStructuredSummary(sampleYtHinglishSummary);

  assert.ok(parsed.tldr.includes('Yeh video batata hai'));
  assert.equal(parsed.keyTakeaways.length, 5);
  assert.ok(parsed.chapters);
  assert.equal(parsed.chapters?.length, 4);
  assert.equal(parsed.chapters?.[0].timestamp, '00:00');
  assert.equal(parsed.chapters?.[1].timestamp, '03:45');
  assert.equal(parsed.chapters?.[1].seconds, 225);
  assert.equal(parsed.chapters?.[1].title, 'Architecture Deep Dive');
  assert.equal(parsed.actionableSteps.length, 2);

  const validation = summaryResultSchema.safeParse(parsed);
  assert.equal(validation.success, true);
});
