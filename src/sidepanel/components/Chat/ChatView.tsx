import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Square,
  RotateCcw,
  Copy,
  Check,
  Sparkles,
  Bot,
  User,
  Globe,
  AlertCircle,
  KeyRound,
  ShieldCheck,
  RefreshCw,
  ChevronRight,
  Camera,
  Zap,
  Crosshair,
  Play,
  Terminal,
  History,
} from 'lucide-react';
import { AISettings, ChatMessage, OutputLanguage } from '../../../types/ai';
import { PageContentResponse } from '../../../types/messages';
import {
  requestTabContentExtraction,
  getActiveTab,
  isRestrictedUrl,
  seekActiveTabVideo,
} from '../../../services/reader';
import {
  getTabSession,
  setTabSession,
  saveTabMessages,
  clearTabMessages,
  removeTabSession,
  initTabChatStore,
  setStoreActiveTabId,
} from '../../../services/storage/tabChatStore';
import {
  saveChatHistorySession,
  ChatHistorySession,
} from '../../../services/storage/historyStore';
import {
  streamChatWithPage,
  createChatMessage,
  generateSuggestedQuestions,
  isGroundedNotFoundAnswer,
  GROUNDING_NOT_FOUND_SENTENCE,
} from '../../../services/ai/groundedChat';
import {
  isFindElementIntent,
  locateAndHighlightElement,
  highlightTabElement,
  clearTabBadges,
} from '../../../services/ai/actionMap';
import { GeminiError } from '../../../services/ai/gemini';
import { QuotaExceededError, formatQuotaBannerMessage } from '../../../services/ai/rateLimiter';
import LanguageToggle from '../Common/LanguageToggle';
import RateLimitBanner from '../Common/RateLimitBanner';
import { ScreenshotModal } from '../Vision';

export interface ChatViewProps {
  settings: AISettings;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  loadedSession?: ChatHistorySession | null;
  onClearLoadedSession?: () => void;
  onLanguageChange?: (language: OutputLanguage) => void;
  initialPageContext?: PageContentResponse | null;
  onSwitchToSummary?: () => void;
  initialQuery?: string | null;
  onClearInitialQuery?: () => void;
  isActive?: boolean;
  onStreamingChange?: (isStreaming: boolean) => void;
}

export default function ChatView({
  settings,
  onOpenSettings,
  onOpenHistory,
  loadedSession,
  onClearLoadedSession,
  onLanguageChange,
  initialPageContext,
  onSwitchToSummary,
  initialQuery,
  onClearInitialQuery,
  isActive = true,
  onStreamingChange,
}: ChatViewProps) {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamingDelta, setStreamingDelta] = useState<string>('');
  const [pageContext, setPageContext] = useState<PageContentResponse | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [activeTabInfo, setActiveTabInfo] = useState<{ title: string; url: string; isRestricted?: boolean } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<{ message: string; isAuth?: boolean; isRateLimit?: boolean } | null>(null);
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    seconds: number;
    message: string;
    isMultimodal?: boolean;
    provider?: 'gemini' | 'groq';
  } | null>(null);
  const [isVisionModalOpen, setIsVisionModalOpen] = useState<boolean>(false);
  const [videoSeekNotice, setVideoSeekNotice] = useState<string | null>(null);

  const handleSeekVideo = async (timestampStr: string) => {
    const clean = timestampStr.replace(/[\[\]]/g, '').trim();
    const parts = clean.split(':').map((p) => parseInt(p, 10));
    let seconds = 0;
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else {
      return;
    }

    try {
      setVideoSeekNotice(`Seeking video to ${clean}...`);
      const res = await seekActiveTabVideo(seconds, activeTabId ?? undefined);
      if (res.success) {
        setVideoSeekNotice(`Jumped to ${clean}!`);
        setTimeout(() => setVideoSeekNotice(null), 3000);
      } else {
        setVideoSeekNotice(res.error || `Could not seek video.`);
        setTimeout(() => setVideoSeekNotice(null), 4000);
      }
    } catch (err: any) {
      setVideoSeekNotice(`Seek error: ${err?.message || err}`);
      setTimeout(() => setVideoSeekNotice(null), 4000);
    }
  };

  const renderMessageContent = (content: string) => {
    const timestampRegex = /(\[(?:\d{1,2}:)?\d{1,2}:\d{2}\])/g;
    if (!timestampRegex.test(content)) {
      return <div className="whitespace-pre-wrap break-words leading-relaxed">{content}</div>;
    }

    const parts = content.split(timestampRegex);
    return (
      <div className="whitespace-pre-wrap break-words leading-relaxed">
        {parts.map((part, idx) => {
          if (timestampRegex.test(part)) {
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSeekVideo(part)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-[2px] bg-[#121417] hover:bg-[#20242A] text-[#D4FF00] hover:text-[#FFFFFF] border border-[#343B45] hover:border-[#D4FF00]/50 font-mono text-[10px] font-semibold transition-colors align-baseline"
                title={`Click to seek video to ${part}`}
              >
                <Play className="w-2.5 h-2.5 fill-current text-[#D4FF00]" />
                <span>{part}</span>
              </button>
            );
          }
          return <span key={idx}>{part}</span>;
        })}
      </div>
    );
  };

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Sync refs to protect async callbacks and Chrome event listeners from stale closures
  const currentTabIdRef = useRef<number | null>(null);
  const currentSessionIdRef = useRef<string>(`chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const pageContextRef = useRef<PageContentResponse | null>(pageContext);
  const pageErrorRef = useRef<string | null>(pageError);
  const activeTabInfoRef = useRef<{ title: string; url: string; isRestricted?: boolean } | null>(activeTabInfo);
  const inputTextRef = useRef<string>(inputText);
  const isStreamingRef = useRef<boolean>(isStreaming);
  const streamingAccumulatedRef = useRef<string>('');
  const tabStreamingDeltasRef = useRef<Record<number, string>>({});

  const persistCurrentConversation = useCallback((msgs: ChatMessage[]) => {
    if (!msgs || msgs.length === 0) return;
    const tabInfo = activeTabInfoRef.current;
    const pContext = pageContextRef.current;
    const targetTabId = currentTabIdRef.current;
    saveChatHistorySession({
      id: currentSessionIdRef.current,
      tabId: targetTabId ?? undefined,
      title: tabInfo?.title || pContext?.title || (msgs[0]?.content.slice(0, 50) + '...') || 'Active Web Page',
      url: tabInfo?.url || pContext?.url || '',
      messages: msgs,
      pageContextSummary: pContext?.title,
      updatedAt: Date.now(),
    }).catch((err) => {
      console.warn('[ASKbro ChatView] Auto-persist chat history warning:', err);
    });
  }, []);

  // Rehydrate / load selected past conversation from History
  useEffect(() => {
    if (loadedSession && loadedSession.messages) {
      setMessages(loadedSession.messages);
      messagesRef.current = loadedSession.messages;
      currentSessionIdRef.current = loadedSession.id;
      if (currentTabIdRef.current !== null) {
        setTabSession(currentTabIdRef.current, {
          sessionId: loadedSession.id,
          messages: loadedSession.messages,
        });
      }
      onClearLoadedSession?.();
      scrollToBottom();
    }
  }, [loadedSession, onClearLoadedSession]);

  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  useEffect(() => {
    if (isActive) {
      scrollToBottom();
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [isActive]);

  useEffect(() => {
    if (initialPageContext && (!pageContext || pageContext.url !== initialPageContext.url)) {
      setPageContext(initialPageContext);
      pageContextRef.current = initialPageContext;
      if (currentTabIdRef.current !== null) {
        setTabSession(currentTabIdRef.current, {
          pageContext: initialPageContext,
        });
      }
    }
  }, [initialPageContext]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    pageContextRef.current = pageContext;
  }, [pageContext]);

  useEffect(() => {
    pageErrorRef.current = pageError;
  }, [pageError]);

  useEffect(() => {
    activeTabInfoRef.current = activeTabInfo;
  }, [activeTabInfo]);

  useEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const hasApiKey = Boolean(
    (settings.geminiApiKey && settings.geminiApiKey.trim().length >= 10) ||
    (settings.groqApiKey && settings.groqApiKey.trim().length >= 10)
  );

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingDelta, isStreaming]);

  // Handle incoming initial query from context menu or other actions
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      setInputText(initialQuery);
      onClearInitialQuery?.();
    }
  }, [initialQuery]);

  /**
   * Saves the state of the currently active tab into the session store
   */
  const saveCurrentTabSession = useCallback(() => {
    const tabId = currentTabIdRef.current;
    if (tabId === null) return;

    setTabSession(tabId, {
      tabId,
      url: activeTabInfoRef.current?.url || '',
      title: activeTabInfoRef.current?.title || '',
      messages: messagesRef.current,
      pageContext: pageContextRef.current,
      pageError: pageErrorRef.current,
      activeTabInfo: activeTabInfoRef.current,
      draftInput: inputTextRef.current,
    });
  }, []);

  /**
   * Extracts text content from a specific tab ID and updates state
   */
  const extractTabContent = useCallback(async (
    tabId: number,
    url: string,
    fallbackTitle: string
  ) => {
    setIsLoadingPage(true);
    try {
      const extracted = await requestTabContentExtraction(tabId);
      if (currentTabIdRef.current !== tabId) return;

      if (extracted.success) {
        setPageContext(extracted);
        pageContextRef.current = extracted;
        setPageError(null);
        pageErrorRef.current = null;

        const updatedInfo = {
          title: extracted.title || fallbackTitle,
          url: extracted.url || url,
          isRestricted: false,
        };
        setActiveTabInfo(updatedInfo);
        activeTabInfoRef.current = updatedInfo;

        setTabSession(tabId, {
          tabId,
          url: extracted.url || url,
          title: extracted.title || fallbackTitle,
          pageContext: extracted,
          pageError: null,
          activeTabInfo: updatedInfo,
        });
      } else {
        setPageContext(null);
        pageContextRef.current = null;
        const errMsg = extracted.error || 'Could not extract text from this tab.';
        setPageError(errMsg);
        pageErrorRef.current = errMsg;

        setTabSession(tabId, {
          tabId,
          url,
          title: fallbackTitle,
          pageContext: null,
          pageError: errMsg,
          activeTabInfo: { title: fallbackTitle, url, isRestricted: false },
        });
      }
    } catch (err: any) {
      if (currentTabIdRef.current !== tabId) return;
      setPageContext(null);
      pageContextRef.current = null;
      const errMsg = err?.message || 'Could not connect to active page.';
      setPageError(errMsg);
      pageErrorRef.current = errMsg;

      setTabSession(tabId, {
        tabId,
        url,
        title: fallbackTitle,
        pageContext: null,
        pageError: errMsg,
        activeTabInfo: { title: fallbackTitle, url, isRestricted: false },
      });
    } finally {
      if (currentTabIdRef.current === tabId) {
        setIsLoadingPage(false);
      }
    }
  }, []);

  /**
   * Switches the active tab view to a newly focused tab
   */
  const switchActiveTab = useCallback(async (newTabId: number) => {
    saveCurrentTabSession();

    currentTabIdRef.current = newTabId;
    setActiveTabId(newTabId);
    setStoreActiveTabId(newTabId);

    const existingSession = getTabSession(newTabId);

    if (newTabId !== null && tabStreamingDeltasRef.current[newTabId] !== undefined) {
      setIsStreaming(true);
      setStreamingDelta(tabStreamingDeltasRef.current[newTabId]);
    } else {
      setIsStreaming(false);
      setStreamingDelta('');
    }

    if (existingSession) {
      setMessages(existingSession.messages || []);
      setPageContext(existingSession.pageContext || null);
      setPageError(existingSession.pageError || null);
      setActiveTabInfo(existingSession.activeTabInfo || null);
      setInputText(existingSession.draftInput || '');
      if (existingSession.sessionId) {
        currentSessionIdRef.current = existingSession.sessionId;
      }
    } else {
      setMessages([]);
      setPageContext(null);
      setPageError(null);
      setInputText('');
      currentSessionIdRef.current = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      try {
        const tab = await getActiveTab();
        if (tab && tab.id === newTabId) {
          const isRestricted = isRestrictedUrl(tab.url);
          const info = {
            title: tab.title || 'Untitled Tab',
            url: tab.url || '',
            isRestricted,
          };
          setActiveTabInfo(info);

          if (isRestricted) {
            setPageError(
              'Chrome restricts extensions from reading browser internal pages (chrome://, Web Store, or empty tabs).'
            );
          } else if (tab.url) {
            extractTabContent(newTabId, tab.url, tab.title || '');
          }
        }
      } catch (err: any) {
        console.warn('[ASKbro ChatView] Failed to initialize active tab info:', err);
      }
    }
  }, [saveCurrentTabSession, extractTabContent]);

  // Initial load: setup tab session store and active tab
  useEffect(() => {
    initTabChatStore();

    const initActiveTab = async () => {
      try {
        const tab = await getActiveTab();
        if (tab && tab.id !== undefined) {
          switchActiveTab(tab.id);
        }
      } catch (err) {
        console.warn('[ASKbro ChatView] Error retrieving active tab:', err);
      }
    };

    initActiveTab();

    const handleTabActivated = (activeInfo: { tabId: number; windowId: number }) => {
      switchActiveTab(activeInfo.tabId);
    };

    const handleTabUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (tabId === currentTabIdRef.current && changeInfo.status === 'complete' && tab.url) {
        const isRestricted = isRestrictedUrl(tab.url);
        setActiveTabInfo({
          title: tab.title || 'Untitled Tab',
          url: tab.url,
          isRestricted,
        });

        if (isRestricted) {
          setPageContext(null);
          setPageError('Chrome restricts extensions from reading browser internal pages.');
        } else {
          extractTabContent(tabId, tab.url, tab.title || '');
        }
      }
    };

    const handleTabRemoved = (closedTabId: number) => {
      removeTabSession(closedTabId);
    };

    const handleRuntimeMessage = (message: any) => {
      if (message?.type === 'YOUTUBE_NAVIGATED') {
        const currId = currentTabIdRef.current;
        if (currId !== null) {
          getActiveTab().then((tab) => {
            if (tab && tab.id === currId && tab.url) {
              extractTabContent(currId, tab.url, tab.title || '');
            }
          });
        }
      }
    };

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.onActivated?.addListener(handleTabActivated);
      chrome.tabs.onUpdated?.addListener(handleTabUpdated);
      chrome.tabs.onRemoved?.addListener(handleTabRemoved);
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    }

    return () => {
      saveCurrentTabSession();
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.onActivated?.removeListener(handleTabActivated);
        chrome.tabs.onUpdated?.removeListener(handleTabUpdated);
        chrome.tabs.onRemoved?.removeListener(handleTabRemoved);
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
    };
  }, [switchActiveTab, extractTabContent, saveCurrentTabSession]);

  const handleManualRefresh = () => {
    if (activeTabId !== null && activeTabInfo?.url) {
      extractTabContent(activeTabId, activeTabInfo.url, activeTabInfo.title);
    }
  };

  const handleClearChat = () => {
    if (activeTabId !== null) {
      clearTabMessages(activeTabId);
    }
    setMessages([]);
    messagesRef.current = [];
    currentSessionIdRef.current = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setErrorBanner(null);
    setRateLimitInfo(null);
  };

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const currentId = currentTabIdRef.current;
    if (currentId !== null) {
      delete tabStreamingDeltasRef.current[currentId];
    }
    setIsStreaming(false);

    if (streamingAccumulatedRef.current.trim()) {
      const partialMsg = createChatMessage('model', streamingAccumulatedRef.current.trim(), {
        grounded: true,
      });
      const next = [...messagesRef.current, partialMsg];
      setMessages(next);
      messagesRef.current = next;
      if (currentTabIdRef.current !== null) {
        saveTabMessages(currentTabIdRef.current, next);
      }
      persistCurrentConversation(next);
    }
    setStreamingDelta('');
    streamingAccumulatedRef.current = '';
  };

  const handleSendMessage = async (textToSend?: string) => {
    const rawQuery = textToSend !== undefined ? textToSend : inputText;
    const cleanQuery = rawQuery.trim();
    if (!cleanQuery || isStreaming) return;

    if (!hasApiKey) {
      setErrorBanner({
        message: 'AI API key is missing. Please configure your Gemini or Groq key in Settings to chat with pages.',
        isAuth: true,
      });
      return;
    }

    setErrorBanner(null);
    setRateLimitInfo(null);

    const userMessage = createChatMessage('user', cleanQuery);
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    messagesRef.current = updatedMessages;
    setInputText('');
    inputTextRef.current = '';

    const targetTabId = currentTabIdRef.current;
    if (targetTabId !== null) {
      saveTabMessages(targetTabId, updatedMessages);
      tabStreamingDeltasRef.current[targetTabId] = '';
    }
    persistCurrentConversation(updatedMessages);

    // Check if user query matches locator intent
    if (isFindElementIntent(cleanQuery) && activeTabId !== null) {
      const locateTabId = activeTabId;
      setIsStreaming(true);
      setStreamingDelta('Analyzing page interactive elements...');
      try {
        const locateRes = await locateAndHighlightElement({
          query: cleanQuery,
          apiKey: settings.geminiApiKey,
          groqApiKey: settings.groqApiKey,
          model: settings.model,
          language: settings.language,
          tabId: locateTabId,
        });

        if (locateRes.targetElementId !== null) {
          const explanation = locateRes.found
            ? `Target element located on page (Badge #${locateRes.targetElementId}). Highlighted in active viewport.`
            : `Could not identify an exact match for "${cleanQuery}".`;

          const assistantMsg = createChatMessage('model', explanation, {
            grounded: true,
            isLocatorAction: true,
            targetElementId: locateRes.targetElementId,
          });

          const next = [...updatedMessages, assistantMsg];
          saveTabMessages(locateTabId, next);
          if (currentTabIdRef.current === locateTabId) {
            setMessages(next);
            messagesRef.current = next;
          }
          persistCurrentConversation(next);
          return;
        }
      } catch (err: any) {
        console.warn('[ASKbro ChatView] Locator shortcut failed, falling back to chat:', err);
      } finally {
        if (targetTabId !== null) {
          delete tabStreamingDeltasRef.current[targetTabId];
        }
        if (currentTabIdRef.current === locateTabId) {
          setIsStreaming(false);
          setStreamingDelta('');
        }
      }
    }

    // Regular grounded chat stream
    setIsStreaming(true);
    setStreamingDelta('');
    streamingAccumulatedRef.current = '';

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await streamChatWithPage({
        message: cleanQuery,
        pageContext: pageContext?.textContent || '',
        pageTitle: pageContext?.title,
        pageUrl: pageContext?.url,
        history: messages,
        apiKey: settings.geminiApiKey,
        model: settings.model,
        groqApiKey: settings.groqApiKey,
        language: settings.language,
        signal: controller.signal,
        onChunk: (_delta: string, accumulated: string) => {
          streamingAccumulatedRef.current = accumulated;
          if (targetTabId !== null) {
            tabStreamingDeltasRef.current[targetTabId] = accumulated;
          }
          if (currentTabIdRef.current === targetTabId) {
            setStreamingDelta(accumulated);
          }
        },
      });

      const isNotFound = isGroundedNotFoundAnswer(result.text);

      const assistantMessage = createChatMessage('model', result.text, {
        grounded: !isNotFound,
        isNotFoundOnPage: isNotFound,
        usedFallback: result.usedFallback,
      });

      const finalized = [...updatedMessages, assistantMessage];
      if (targetTabId !== null) {
        saveTabMessages(targetTabId, finalized);
        delete tabStreamingDeltasRef.current[targetTabId];
      }

      if (currentTabIdRef.current === targetTabId) {
        setMessages(finalized);
        messagesRef.current = finalized;
      }
      persistCurrentConversation(finalized);
    } catch (err: any) {
      if (targetTabId !== null) {
        delete tabStreamingDeltasRef.current[targetTabId];
      }
      if (err.name === 'AbortError') return;

      if (err instanceof QuotaExceededError) {
        const retrySecs = err.retryAfterSeconds || 30;
        setRateLimitInfo({
          seconds: retrySecs,
          message: formatQuotaBannerMessage(retrySecs),
          isMultimodal: false,
          provider: 'gemini',
        });
      } else if (err instanceof GeminiError && err.isAuthError) {
        setErrorBanner({
          message: 'Invalid Gemini API Key (HTTP 401/403). Please verify your key in Settings.',
          isAuth: true,
        });
      } else {
        setErrorBanner({
          message: err?.message || 'Failed to complete grounded chat query.',
        });
      }
    } finally {
      if (targetTabId !== null) {
        delete tabStreamingDeltasRef.current[targetTabId];
      }
      if (currentTabIdRef.current === targetTabId) {
        setIsStreaming(false);
        setStreamingDelta('');
      }
      streamingAccumulatedRef.current = '';
      abortControllerRef.current = null;
    }
  };

  const handleVisionDiscussInChat = (query: string, visualSummary?: string) => {
    if (visualSummary) {
      const userMsg = createChatMessage('user', `Analyze visual screen: ${query}`);
      const botMsg = createChatMessage('model', visualSummary, { grounded: true });
      const next = [...messages, userMsg, botMsg];
      setMessages(next);
      messagesRef.current = next;
      if (currentTabIdRef.current !== null) {
        saveTabMessages(currentTabIdRef.current, next);
      }
      persistCurrentConversation(next);
    }
  };

  const handleCopyMessage = async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const suggestedQuestions = generateSuggestedQuestions({
    title: pageContext?.title || activeTabInfo?.title,
    textContent: pageContext?.textContent,
    isYouTube: pageContext?.isYouTube,
  });

  return (
    <div className="flex flex-col flex-1 h-full min-h-[500px] bg-[#0C0D0E] text-[#E0E3E8]">
      {/* Page Context Ribbon — Machined Telemetry Inset */}
      <div className="px-3 py-2 bg-[#121417] border-b border-[#2A303A] sticky top-0 z-10 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-5 h-5 rounded-[2px] bg-[#181B1F] text-[#D4FF00] border border-[#2A303A] flex items-center justify-center shrink-0">
              <Globe className="w-3 h-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-xs font-semibold text-[#FFFFFF] truncate font-sans" title={activeTabInfo?.title || 'Active Tab'}>
                  {isLoadingPage ? 'Analyzing target page...' : activeTabInfo?.title || 'No Web Page Loaded'}
                </p>
              </div>
              <div className="text-[10px] text-[#737C8A] font-mono truncate" title={activeTabInfo?.url}>
                {pageContext?.isYouTube ? (
                  <span className="flex items-center gap-1.5 text-[#9DA5B2]">
                    <span className="px-1 py-0.2 rounded-[2px] bg-[#181B1F] border border-[#D4FF00]/40 text-[#D4FF00] font-semibold text-[9px] uppercase tracking-wider">
                      YOUTUBE STREAM
                    </span>
                    {pageContext.videoDetails?.durationFormatted && (
                      <span>{pageContext.videoDetails.durationFormatted}</span>
                    )}
                  </span>
                ) : pageContext ? (
                  <span className="text-[#9DA5B2]">
                    {pageContext.wordCount.toLocaleString()} words • {pageContext.readingTimeMinutes}m read • <span className="text-[#D4FF00]">INDEXED</span>
                  </span>
                ) : (
                  activeTabInfo?.url || 'Awaiting active tab'
                )}
              </div>
            </div>
          </div>

          {/* Context Actions */}
          <div className="flex items-center gap-1 shrink-0 font-mono">
            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                disabled={isStreaming}
                className="p-1.5 rounded-[2px] text-[#9DA5B2] hover:text-[#D4FF00] hover:bg-[#20242A] border border-transparent hover:border-[#343B45] transition-all disabled:opacity-30"
                title="Access conversation history & past sessions"
                aria-label="History"
                data-testid="askbro-chat-history-btn"
              >
                <History className="w-3 h-3" />
              </button>
            )}

            <button
              onClick={handleManualRefresh}
              disabled={isLoadingPage || isStreaming}
              className="p-1.5 rounded-[2px] text-[#9DA5B2] hover:text-[#FFFFFF] hover:bg-[#20242A] border border-transparent hover:border-[#343B45] transition-all disabled:opacity-30"
              title="Refresh and re-read page context"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingPage ? 'animate-spin text-[#D4FF00]' : ''}`} />
            </button>

            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                disabled={isStreaming}
                className="p-1.5 rounded-[2px] text-[#737C8A] hover:text-[#F59E0B] hover:bg-[#2A1E0B] border border-transparent hover:border-[#F59E0B]/30 transition-all disabled:opacity-30"
                title="Clear chat history"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Page Error / Restriction Callout */}
        {pageError && (
          <div className="p-2 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/40 text-[#E0E3E8] text-[11px] flex items-start gap-2 animate-fade-in font-sans">
            <AlertCircle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="flex-1 leading-snug">
              <span>{pageError}</span>
            </div>
          </div>
        )}
      </div>

      {/* Free-Tier Rate Limit & Quota Resilience Banner */}
      {rateLimitInfo && (
        <div className="mx-3 mt-2.5">
          <RateLimitBanner
            initialSeconds={rateLimitInfo.seconds}
            message={rateLimitInfo.message}
            isMultimodal={rateLimitInfo.isMultimodal}
            provider={rateLimitInfo.provider}
            onOpenSettings={onOpenSettings}
            onRetry={() => handleSendMessage()}
            onDismiss={() => setRateLimitInfo(null)}
          />
        </div>
      )}

      {/* Error Banner */}
      {errorBanner && (
        <div className="m-3 p-3 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs flex items-start justify-between gap-2 shadow-sm animate-fade-in">
          <div className="flex items-start gap-2 flex-1">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <p className="leading-relaxed text-[#FFFFFF]">{errorBanner.message}</p>
              {errorBanner.isAuth && onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="px-2.5 py-1 rounded-[2px] btn-lime font-mono text-[11px] inline-flex items-center gap-1.5 shadow-sm"
                >
                  <KeyRound className="w-3 h-3" />
                  <span>Configure API Key</span>
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-[#737C8A] hover:text-[#FFFFFF] p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Message Stream Viewport */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3">
        {/* Empty State with Suggested Questions */}
        {messages.length === 0 && !isStreaming && (
          <div className="py-6 px-1 flex flex-col items-center text-center space-y-3.5 max-w-sm mx-auto animate-fade-in">
            <div className="w-9 h-9 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#D4FF00] flex items-center justify-center shadow-sm">
              <Terminal className="w-4 h-4" />
            </div>

            <div className="space-y-1">
              <h3 className="font-mono font-bold text-xs text-[#FFFFFF] tracking-wider uppercase">
                Grounded Document Analysis
              </h3>
              <p className="text-xs text-[#9DA5B2] leading-relaxed">
                Query this webpage directly. Responses are mathematically grounded in the active DOM tree.
              </p>
            </div>

            {/* Zero-Hallucination Protocol Card */}
            <div className="px-3 py-2.5 rounded-[2px] bg-[#121417] border border-[#2A303A] text-left space-y-1 w-full shadow-well-inset font-sans">
              <div className="flex items-center gap-1.5 text-[#D4FF00] text-[10px] font-mono font-semibold uppercase tracking-wider">
                <ShieldCheck className="w-3 h-3" />
                <span>Zero-Hallucination Protocol</span>
              </div>
              <p className="text-[10px] text-[#737C8A] leading-relaxed font-mono">
                When content is absent from the page, ASKbro strictly returns:{' '}
                <span className="text-[#E0E3E8]">
                  &ldquo;{GROUNDING_NOT_FOUND_SENTENCE} [topic].&rdquo;
                </span>
              </p>
            </div>

            {/* Suggested Starter Questions */}
            <div className="w-full space-y-1.5 pt-1">
              <div className="flex items-center gap-1 text-[9px] uppercase font-mono font-semibold tracking-wider text-[#737C8A] px-0.5">
                <Sparkles className="w-2.5 h-2.5 text-[#D4FF00]" />
                <span>Suggested Queries</span>
              </div>
              <div className="flex flex-col gap-1">
                {suggestedQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(q)}
                    className="w-full text-left p-2 rounded-[2px] bg-[#181B1F] hover:bg-[#20242A] border border-[#2A303A] hover:border-[#343B45] text-xs text-[#E0E3E8] hover:text-[#FFFFFF] transition-all flex items-center justify-between group shadow-sm font-sans"
                  >
                    <span className="line-clamp-1">{q}</span>
                    <ChevronRight className="w-3 h-3 text-[#737C8A] group-hover:text-[#D4FF00] transition-colors shrink-0 ml-1.5" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Existing Messages */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in`}
          >
            <div
              className={`max-w-[90%] rounded-[2px] p-2.5 text-xs leading-relaxed shadow-sm font-sans ${
                msg.role === 'user'
                  ? 'bg-[#20242A] border border-[#343B45] text-[#FFFFFF]'
                  : 'bg-[#181B1F] border border-[#2A303A] text-[#E0E3E8]'
              }`}
            >
              {/* Header inside assistant message */}
              {msg.role === 'model' && (
                <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-[#2A303A] text-[10px] font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="telemetry-led-lime" />
                    <span className="text-[#FFFFFF] font-semibold tracking-wider">ASKbro</span>
                  </div>

                  <div className="flex items-center gap-1">
                    {msg.usedFallback && (
                      <span
                        className="px-1.5 py-0.2 rounded-[2px] bg-[#20242A] border border-[#343B45] text-[#F59E0B] text-[9px] font-mono flex items-center gap-1"
                        title="Served via Groq Cloud fallback"
                      >
                        <Zap className="w-2.5 h-2.5" />
                        GROQ
                      </span>
                    )}

                    {msg.isLocatorAction && msg.targetElementId != null && (
                      <span className="px-1.5 py-0.2 rounded-[2px] bg-[#121417] border border-[#D4FF00]/40 text-[#D4FF00] text-[9px] font-mono flex items-center gap-1">
                        <Crosshair className="w-2.5 h-2.5" />
                        DOM #{msg.targetElementId}
                      </span>
                    )}

                    {msg.isNotFoundOnPage ? (
                      <span className="px-1.5 py-0.2 rounded-[2px] bg-[#2A1E0B] border border-[#F59E0B]/40 text-[#F59E0B] text-[9px] font-mono">
                        NOT ON PAGE
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded-[2px] bg-[#121417] border border-[#D4FF00]/40 text-[#D4FF00] text-[9px] font-mono flex items-center gap-1">
                        <Check className="w-2.5 h-2.5" />
                        GROUNDED
                      </span>
                    )}

                    <button
                      onClick={() => handleCopyMessage(msg.id, msg.content)}
                      className="p-1 rounded-[2px] hover:bg-[#20242A] text-[#737C8A] hover:text-[#FFFFFF] transition-colors ml-0.5"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3 h-3 text-[#D4FF00]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Message text rendering */}
              {renderMessageContent(msg.content)}

              {/* Locator Action Controls */}
              {msg.isLocatorAction && msg.targetElementId != null && (
                <div className="mt-2.5 pt-2 border-t border-[#2A303A] flex flex-wrap items-center gap-1.5 font-mono">
                  <button
                    type="button"
                    onClick={async () => {
                      await highlightTabElement(msg.targetElementId!);
                    }}
                    className="px-2 py-1 rounded-[2px] btn-lime text-[10px] font-semibold flex items-center gap-1.5 shadow-sm"
                    title="Spotlight and scroll to element on active page"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>SPOTLIGHT #{msg.targetElementId}</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await clearTabBadges();
                    }}
                    className="px-2 py-1 rounded-[2px] btn-graphite text-[10px] flex items-center gap-1"
                    title="Remove numbered badges from page"
                  >
                    <span>CLEAR</span>
                  </button>
                </div>
              )}
            </div>

            <span className="text-[9px] text-[#737C8A] mt-1 px-1 font-mono">
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        {/* Real-Time Streaming Message */}
        {isStreaming && (
          <div className="flex flex-col items-start animate-fade-in">
            <div className="max-w-[90%] rounded-[2px] p-2.5 text-xs leading-relaxed bg-[#181B1F] border border-[#D4FF00]/40 text-[#E0E3E8] shadow-sm font-sans">
              <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-[#2A303A] text-[10px] font-mono">
                <div className="flex items-center gap-1.5">
                  <Bot className="w-3 h-3 text-[#D4FF00] animate-pulse" />
                  <span className="text-[#FFFFFF] font-semibold">STREAMING INFERENCE...</span>
                </div>
                <span className="w-1.5 h-1.5 rounded-[0.5px] bg-[#D4FF00] animate-ping" />
              </div>

              <div className="whitespace-pre-wrap break-words leading-relaxed text-[#E0E3E8]">
                {streamingDelta || 'Generating answer...'}
                <span className="inline-block w-1.5 h-3 ml-1 bg-[#D4FF00] animate-pulse align-middle" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Video Seek Feedback Pill */}
      {videoSeekNotice && (
        <div className="px-3 py-1 bg-[#121417] border-t border-[#2A303A] text-[#D4FF00] text-[10px] font-mono flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-1.5">
            <Play className="w-2.5 h-2.5 fill-current text-[#D4FF00]" />
            <span>{videoSeekNotice}</span>
          </div>
          <button
            onClick={() => setVideoSeekNotice(null)}
            className="text-[#737C8A] hover:text-[#FFFFFF] text-xs px-1"
          >
            ×
          </button>
        </div>
      )}

      {/* Industrial Search & Input Console */}
      <div className="p-2.5 bg-[#121417] border-t border-[#2A303A] sticky bottom-0 z-10 space-y-1.5">
        {/* Quick Instrument Toolbar */}
        <div className="flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center gap-1.5">
            <LanguageToggle
              value={settings.language}
              onChange={(newLang) => onLanguageChange?.(newLang)}
              size="xs"
              showIcon={false}
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setInputText('Where do I find the submit button?');
                textareaRef.current?.focus();
              }}
              className="text-[10px] text-[#9DA5B2] hover:text-[#FFFFFF] px-2 py-0.5 rounded-[2px] bg-[#181B1F] hover:bg-[#20242A] border border-[#2A303A] flex items-center gap-1 transition-colors"
              title="Locate buttons, forms, or inputs on page"
            >
              <Crosshair className="w-2.5 h-2.5 text-[#D4FF00]" />
              <span>LOCATE</span>
            </button>

            <button
              type="button"
              onClick={() => setIsVisionModalOpen(true)}
              className="text-[10px] text-[#9DA5B2] hover:text-[#FFFFFF] px-2 py-0.5 rounded-[2px] bg-[#181B1F] hover:bg-[#20242A] border border-[#2A303A] flex items-center gap-1 transition-colors"
              title="Capture screen & inspect charts, tables, or errors"
            >
              <Camera className="w-2.5 h-2.5 text-[#D4FF00]" />
              <span>CAPTURE</span>
            </button>
          </div>
        </div>

        {/* Engineered Input Console */}
        <div className="bg-[#15181C] rounded-[2px] border border-[#2A303A] p-2 focus-within:border-[#D4FF00] focus-within:ring-1 focus-within:ring-[#D4FF00]/30 transition-all flex flex-col gap-1.5 shadow-well-inset">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              pageContext
                ? `Query "${(pageContext.title || 'this page').substring(0, 32)}..."`
                : 'Inquire about active webpage DOM...'
            }
            disabled={isStreaming}
            className="w-full bg-transparent text-xs text-[#E0E3E8] placeholder-[#505967] resize-none outline-none p-0.5 max-h-28 disabled:opacity-40 font-sans leading-relaxed"
          />

          <div className="flex items-center justify-between pt-1 border-t border-[#20242A]">
            <span className="text-[9px] text-[#737C8A] font-mono">
              [ENTER] send • [SHIFT+ENTER] line
            </span>

            {isStreaming ? (
              <button
                type="button"
                onClick={handleStopStreaming}
                className="py-1 px-2.5 rounded-[2px] bg-[#20242A] hover:bg-[#292E36] text-[#FFFFFF] text-[10px] font-mono font-semibold flex items-center gap-1 transition-colors border border-[#343B45]"
                title="Halt inference"
              >
                <Square className="w-2.5 h-2.5 fill-white" />
                <span>HALT</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
                className="p-1.5 rounded-[2px] btn-lime disabled:bg-[#20242A] disabled:text-[#505967] disabled:border-[#2A303A] disabled:shadow-none disabled:cursor-not-allowed transition-all"
                title="Send query"
                aria-label="Send"
              >
                <Send className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Visual Screen Understanding Modal */}
      <ScreenshotModal
        isOpen={isVisionModalOpen}
        onClose={() => setIsVisionModalOpen(false)}
        settings={settings}
        onLanguageChange={onLanguageChange}
        onOpenSettings={onOpenSettings}
        onAskInChat={handleVisionDiscussInChat}
      />
    </div>
  );
}
