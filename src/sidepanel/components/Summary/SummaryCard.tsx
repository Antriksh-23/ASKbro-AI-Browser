import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Copy,
  Check,
  RotateCw,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Code2,
  LayoutTemplate,
  Square,
  Clock,
  BookOpen,
  KeyRound,
  ExternalLink,
  Play,
  Tv,
} from 'lucide-react';
import { AISettings, OutputLanguage, StructuredSummaryOutput } from '../../../types/ai';
import { PageContentResponse } from '../../../types/messages';
import {
  requestTabContentExtraction,
  getActiveTab,
  isRestrictedUrl,
  seekActiveTabVideo,
} from '../../../services/reader';
import { generateStructuredSummary, GeminiError } from '../../../services/ai/gemini';
import { QuotaExceededError } from '../../../services/ai/rateLimiter';
import { splitTakeawayLeadIn } from '../../../services/ai/promptBuilder';
import LanguageToggle from '../Common/LanguageToggle';
import RateLimitBanner from '../Common/RateLimitBanner';

interface SummaryCardProps {
  /** Optional extracted article content passed from reader */
  article?: PageContentResponse | null;
  /** Extension AI settings */
  settings: AISettings;
  /** Navigation callback to open Settings view */
  onOpenSettings?: () => void;
  /** Callback when user changes preferred language */
  onLanguageChange?: (language: OutputLanguage) => void;
}

export default function SummaryCard({
  article,
  settings,
  onOpenSettings,
  onLanguageChange,
}: SummaryCardProps) {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<string>('');
  const [summaryOutput, setSummaryOutput] = useState<StructuredSummaryOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);
  const [isAuthError, setIsAuthError] = useState<boolean>(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number>(30);
  const [activeLanguage, setActiveLanguage] = useState<OutputLanguage>(settings.language || 'en');
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [activeTabMeta, setActiveTabMeta] = useState<{ title: string; url: string } | null>(null);
  const [seekStatus, setSeekStatus] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSeek = async (seconds: number, timestampStr: string) => {
    try {
      setSeekStatus(`Seeking video to ${timestampStr}...`);
      const res = await seekActiveTabVideo(seconds);
      if (res.success) {
        setSeekStatus(`Jumped to ${timestampStr}!`);
        setTimeout(() => setSeekStatus(null), 3000);
      } else {
        setSeekStatus(res.error || `Could not seek video.`);
      }
    } catch (err: any) {
      setSeekStatus(`Seek error: ${err?.message || err}`);
    }
  };

  // Sync active language if parent settings change
  useEffect(() => {
    if (settings.language && settings.language !== activeLanguage && !summaryOutput) {
      setActiveLanguage(settings.language);
    }
  }, [settings.language]);

  // Clean up any in-flight request on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Synchronize with active tab and clear stale summary when the tab or URL changes
  useEffect(() => {
    let currentUrl = '';

    const handleTabChange = async () => {
      try {
        const tab = await getActiveTab();
        if (tab?.url) {
          if (currentUrl && currentUrl !== tab.url) {
            setSummaryOutput(null);
            setError(null);
            setStreamingText('');
          }
          currentUrl = tab.url;
          setActiveTabMeta({ title: tab.title || '', url: tab.url });
        }
      } catch {
        // ignore
      }
    };

    handleTabChange();

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.onActivated?.addListener(handleTabChange);
      chrome.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
        if (changeInfo.url) {
          handleTabChange();
        }
      });
    }

    const handleRuntimeMsg = (msg: any) => {
      if (msg?.type === 'YOUTUBE_NAVIGATED') {
        handleTabChange();
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleRuntimeMsg);
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.onActivated?.removeListener(handleTabChange);
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMsg);
      }
    };
  }, []);

  const hasApiKey = Boolean(
    (settings.geminiApiKey && settings.geminiApiKey.trim().length >= 10) ||
    (settings.groqApiKey && settings.groqApiKey.trim().length >= 10)
  );

  /**
   * Primary summarization trigger:
   * Extracts content fresh from active tab DOM, ensuring no stale context is used
   */
  const handleSummarize = async (overrideLang?: OutputLanguage) => {
    const langToUse = overrideLang || activeLanguage;

    if (!hasApiKey) {
      setError('Please configure your Gemini or Groq API key in Settings first.');
      setIsAuthError(true);
      return;
    }

    setIsGenerating(true);
    setError(null);
    setIsRateLimited(false);
    setIsAuthError(false);
    setStreamingText('');
    setSeekStatus(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let contentToSummarize: PageContentResponse | null = null;

      const tab = await getActiveTab();
      if (tab?.url && isRestrictedUrl(tab.url)) {
        throw new Error(
          'Chrome restricts extensions from accessing internal browser pages (chrome://, chrome-extension://, or settings).'
        );
      }

      if (article && tab?.url && article.url === tab.url && article.textContent) {
        contentToSummarize = article;
      } else {
        const extracted = await requestTabContentExtraction(tab?.id);
        if (!extracted.success && extracted.error) {
          throw new Error(extracted.error);
        }
        contentToSummarize = extracted;
      }

      if (!contentToSummarize || !contentToSummarize.textContent || contentToSummarize.textContent.trim().length < 40) {
        throw new Error(
          'Insufficient readable body content found on this page. Try opening an article, news piece, or blog post.'
        );
      }

      const isYouTube = Boolean(contentToSummarize.isYouTube);

      const result = await generateStructuredSummary({
        content: contentToSummarize.textContent,
        title: contentToSummarize.title,
        url: contentToSummarize.url,
        language: langToUse,
        apiKey: settings.geminiApiKey,
        groqApiKey: settings.groqApiKey,
        model: settings.model,
        signal: controller.signal,
        isYouTube,
        onChunk: (_delta, accumulated) => {
          setStreamingText(accumulated);
        },
      });

      setSummaryOutput(result);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Generation paused by user.');
        return;
      }

      console.error('[SummaryCard] Summarization error:', err);

      if (err instanceof QuotaExceededError || (err instanceof GeminiError && err.isRateLimit)) {
        setIsRateLimited(true);
        setRetryAfterSeconds((err as any).retryAfterSeconds || 30);
        setError((err as any).bannerMessage || (err as any).message || 'Daily free-tier quota reached.');
      } else if (err instanceof GeminiError) {
        setError(err.message);
        if (err.isAuthError) setIsAuthError(true);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  const handleCopyMarkdown = async () => {
    if (!summaryOutput) return;
    try {
      await navigator.clipboard.writeText(summaryOutput.markdown);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy summary markdown:', err);
    }
  };

  const handleLanguageToggle = (newLang: OutputLanguage) => {
    setActiveLanguage(newLang);
    if (onLanguageChange) {
      onLanguageChange(newLang);
    }
    if (summaryOutput && !isGenerating) {
      handleSummarize(newLang);
    }
  };

  const isArticleMatchingTab = Boolean(
    article && activeTabMeta?.url && article.url === activeTabMeta.url
  );
  const currentTitle = isArticleMatchingTab ? article?.title : activeTabMeta?.title;
  const currentReadTime = isArticleMatchingTab ? article?.readingTimeMinutes : undefined;
  const currentWords = isArticleMatchingTab ? article?.wordCount : undefined;

  return (
    <div className="rounded-[2px] bg-[#181B1F] border border-[#2A303A] p-3.5 space-y-3 shadow-sm animate-fade-in font-sans">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-[#2A303A] pb-2.5 font-mono">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-[2px] bg-[#121417] border border-[#2A303A] text-[#D4FF00]">
            <BookOpen className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">
              Structured Summary
            </h2>
            <p className="text-[9px] text-[#737C8A]">
              Overview • Key Takeaways • Action Items
            </p>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-1.5">
          <LanguageToggle
            value={activeLanguage}
            onChange={handleLanguageToggle}
            disabled={isGenerating}
            size="xs"
            showIcon={false}
          />

          {summaryOutput && (
            <div className="flex items-center rounded-[2px] bg-[#121417] border border-[#2A303A] p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setViewMode('formatted')}
                className={`p-1 rounded-[1px] transition-colors ${
                  viewMode === 'formatted'
                    ? 'bg-[#20242A] text-[#D4FF00] shadow-sm font-bold'
                    : 'text-[#737C8A] hover:text-[#FFFFFF]'
                }`}
                title="Structured Cards"
              >
                <LayoutTemplate className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('raw')}
                className={`p-1 rounded-[1px] transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-[#20242A] text-[#D4FF00] shadow-sm font-bold'
                    : 'text-[#737C8A] hover:text-[#FFFFFF]'
                }`}
                title="Raw Markdown"
              >
                <Code2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Source Article Metadata Banner */}
      {currentTitle && (
        <div className="flex items-center justify-between gap-2 p-2 rounded-[2px] bg-[#121417] border border-[#22262E] text-[10px] text-[#9DA5B2] font-mono">
          <div className="flex items-center gap-2 truncate">
            {article?.isYouTube ? (
              <Tv className="w-3 h-3 text-[#D4FF00] shrink-0" />
            ) : (
              <FileText className="w-3 h-3 text-[#737C8A] shrink-0" />
            )}
            <span className="truncate font-sans font-medium text-[#E0E3E8]">{currentTitle}</span>
          </div>

          <div className="flex items-center gap-1.5 text-[#737C8A] shrink-0">
            {article?.isYouTube && (
              <span className="px-1 py-0.2 rounded-[2px] bg-[#181B1F] text-[#D4FF00] font-bold border border-[#D4FF00]/40">
                YouTube
              </span>
            )}
            {currentReadTime && (
              <span className="flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {currentReadTime}m
              </span>
            )}
            {currentWords && <span>{currentWords.toLocaleString()} words</span>}
          </div>
        </div>
      )}

      {/* Main Trigger & Control Buttons */}
      <div className="flex items-center gap-2 font-mono">
        {!isGenerating ? (
          <button
            type="button"
            onClick={() => handleSummarize()}
            className="flex-1 py-1.5 px-3 rounded-[2px] btn-lime text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>
              {summaryOutput
                ? `Re-Summarize (${activeLanguage.toUpperCase()})`
                : article?.isYouTube
                ? `Summarize YouTube Video (${activeLanguage.toUpperCase()})`
                : article?.textContent
                ? `Summarize Extracted Article (${activeLanguage.toUpperCase()})`
                : `Summarize Page (${activeLanguage.toUpperCase()})`}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 py-1.5 px-3 rounded-[2px] btn-graphite text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Stop Generating</span>
          </button>
        )}

        {summaryOutput && !isGenerating && (
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="py-1.5 px-3 rounded-[2px] btn-graphite text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Copy structured summary as Markdown"
          >
            {isCopied ? (
              <>
                <Check className="w-3 h-3 text-[#D4FF00]" />
                <span className="text-[#D4FF00]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-[#9DA5B2]" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* In-Flight Streaming Progress Indicator */}
      {isGenerating && (
        <div className="space-y-1.5 p-2.5 rounded-[2px] bg-[#121417] border border-[#2A303A] font-mono">
          <div className="flex items-center justify-between text-xs text-[#9DA5B2] font-medium">
            <span className="flex items-center gap-1.5 text-[#D4FF00]">
              <RotateCw className="w-3 h-3 animate-spin" />
              <span>Analyzing page content...</span>
            </span>
            <span className="text-[9px] uppercase px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] text-[#FFFFFF] border border-[#2A303A]">
              {activeLanguage} mode
            </span>
          </div>

          {streamingText && (
            <div className="p-2 rounded-[2px] bg-[#181B1F] border border-[#22262E] text-[11px] text-[#E0E3E8] font-mono max-h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {streamingText}
            </div>
          )}
        </div>
      )}

      {/* Error Callout */}
      {error && !isGenerating && (
        isRateLimited ? (
          <RateLimitBanner
            initialSeconds={retryAfterSeconds}
            message={error}
            onOpenSettings={onOpenSettings}
            onRetry={() => handleSummarize(activeLanguage)}
            onDismiss={() => {
              setError(null);
              setIsRateLimited(false);
            }}
          />
        ) : (
          <div className="p-3 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs space-y-1.5 animate-fade-in font-sans">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-[#FFFFFF] font-mono">
                  {isAuthError ? 'Authentication Required' : 'Summarization Notice'}
                </p>
                <p className="text-[11px] text-[#C2C7D0] leading-relaxed">{error}</p>
              </div>
            </div>

            {isAuthError && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="py-1 px-2.5 rounded-[2px] btn-lime text-xs font-semibold font-mono flex items-center gap-1.5 shadow-sm"
              >
                <KeyRound className="w-3 h-3" />
                <span>Configure Gemini API Key</span>
              </button>
            )}

            {error.includes('internal pages') && (
              <div className="pt-1.5 border-t border-[#F59E0B]/30 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                <span className="text-[#737C8A]">Quick Test:</span>
                <a
                  href="https://en.wikipedia.org/wiki/Artificial_intelligence"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#D4FF00] hover:underline inline-flex items-center gap-0.5"
                >
                  <span>Wikipedia AI</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            )}
          </div>
        )
      )}

      {/* Structured Summary Output Display */}
      {summaryOutput && !isGenerating && (
        <div className="space-y-2.5 pt-1 animate-fade-in font-sans">
          {viewMode === 'raw' ? (
            <div className="space-y-1.5 font-mono">
              <div className="flex items-center justify-between text-[10px] text-[#737C8A]">
                <span>CANONICAL MARKDOWN:</span>
                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  className="text-[#D4FF00] hover:underline text-[10px] flex items-center gap-1"
                >
                  {isCopied ? 'Copied!' : 'Copy raw markdown'}
                </button>
              </div>
              <pre className="p-2.5 rounded-[2px] bg-[#121417] border border-[#2A303A] font-mono text-[11px] text-[#E0E3E8] whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed shadow-well-inset">
                {summaryOutput.markdown}
              </pre>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* 1. TL;DR Section */}
              <div className="p-3 rounded-[2px] bg-[#121417] border border-[#2A303A] space-y-1 shadow-well-inset font-sans">
                <div className="flex items-center gap-1.5 text-[#D4FF00]">
                  <FileText className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-[#D4FF00]">
                    1. TL;DR (Overview)
                  </span>
                </div>
                <p className="text-xs text-[#E0E3E8] leading-relaxed pl-0.5">
                  &ldquo;{summaryOutput.summary.tldr}&rdquo;
                </p>
              </div>

              {/* 2. 5 Key Takeaways Section */}
              <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2 shadow-sm font-sans">
                <div className="flex items-center justify-between border-b border-[#2A303A] pb-1.5 font-mono">
                  <div className="flex items-center gap-1.5 text-[#FFFFFF]">
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      2. 5 Key Takeaways
                    </span>
                  </div>
                  <span className="text-[9px] text-[#9DA5B2] bg-[#121417] border border-[#2A303A] px-1.5 py-0.2 rounded-[2px]">
                    {summaryOutput.summary.keyTakeaways.length} POINTS
                  </span>
                </div>

                <div className="space-y-1.5">
                  {summaryOutput.summary.keyTakeaways.map((item, idx) => {
                    const { leadIn, body } = splitTakeawayLeadIn(item);
                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-2 text-xs text-[#C2C7D0] p-2 rounded-[2px] bg-[#121417] border border-[#22262E]"
                      >
                        <span className="w-4 h-4 rounded-[1px] bg-[#181B1F] border border-[#2A303A] text-[#D4FF00] text-[9px] font-bold font-mono flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>

                        <div className="leading-relaxed">
                          {leadIn ? (
                            <>
                              <strong className="text-[#FFFFFF] font-semibold">{leadIn}</strong>
                              <span className="text-[#505967] mx-1">•</span>
                              <span className="text-[#E0E3E8]">{body}</span>
                            </>
                          ) : (
                            <span className="text-[#E0E3E8]">{body}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. YouTube Chapters & Key Moments */}
              {summaryOutput.summary.chapters && summaryOutput.summary.chapters.length > 0 && (
                <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2 shadow-sm font-sans">
                  <div className="flex items-center justify-between border-b border-[#2A303A] pb-1.5 font-mono">
                    <div className="flex items-center gap-1.5 text-[#D4FF00]">
                      <Play className="w-3 h-3 fill-current text-[#D4FF00]" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        3. Key Moments & Chapters
                      </span>
                    </div>
                    <span className="text-[9px] text-[#D4FF00] bg-[#121417] border border-[#D4FF00]/40 px-1.5 py-0.2 rounded-[2px]">
                      {summaryOutput.summary.chapters.length} MOMENTS
                    </span>
                  </div>

                  {seekStatus && (
                    <div className="p-1.5 rounded-[2px] bg-[#121417] border border-[#D4FF00]/40 text-[10px] font-mono text-[#D4FF00] flex items-center justify-between animate-fade-in">
                      <span>{seekStatus}</span>
                      <button
                        type="button"
                        onClick={() => setSeekStatus(null)}
                        className="text-[#737C8A] hover:text-[#FFFFFF] text-xs"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  <div className="space-y-1">
                    {summaryOutput.summary.chapters.map((ch, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 text-xs text-[#C2C7D0] p-1.5 rounded-[2px] bg-[#121417] border border-[#22262E] hover:border-[#343B45] transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => handleSeek(ch.seconds, ch.timestamp)}
                          className="flex items-center gap-1 px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] hover:bg-[#20242A] text-[#D4FF00] border border-[#343B45] font-mono text-[9px] font-semibold transition-all shrink-0 mt-0.5"
                          title={`Click to jump to ${ch.timestamp} in YouTube video`}
                        >
                          <Play className="w-2 h-2 fill-current text-[#D4FF00]" />
                          <span>{ch.timestamp}</span>
                        </button>

                        <div className="leading-relaxed">
                          <strong className="text-[#FFFFFF] font-medium">{ch.title}</strong>
                          {ch.note && (
                            <>
                              <span className="text-[#505967] mx-1">•</span>
                              <span className="text-[#9DA5B2]">{ch.note}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actionable Next Steps Section */}
              <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2 shadow-sm font-sans">
                <div className="flex items-center justify-between border-b border-[#2A303A] pb-1.5 font-mono">
                  <div className="flex items-center gap-1.5 text-[#D4FF00]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#D4FF00]" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#FFFFFF]">
                      {summaryOutput.summary.chapters?.length ? '4. What To Do Next' : '3. What To Do Next'}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-[#D4FF00] bg-[#121417] border border-[#D4FF00]/40 px-1.5 py-0.2 rounded-[2px]">
                    ACTIONABLE
                  </span>
                </div>

                <div className="space-y-1">
                  {summaryOutput.summary.actionableSteps.map((step, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs text-[#E0E3E8] p-1.5 rounded-[2px] bg-[#121417] border border-[#22262E] leading-relaxed"
                    >
                      <ArrowRight className="w-3 h-3 text-[#D4FF00] shrink-0 mt-0.5" />
                      <span>{step.replace(/^[-*•]\s*/, '')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
