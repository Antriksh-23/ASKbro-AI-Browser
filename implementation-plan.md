# Phase-Wise Implementation Plan: ASKbro AI Browser Agent

> **Project:** ASKbro — Chrome Side-Panel AI Agent  
> **Target Platform:** Google Chrome (Desktop) — Manifest V3  
> **References:** [ProblemStatement.md](file:///c:/Users/antri/OneDrive/Desktop/ASKbro-AI%20Browser/ProblemStatement.md) | [architecture.md](file:///c:/Users/antri/OneDrive/Desktop/ASKbro-AI%20Browser/architecture.md)  
> **Development Methodology:** Vertical Slices (Smallest testable unit $\rightarrow$ verified on real pages $\rightarrow$ next slice)

---

## Overview & Milestone Roadmap

```
+---------------------------------------------------------------------------------------+
|                                    ASKBRO ROADMAP                                     |
|                                                                                       |
|  [Phase 0]  Environment, Tooling & Project Skeleton (Day 1)                           |
|      │                                                                                |
|      ▼                                                                                |
|  [Phase 1]  Week 1 — The Eyes: Read the Web (Days 2 - 7)                              |
|      │      Extension Shell • Gemini Client • Readability • YouTube • Hinglish        |
|      ▼                                                                                |
|  [Phase 2]  Week 2 — The Brain: Understand Page & Screen (Days 8 - 14)                |
|      │      Grounded Chat • Context Menus • Screenshot Vision • Fallbacks             |
|      ▼                                                                                |
|  [Phase 3]  Week 3 — The Hands: Act With Approval (Days 15 - 21)                      |
|      │      DOM Scanner • Action Badges • Structured JSON • HITL Loop • Dry Run       |
|      ▼                                                                                |
|  [Phase 4]  Week 4 — Memory, Safety & Shipping (Days 22 - 28)                         |
|             Local Profile • Saved Skills • Code-Level Safety • GitHub Release ZIP     |
+---------------------------------------------------------------------------------------+
```

---

## Phase 0: Environment Setup, Tooling & Project Skeleton

### Objective
Initialize the repository, configure modern Vite + TypeScript build pipelines for Chrome Manifest V3, and verify seamless hot/fast reload in `chrome://extensions`.

### Task Breakdown

#### Task 0.1: Package & Workspace Setup
- Initialize `package.json` with scripts:
  - `dev`: Vite in watch mode.
  - `build`: Production build with TypeScript checking (`tsc && vite build`).
  - `package`: Zips the `dist/` directory into `release.zip` for testing and distribution.
- Dependencies:
  - **Runtime**: `react`, `react-dom`, `@mozilla/readability`, `lucide-react`, `zod`, `clsx`, `tailwind-merge`.
  - **DevDependencies**: `typescript`, `vite`, `@vitejs/plugin-react`, `@crxjs/vite-plugin` (or `@types/chrome` + custom multi-entry rollup), `tailwindcss`, `postcss`, `autoprefixer`.

#### Task 0.2: Manifest V3 Configuration
- Create `manifest.json`:
  ```json
  {
    "manifest_version": 3,
    "name": "ASKbro - AI Browser Agent",
    "version": "1.0.0",
    "description": "Chrome side-panel AI agent that understands web pages and acts under human control.",
    "permissions": [
      "sidePanel",
      "activeTab",
      "scripting",
      "storage",
      "contextMenus",
      "tabs"
    ],
    "action": {
      "default_title": "Open ASKbro"
    },
    "side_panel": {
      "default_path": "src/sidepanel/index.html"
    },
    "background": {
      "service_worker": "src/background/index.ts",
      "type": "module"
    },
    "icons": {
      "16": "public/icons/icon-16.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png"
    }
  }
  ```

#### Task 0.3: Base Directory Structure Setup
- Establish project folders:
  - `src/background/`
  - `src/content/`
  - `src/sidepanel/`
  - `src/services/{ai, safety, storage}/`
  - `src/types/`
  - `src/utils/`

### Verification & Checkpoint
1. Run `npm run build`. Confirm `dist/` is created without TypeScript or bundler errors.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/`.
3. Click the extension toolbar icon. Confirm the side panel opens displaying "ASKbro ready".

---

## Phase 1: Week 1 — The Eyes: Read the Web

### Objective
Build the foundation allowing ASKbro to extract, process, and summarize articles and public YouTube videos in English or Hinglish with zero crashes.

```mermaid
flowchart LR
    ActiveTab[Active Tab] -->|DOM Content| Extractor[Readability / YT Scraper]
    Extractor -->|Clean Text / Captions| ServiceWorker[Service Worker]
    ServiceWorker -->|API Request + Tone Prompt| Gemini[Gemini 1.5 Flash-Lite]
    Gemini -->|Structured Summary| SidePanel[Side Panel Markdown UI]
```

### Vertical Slices & Tasks

#### Slice 1.1: Settings & API Key Storage
- **Files**:
  - `src/services/storage/settingsStore.ts`
  - `src/sidepanel/components/Settings/ApiKeySettings.tsx`
- **Details**:
  - Store `geminiApiKey` and `groqApiKey` securely inside `chrome.storage.local`.
  - Provide input masking, test connection button (fires a test ping to Gemini), and validation feedback.
  - Ensure keys are never stored in source code or sent to external telemetry.

#### Slice 1.2: Gemini Client Service
- **Files**:
  - `src/services/ai/gemini.ts`
  - `src/types/ai.ts`
- **Details**:
  - Implement typed caller for Gemini 1.5 Flash-Lite (`v1beta/models/gemini-1.5-flash-lite:generateContent`).
  - Support streaming responses using Server-Sent Events (`streamGenerateContent`) when available.
  - Implement system instructions enforcing structured summarization format.

#### Slice 1.3: Content Script Article Extractor
- **Files**:
  - `src/content/reader.ts`
  - `src/types/messages.ts`
- **Details**:
  - Content script listens for `EXTRACT_PAGE_CONTENT` message.
  - Clones document DOM and applies `@mozilla/readability`.
  - Extracts title, author, clean text body, and estimated reading time.
  - Gracefully falls back to body text if Readability returns null.

#### Slice 1.4: Structured Summarization Engine
- **Files**:
  - `src/services/ai/promptBuilder.ts`
  - `src/sidepanel/components/Summary/SummaryCard.tsx`
- **Details**:
  - Structured output prompt generating:
    1. **TL;DR**: Exactly one concise sentence.
    2. **5 Key Takeaways**: Bullet points with bold lead-ins.
    3. **Actionable Next Steps / What to do next**: 2–3 concrete suggestions.

#### Slice 1.5: Public YouTube Video Summarizer
- **Files**:
  - `src/content/youtube.ts`
- **Details**:
  - Detect `window.location.hostname.includes("youtube.com") && window.location.pathname === "/watch"`.
  - Scrape video title, channel, description, and available chapters/timestamps from `#description` or player DOM.
  - Send to Gemini with prompt requesting chapter-wise notes and clickable timestamps (`mm:ss`). Clicking timestamps in the side panel seeks the video (`videoElement.currentTime = seconds`).

#### Slice 1.6: English / Hinglish Language Switcher
- **Files**:
  - `src/sidepanel/components/Common/LanguageToggle.tsx`
- **Details**:
  - Persistent state in `chrome.storage.local`: `"en" | "hinglish"`.
  - In Hinglish mode, instruct the prompt: *"Summarise the content in colloquial Hinglish (Hindi written in Roman English script, widely used in India, e.g., 'Yeh video batata hai ki...') while keeping technical terms intact."*

### Phase 1 Acceptance Criteria
- [ ] Loads unpacked without warnings in Chrome.
- [ ] Side panel displays settings and persists API key in `chrome.storage.local`.
- [ ] News/blog articles (e.g., Wikipedia, Medium, TechCrunch) summarize accurately into TL;DR + 5 Points + Next Steps.
- [ ] YouTube video pages produce timestamped chapter notes that seek the video on click.
- [ ] Language toggle instantly switches output style between English and conversational Hinglish.

---

## Phase 2: Week 2 — The Brain: Understand Page & Screen

### Objective
Turn the side panel into a grounded conversational assistant that can reason over active DOM text, inspect screenshots, support right-click AI actions, and handle rate limits with automatic fallbacks.

```mermaid
sequenceDiagram
    actor User
    participant SP as Side Panel
    participant SW as Service Worker
    participant CS as Content Script
    participant LLM as Gemini / Groq

    User->>SP: "Does this article mention refund policy?"
    SP->>SW: QUERY_PAGE_CHAT(query)
    SW->>CS: GET_PAGE_TEXT
    CS-->>SW: Raw Page Text (Truncated/Windowed)
    SW->>LLM: Prompt(Query, PageContext)
    LLM-->>SW: Grounded Answer (or "Not mentioned on page")
    SW-->>SP: Stream answer to user
```

### Vertical Slices & Tasks

#### Slice 2.1: Grounded Page Chat
- **Files**:
  - `src/sidepanel/components/Chat/ChatView.tsx`
  - `src/services/ai/groundedChat.ts`
- **Details**:
  - Chat interface maintaining session message history.
  - Injects full or chunked page context inside `<page_context>` XML tags.
  - **Grounding Rule**: Explicit instruction to state *"The current page does not provide information about..."* if answer is not in the text, avoiding hallucinations.

#### Slice 2.2: Context Menu AI Actions (Explain, Translate, Draft)
- **Files**:
  - `src/background/menuHandler.ts`
- **Details**:
  - Register right-click context menus via `chrome.contextMenus.create`:
    - `askbro-explain`: "Explain this with ASKbro"
    - `askbro-translate`: "Translate to Hindi/Hinglish"
    - `askbro-reply`: "Draft a reply to this"
  - When triggered, captures selected text via `info.selectionText`, activates the side panel, and populates the result automatically.

#### Slice 2.3: Visual Screen Understanding ("Screenshot-and-Ask")
- **Files**:
  - `src/background/captureHandler.ts`
  - `src/sidepanel/components/Vision/ScreenshotModal.tsx`
  - `src/services/ai/vision.ts`
- **Details**:
  - Trigger `chrome.tabs.captureVisibleTab(null, {format: 'png'})`.
  - Pass the PNG Data URL into the Side Panel with a lightweight crop/inspector tool.
  - Send image + question payload to **Gemini 1.5 Flash** (multimodal endpoint).
  - Handles charts, visual tables, error callouts, and layout diagrams.

#### Slice 2.4: Free-Tier Resilience & Fallback Engine
- **Files**:
  - `src/services/ai/rateLimiter.ts`
  - `src/services/ai/groq.ts`
  - `src/services/ai/index.ts`
- **Details**:
  - Intercept HTTP 429 / Quota Exceeded errors.
  - Implement exponential backoff (1s $\rightarrow$ 2s $\rightarrow$ 4s).
  - If retry fails or quota is exhausted for text queries, automatically fall back to **Groq Cloud API** (Mixtral 8x7b / Llama 3 on free tier).
  - If multimodal or all fail, render an informative, non-crashing banner: *"Daily free-tier quota reached. Retry in X seconds or configure fallback key."*

### Phase 2 Acceptance Criteria
- [ ] User can ask questions about the open page; answers cite page facts and decline unknown facts.
- [ ] Right-clicking highlighted text offers "Explain", "Translate", and "Draft", and injects results into the side panel.
- [ ] "Capture Screen" button snaps active tab, allows user prompt, and interprets charts/visual content accurately.
- [ ] Forcing an HTTP 429 response triggers retry and automatic Groq fallback without UI crashes.

---

## Phase 3: Week 3 — The Hands: Act With User Approval

### Objective
Implement controlled computer-use capabilities: scanning actionable elements, rendering non-destructive numbered badges, producing structured JSON actions, and executing them **strictly after human approval**.

```mermaid
flowchart TD
    Scan[Scanner scans DOM] --> Badges[Render Shadow-DOM Badges]
    Badges --> ActionMap[Generate JSON Action Map]
    ActionMap --> Prompt[Send to Gemini Flash-Lite]
    Prompt --> ZodValidate[Zod Validation: NextActionSchema]
    ZodValidate --> ApprovalCard[Show Side Panel Action Approval Card]
    
    ApprovalCard --> UserChoice{User Decision}
    UserChoice -- Approve --> Exec[Execute Action via Content Script]
    UserChoice -- Dry Run --> Highlight[Highlight Element Only]
    UserChoice -- Skip --> NextStep[Re-prompt without that element]
    UserChoice -- Stop --> Abort[Kill Task & Teardown Badges]

    Exec --> Log[Record to Action Log]
    Log --> LoopCheck{Task Complete?}
    LoopCheck -- No --> Scan
    LoopCheck -- Yes --> Finished[Show Task Summary]
```

### Vertical Slices & Tasks

#### Slice 3.1: Interactive Element Scanner & Shadow DOM Badges
- **Files**:
  - `src/content/scanner.ts`
  - `src/content/badges.ts`
- **Details**:
  - Traverses interactive nodes: `button`, `a`, `input`, `textarea`, `select`, `[role="button"]`, `[tabindex]`.
  - Filters out hidden (`display: none`, `visibility: hidden`, `opacity: 0`, width/height < 5px).
  - Assigns unique integer IDs: `1, 2, 3...`.
  - Injects a closed Shadow DOM overlay `#askbro-badge-root` containing floating badge pills positioned via `getBoundingClientRect()`.
  - Re-calculates on window `resize` and `scroll`.

#### Slice 3.2: Action Map JSON Generation & "Find It For Me"
- **Files**:
  - `src/services/ai/actionMap.ts`
- **Details**:
  - Converts DOM elements into clean, compact representation:
    ```json
    {"id": 4, "type": "button", "text": "Submit Application"}
    ```
  - Feature: User asks *"Where do I upload my resume?"*
  - LLM returns target element ID `{"targetElementId": 4, "reason": "File upload input"}`.
  - ASKbro smoothly scrolls the page and pulses a cyan highlight on badge #4 without clicking.

#### Slice 3.3: Strict JSON Action Engine (Zod Schema)
- **Files**:
  - `src/services/ai/schemas.ts`
- **Details**:
  - Enforce JSON format using Gemini structured output schemas / system prompt:
    ```typescript
    export const ActionStepSchema = z.object({
      action: z.enum(['click', 'type', 'select', 'scroll', 'done']),
      targetId: z.number().nullable(),
      value: z.string().nullable(),
      reason: z.string(),
      isConsequential: z.boolean()
    });
    ```
  - Parse and validate every LLM response before letting it touch the UI.

#### Slice 3.4: Human-in-the-Loop (HITL) Action Approval Card
- **Files**:
  - `src/sidepanel/components/Agent/ActionCard.tsx`
  - `src/sidepanel/components/Agent/AgentControls.tsx`
- **Details**:
  - Renders the proposed step:
    - **Action**: `CLICK` / `TYPE` / `SELECT` / `SCROLL`
    - **Target Element**: Number badge + element description
    - **Input Value**: Show typed text or chosen option
    - **Reasoning**: One-line rationale from LLM
  - Buttons:
    - `Approve`: Dispatches action execution to content script.
    - `Dry Run`: Flashes element outline on the page without performing click/type.
    - `Skip`: Skips this element and requests an alternative step.
    - `Stop`: Immediate abort.
  - Step counter: Configurable maximum steps (default: 10) to prevent loops.

#### Slice 3.5: Content Script Action Executor
- **Files**:
  - `src/content/executor.ts`
- **Details**:
  - Safely simulates native user interactions:
    - `click`: Focuses $\rightarrow$ dispatches `pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`.
    - `type`: Clears input $\rightarrow$ sets `.value` $\rightarrow$ dispatches `input` and `change` events.
    - `select`: Updates selected index $\rightarrow$ dispatches `change`.
    - `scroll`: Smooth scroll by offset.

#### Slice 3.6: Worker Hibernation & Session State Persistence
- **Files**:
  - `src/background/stateManager.ts`
- **Details**:
  - Write agent execution progress to `chrome.storage.session` after every step.
  - If the service worker sleeps during user contemplation on the approval card, restoring the side panel re-reads the pending state instantly.
  - Record each step into an audit log (`chrome.storage.local`).

### Phase 3 Acceptance Criteria
- [ ] Numbered badges overlay all actionable elements without breaking page layout.
- [ ] "Find it for me" correctly scrolls to and highlights target elements from natural language prompts.
- [ ] No browser action occurs without explicit click on `Approve`.
- [ ] `Dry Run` outlines the element without triggering any input change or navigation.
- [ ] Multi-step tasks successfully complete on practice test pages (e.g., job application form, search & filter).

---

## Phase 4: Week 4 — Memory, Safety, Packaging & Shipping

### Objective
Add user profile memory for automated form drafts, enable reusable one-click skills with import/export, establish deterministic safety guardrails, and prepare clean public release packages.

```mermaid
graph LR
    subgraph SafetyRails ["Deterministic Code Safety"]
        URLCheck[URL Blacklist Regex: Banking / Payment / UPI]
        FieldCheck[Field Attribute Check: Password / OTP / Card]
        ConsequentialCheck[Consequential Keyword Interceptor: Submit / Pay]
    end

    subgraph MemorySkills ["Personalization & Skills"]
        Profile[Local Profile Storage]
        Skills[One-Click Reusable Skills Library]
        ImpExp[JSON Import / Export]
    end

    SafetyRails --> SafeExecution[Safe, Controlled Execution]
    MemorySkills --> SafeExecution
```

### Vertical Slices & Tasks

#### Slice 4.1: Local Profile Memory
- **Files**:
  - `src/services/storage/profileStore.ts`
  - `src/sidepanel/components/Settings/ProfileView.tsx`
- **Details**:
  - Fields stored locally:
    - Full Name, Email, Phone, College / University, Major, Graduation Year, Portfolio / LinkedIn / GitHub URLs, Skills List, Preferred Writing Tone.
  - Integration: When user requests *"Fill this form from my profile"*, the action planner maps form fields directly to profile fields.

#### Slice 4.2: One-Click Reusable Skills Engine
- **Files**:
  - `src/services/storage/skillsStore.ts`
  - `src/sidepanel/components/Skills/SkillsLibrary.tsx`
- **Details**:
  - Pre-packaged starter skills:
    1. **Exam Notes**: Structured summary focusing on key terms, definitions, and equations.
    2. **Explain in Hinglish**: Conversational breakdown for quick comprehension.
    3. **Reply to this Politely**: Professional draft response to selected emails or posts.
    4. **Fill from Profile**: Autofills known input fields from local memory.
  - Skill creation modal: Name, description, system prompt, action workflow.
  - Export & import skills as portable `.json` files.

#### Slice 4.3: Deterministic Code Safety Guardrails
- **Files**:
  - `src/services/safety/domainGuard.ts`
  - `src/services/safety/fieldGuard.ts`
  - `src/services/safety/consequentialGuard.ts`
- **Details**:
  - **Domain Guard**: Hardcoded blacklist for domains containing `bank`, `paytm`, `phonepe`, `razorpay`, `upi`, `checkout`, `billing`, `stripe`. If current URL matches, disable agent loop and display a protective badge.
  - **Field Guard**: In `scanner.ts` and `executor.ts`, explicitly reject inputs matching:
    - `input[type="password"]`
    - `input[autocomplete*="one-time-code"]`
    - `input[autocomplete*="cc-"]`
    - RegEx matching `/(otp|cvv|pin|card|ssn)/i` on `name`, `id`, or `placeholder`.
  - **Consequential Action Warning**: If target button text includes `submit`, `place order`, `pay`, or `delete`, display an amber confirmation modal requiring an explicit confirmation toggle.

#### Slice 4.4: Packaging, Landing Page & Documentation
- **Files**:
  - `README.md`
  - `public/landing/index.html`
  - `scripts/package.js`
- **Details**:
  - Create comprehensive `README.md` with features, setup instructions, architecture diagram, and animated GIF demos.
  - Add build packaging script creating `ASKbro-v1.0.0.zip` ready for `chrome://extensions` "Load unpacked".
  - Build clean single-page GitHub Pages landing site (`public/landing/index.html`) explaining the project.

### Phase 4 Acceptance Criteria
- [ ] User profile data populates form fields accurately upon approval.
- [ ] One-click skills can be executed, edited, exported to `.json`, and imported on another machine.
- [ ] Safety rails actively block banking sites, password fields, and OTP inputs without relying on LLM compliance.
- [ ] Consequential buttons ("Pay", "Submit") trigger the secondary confirmation warning.
- [ ] Release ZIP installs cleanly via "Load unpacked" on a fresh Chrome browser without build artifacts or missing assets.

---

## Technical Debt, Risks & Mitigation Strategy

| Risk Factor | Probability | Impact | Mitigation Strategy |
| :--- | :---: | :---: | :--- |
| **Manifest V3 Worker Inactivity** | High | High | Continuously sync multi-step task state to `chrome.storage.session`. Wake-up handles uncompleted steps instantly. |
| **Dynamic SPA DOM Mutation** | High | Medium | Use `MutationObserver` in content script to invalidate and refresh Action Badges when dynamic DOM changes occur. |
| **Gemini Rate Limits (HTTP 429)** | Medium | High | Implement automatic exponential backoff, prompt length truncation, and text-only fallback to Groq free-tier endpoints. |
| **Host Site CSS Collisions** | High | Medium | Mount all badges and visual highlights inside a closed Shadow DOM container (`attachShadow({mode: 'closed'})`). |
| **Accidental Sensitive Data Entry** | Low | Critical | Hardcoded client-side inspection filters reject password, OTP, and payment inputs before LLM can propose actions. |

---

## Definition of Done (Final Project Checklist)

A release is marked **Complete and Shippable** when:

1. [ ] **Summarisation**: Cleans and summarizes news articles and YouTube videos with clickable timestamps.
2. [ ] **Bilingual**: Seamlessly switches between English and natural Hinglish output.
3. [ ] **Context Chat**: Chats with page context, adhering strictly to grounded page truth.
4. [ ] **Right-Click**: Context menus provide instant Explain, Translate, and Draft actions.
5. [ ] **Screen Vision**: Captures tab viewport and interprets charts/diagrams via Gemini Flash.
6. [ ] **Element Locator**: "Find it for me" scrolls to and spotlights requested elements.
7. [ ] **Computer Use**: Completes multi-step form and search tasks step-by-step.
8. [ ] **HITL Verification**: Every computer-use action requires explicit human approval.
9. [ ] **Safety Rails**: Password, OTP, card fields, and banking domains are hard-blocked.
10. [ ] **Memory & Skills**: Stores local user profile, saves custom skills, and supports export/import.
11. [ ] **Zero API Key Leaks**: Extension keys are kept exclusively in local storage; repository is clean.
12. [ ] **Packaging**: Standalone installable ZIP and clean documentation ready for public release.

