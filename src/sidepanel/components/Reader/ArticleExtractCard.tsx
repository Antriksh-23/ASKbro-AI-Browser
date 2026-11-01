import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  FileText,
  Clock,
  User,
  Globe,
  Copy,
  Check,
  RotateCw,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Layers,
  CheckCircle2,
  Play,
  Tv,
} from 'lucide-react';
import { PageContentResponse } from '../../../types/messages';
import {
  requestTabContentExtraction,
  getActiveTab,
  isRestrictedUrl,
  seekActiveTabVideo,
} from '../../../services/reader';

interface ArticleExtractCardProps {
  onContentExtracted?: (content: PageContentResponse) => void;
  onSummarizeRequested?: (content: PageContentResponse) => void;
}

export default function ArticleExtractCard({
  onContentExtracted,
  onSummarizeRequested,
}: ArticleExtractCardProps) {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<PageContentResponse | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [activeTabInfo, setActiveTabInfo] = useState<{ url: string; title: string } | null>(null);
  const [seekStatus, setSeekStatus] = useState<string | null>(null);

  // Synchronize with active tab and clear stale extracted content when URL changes
  useEffect(() => {
    let currentUrl = '';

    const handleTabChange = async () => {
      try {
        const tab = await getActiveTab();
        if (tab?.url) {
          if (currentUrl && currentUrl !== tab.url) {
            setExtractedData(null);
            setError(null);
          }
          currentUrl = tab.url;
          setActiveTabInfo({ url: tab.url, title: tab.title || '' });
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

  const handleExtract = async (forceFallback = false) => {
    setLoading(true);
    setError(null);

    try {
      const tab = await getActiveTab();
      if (tab) {
        setActiveTabInfo({ url: tab.url || '', title: tab.title || '' });
        if (isRestrictedUrl(tab.url)) {
          throw new Error(
            'Chrome restricts extensions from reading browser internal pages (chrome://, chrome-extension://, or settings). Please switch to an article, news site, or blog page.'
          );
        }
      }

      const response = await requestTabContentExtraction(tab?.id, { forceFallback });

      if (!response.success && response.error) {
        throw new Error(response.error);
      }

      setExtractedData(response);
      if (onContentExtracted) {
        onContentExtracted(response);
      }
    } catch (err: any) {
      console.error('[ArticleExtractCard] Extraction error:', err);
      setError(err?.message || 'Failed to extract content from active page.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!extractedData?.textContent) return;
    try {
      await navigator.clipboard.writeText(extractedData.textContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <div className="rounded-[2px] bg-[#181B1F] border border-[#2A303A] p-3.5 space-y-3 shadow-sm animate-fade-in font-sans">
      {/* Header */}
      <div className="flex items-start justify-between font-mono">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-[2px] bg-[#121417] border border-[#2A303A] text-[#D4FF00]">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">
              Article &amp; DOM Extractor
            </h2>
          </div>
          <p className="text-[10px] text-[#737C8A] font-sans">
            Extracts clean text body, reading time, author, and metadata from the active tab.
          </p>
        </div>

        {extractedData && (
          <span
            className={`px-2 py-0.5 rounded-[2px] text-[9px] font-mono font-bold uppercase tracking-wider border ${
              extractedData.extractedWith === 'readability'
                ? 'bg-[#121417] text-[#D4FF00] border-[#D4FF00]/40'
                : extractedData.extractedWith === 'youtube'
                ? 'bg-[#121417] text-[#E0E3E8] border-[#343B45]'
                : 'bg-[#2A1E0B] text-[#F59E0B] border-[#F59E0B]/40'
            }`}
          >
            {extractedData.extractedWith === 'readability'
              ? 'Readability'
              : extractedData.extractedWith === 'youtube'
              ? 'YouTube'
              : 'DOM Fallback'}
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-1.5 font-mono">
        <button
          type="button"
          onClick={() => handleExtract(false)}
          disabled={loading}
          className="flex-1 min-w-[130px] py-1.5 px-3 rounded-[2px] btn-lime text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-40"
        >
          {loading ? (
            <>
              <RotateCw className="w-3 h-3 animate-spin" />
              <span>Reading Page...</span>
            </>
          ) : (
            <>
              <FileText className="w-3 h-3" />
              <span>Read Active Page</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleExtract(true)}
          disabled={loading}
          className="py-1.5 px-2.5 rounded-[2px] btn-graphite text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
          title="Force test DOM fallback parser"
        >
          <Layers className="w-3 h-3 text-[#F59E0B]" />
          <span>Fallback</span>
        </button>

        {extractedData && (
          <button
            type="button"
            onClick={() => {
              setExtractedData(null);
              setError(null);
            }}
            className="p-1.5 rounded-[2px] btn-graphite"
            title="Clear results"
          >
            <RotateCw className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Error Callout */}
      {error && (
        <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs space-y-1 animate-fade-in font-sans">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[#FFFFFF] font-mono uppercase">Extraction Notice</p>
              <p className="text-[11px] text-[#C2C7D0] leading-relaxed">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Extracted Content Display */}
      {extractedData && (
        <div className="space-y-2.5 pt-2 border-t border-[#2A303A] animate-fade-in font-sans">
          {/* Article Header Info */}
          <div className="space-y-1 bg-[#121417] p-2.5 rounded-[2px] border border-[#22262E]">
            <h3 className="text-xs font-semibold text-[#FFFFFF] leading-snug line-clamp-2">
              {extractedData.title || 'Untitled Article'}
            </h3>

            {/* Metadata Chips Bar */}
            <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[10px] font-mono text-[#9DA5B2]">
              <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] border border-[#2A303A]">
                <Clock className="w-2.5 h-2.5 text-[#D4FF00]" />
                <span>
                  {extractedData.readingTimeMinutes}{' '}
                  {extractedData.readingTimeMinutes === 1 ? 'min read' : 'mins read'}
                </span>
              </div>

              <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] border border-[#2A303A]">
                <span>{extractedData.wordCount.toLocaleString()} words</span>
              </div>

              {extractedData.author && (
                <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] border border-[#2A303A]">
                  <User className="w-2.5 h-2.5 text-[#737C8A]" />
                  <span className="truncate max-w-[120px]">{extractedData.author}</span>
                </div>
              )}

              {extractedData.siteName && (
                <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] border border-[#2A303A]">
                  <Globe className="w-2.5 h-2.5 text-[#737C8A]" />
                  <span>{extractedData.siteName}</span>
                </div>
              )}

              {extractedData.videoDetails?.durationFormatted && (
                <div className="flex items-center gap-1 px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] text-[#D4FF00] border border-[#D4FF00]/40">
                  <Tv className="w-2.5 h-2.5 text-[#D4FF00]" />
                  <span>{extractedData.videoDetails.durationFormatted}</span>
                </div>
              )}
            </div>
          </div>

          {/* YouTube Seeking Toast */}
          {seekStatus && (
            <div className="p-1.5 rounded-[2px] bg-[#121417] border border-[#D4FF00]/40 text-[10px] font-mono text-[#D4FF00] flex items-center justify-between animate-fade-in">
              <span>{seekStatus}</span>
              <button
                type="button"
                onClick={() => setSeekStatus(null)}
                className="text-[#737C8A] hover:text-[#FFFFFF] text-xs px-1"
              >
                ×
              </button>
            </div>
          )}

          {/* YouTube Creator Chapters List if available */}
          {extractedData.videoDetails?.chapters && extractedData.videoDetails.chapters.length > 0 && (
            <div className="p-2.5 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-1.5 font-sans">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#9DA5B2]">
                <span className="font-bold text-[#D4FF00] flex items-center gap-1">
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>CHAPTERS ({extractedData.videoDetails.chapters.length})</span>
                </span>
                <span className="text-[9px] text-[#737C8A]">Click to seek video</span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-mono">
                {extractedData.videoDetails.chapters.map((ch, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-1.5 rounded-[2px] bg-[#121417] border border-[#22262E] text-[10px]"
                  >
                    <span className="text-[#FFFFFF] truncate mr-2 font-sans">{ch.title}</span>
                    <button
                      type="button"
                      onClick={() => handleSeek(ch.time, ch.timestampStr)}
                      className="px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] hover:bg-[#20242A] text-[#D4FF00] font-bold border border-[#343B45] shrink-0 transition-colors"
                      title={`Jump to ${ch.timestampStr}`}
                    >
                      {ch.timestampStr}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* YouTube Transcript Status Pill if present */}
          {extractedData.videoDetails?.transcript && (
            <div className="p-2 rounded-[2px] bg-[#121812] border border-[#D4FF00]/40 flex items-center justify-between text-xs text-[#D4FF00] font-mono">
              <span className="flex items-center gap-1.5 text-[10px]">
                <CheckCircle2 className="w-3 h-3 text-[#D4FF00]" />
                <span>TRANSCRIPT AVAILABLE ({extractedData.videoDetails.transcriptSegmentsCount || 'Extracted'} lines)</span>
              </span>
            </div>
          )}

          {/* Excerpt if present */}
          {extractedData.excerpt && (
            <div className="p-2.5 rounded-[2px] bg-[#121417] border border-[#22262E] text-xs text-[#C2C7D0] leading-relaxed">
              &ldquo;{extractedData.excerpt}&rdquo;
            </div>
          )}

          {/* Clean Text Content Preview */}
          <div className="space-y-1 font-mono">
            <div className="flex items-center justify-between text-[10px] text-[#737C8A] px-0.5">
              <span>CLEAN BODY ({extractedData.length.toLocaleString()} chars)</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-[#9DA5B2] hover:text-[#FFFFFF] transition-colors"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-2.5 h-2.5 text-[#D4FF00]" />
                      <span className="text-[#D4FF00]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-2.5 h-2.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-0.5 text-[#D4FF00] hover:underline transition-colors"
                >
                  <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
                  {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                </button>
              </div>
            </div>

            <div
              className={`p-2.5 rounded-[2px] bg-[#121417] border border-[#22262E] font-mono text-[11px] text-[#E0E3E8] leading-relaxed overflow-y-auto whitespace-pre-wrap shadow-well-inset ${
                isExpanded ? 'max-h-72' : 'max-h-28'
              }`}
            >
              {extractedData.textContent || '(No readable body text extracted from this page)'}
            </div>
          </div>

          {/* Summary Trigger Button */}
          {onSummarizeRequested && (
            <button
              type="button"
              onClick={() => onSummarizeRequested(extractedData)}
              className="w-full py-2 px-3 rounded-[2px] btn-lime text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm font-mono"
            >
              <Sparkles className="w-3 h-3" />
              <span>Generate Structured Summary</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
