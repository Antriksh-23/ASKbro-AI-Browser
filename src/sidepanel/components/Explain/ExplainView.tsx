import React, { useState, useEffect, useRef } from 'react';
import {
  Lightbulb,
  Languages,
  MessageSquareReply,
  Copy,
  Check,
  RotateCcw,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertCircle,
  KeyRound,
  ArrowRight,
  SlidersHorizontal,
  StopCircle,
  MessageSquare,
  Globe,
  MousePointerClick,
  History,
  FileText,
  CornerDownRight,
} from 'lucide-react';
import { AISettings, OutputLanguage, ReplyTone, ExplainStyle } from '../../../types/ai';
import { ContextActionType, ContextMenuActionPayload } from '../../../types/messages';
import { streamContextMenuAction } from '../../../services/ai/contextMenuActions';
import { getActiveTab } from '../../../services/reader';
import LanguageToggle from '../Common/LanguageToggle';
import RateLimitBanner from '../Common/RateLimitBanner';

export interface ExplainViewProps {
  settings: AISettings;
  currentAction: ContextMenuActionPayload | null;
  onOpenSettings: () => void;
  onLanguageChange?: (lang: OutputLanguage) => void;
  onAskInChat?: (query: string) => void;
  onClearAction?: () => void;
}

interface RecentExplanation {
  id: string;
  action: ContextActionType;
  selectedText: string;
  output: string;
  language: OutputLanguage;
  pageTitle?: string;
  timestamp: number;
}

const ACTION_CONFIGS: Record<
  ContextActionType,
  {
    label: string;
    shortLabel: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
  }
> = {
  explain: {
    label: 'Explain Highlighted Text',
    shortLabel: 'Explain',
    description: 'Simplifies jargon, technical concepts & dense text',
    icon: Lightbulb,
    accentColor: 'amber',
    badgeBg: 'bg-[#1E190E]',
    badgeBorder: 'border-[#F59E0B]/50',
    badgeText: 'text-[#F59E0B]',
  },
  translate: {
    label: 'Translate to Hindi / Hinglish',
    shortLabel: 'Translate',
    description: 'Accurate Devanagari Hindi & colloquial Roman Hinglish',
    icon: Languages,
    accentColor: 'lime',
    badgeBg: 'bg-[#181F0E]',
    badgeBorder: 'border-[#D4FF00]/50',
    badgeText: 'text-[#D4FF00]',
  },
  reply: {
    label: 'Draft a Reply to Selection',
    shortLabel: 'Draft Reply',
    description: 'Professional, direct, or casual ready-to-send replies',
    icon: MessageSquareReply,
    accentColor: 'silver',
    badgeBg: 'bg-[#1A1D23]',
    badgeBorder: 'border-[#444D5B]',
    badgeText: 'text-[#FFFFFF]',
  },
};

const EXPLAIN_STYLES: Array<{ id: ExplainStyle; label: string; desc: string }> = [
  { id: 'detailed', label: 'Detailed', desc: 'Core idea, jargon breakdown & analogy' },
  { id: 'simple', label: 'Simple (ELI5)', desc: 'Ultra-clear plain language & analogy' },
  { id: 'bullet', label: 'Key Bullets', desc: 'Fast, structured key takeaways' },
];

const REPLY_TONES: Array<{ id: ReplyTone; label: string; icon: string }> = [
  { id: 'professional', label: 'Professional', icon: '👔' },
  { id: 'direct', label: 'Direct', icon: '⚡' },
  { id: 'casual', label: 'Casual', icon: '💬' },
];

export default function ExplainView({
  settings,
  currentAction,
  onOpenSettings,
  onLanguageChange,
  onAskInChat,
  onClearAction,
}: ExplainViewProps) {
  const [selectedText, setSelectedText] = useState<string>('');
  const [pageTitle, setPageTitle] = useState<string>('');
  const [pageUrl, setPageUrl] = useState<string>('');
  const [activeAction, setActiveAction] = useState<ContextActionType>('explain');
  const [explainStyle, setExplainStyle] = useState<ExplainStyle>('detailed');
  const [replyTone, setReplyTone] = useState<ReplyTone>('professional');
  const [customLanguage, setCustomLanguage] = useState<OutputLanguage>(settings.language || 'en');
  const [generatedOutput, setGeneratedOutput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitInfo, setRateLimitInfo] = useState<{ seconds: number; message: string } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isSnippetExpanded, setIsSnippetExpanded] = useState<boolean>(false);
  const [isEditingSnippet, setIsEditingSnippet] = useState<boolean>(false);
  const [manualInput, setManualInput] = useState<string>('');
  const [grabNotice, setGrabNotice] = useState<string | null>(null);
  const [isGrabbing, setIsGrabbing] = useState<boolean>(false);
  const [recentExplanations, setRecentExplanations] = useState<RecentExplanation[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCustomLanguage(settings.language || 'en');
  }, [settings.language]);

  // When a new context action arrives from right-click or selection trigger
  useEffect(() => {
    if (currentAction && currentAction.selectedText) {
      setSelectedText(currentAction.selectedText);
      setPageTitle(currentAction.pageTitle || '');
      setPageUrl(currentAction.pageUrl || '');
      setActiveAction(currentAction.action || 'explain');
      setIsEditingSnippet(false);
      setGeneratedOutput('');
      setError(null);
      setGrabNotice(null);

      executeAction(
        currentAction.selectedText,
        currentAction.action || 'explain',
        explainStyle,
        replyTone,
        customLanguage
      );
    }
  }, [currentAction?.id]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const hasGeminiKey = Boolean(settings.geminiApiKey && settings.geminiApiKey.trim().length >= 10);

  const executeAction = async (
    textToProcess: string,
    actionType: ContextActionType,
    style: ExplainStyle = explainStyle,
    tone: ReplyTone = replyTone,
    lang: OutputLanguage = customLanguage
  ) => {
    const trimmed = textToProcess.trim();
    if (!trimmed) {
      setError('Please provide or highlight text to explain.');
      return;
    }

    if (!hasGeminiKey) {
      setError('Gemini API key is required. Please configure your key in Settings.');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setIsStreaming(true);
    setGeneratedOutput('');
    setError(null);
    setRateLimitInfo(null);

    try {
      const responseText = await streamContextMenuAction({
        action: actionType,
        selectedText: trimmed,
        explainStyle: style,
        replyTone: tone,
        language: lang,
        apiKey: settings.geminiApiKey,
        model: settings.model,
        groqApiKey: settings.groqApiKey,
        signal: controller.signal,
        onChunk: (chunk: string) => {
          setGeneratedOutput((prev) => prev + chunk);
        },
      });

      setGeneratedOutput(responseText);

      // Save to recent history
      if (responseText.trim()) {
        const item: RecentExplanation = {
          id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          action: actionType,
          selectedText: trimmed,
          output: responseText,
          language: lang,
          pageTitle,
          timestamp: Date.now(),
        };
        setRecentExplanations((prev) => [item, ...prev.filter((p) => p.selectedText !== trimmed)].slice(0, 5));
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;

      console.error('[ExplainView] Execution error:', err);
      const message = err?.message || 'Failed to complete explain action.';
      if (message.includes('429') || message.toLowerCase().includes('quota')) {
        setRateLimitInfo({
          seconds: 30,
          message: 'Rate limit encountered. Please retry shortly.',
        });
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  /**
   * Directly grabs whatever text is currently highlighted in the active tab
   */
  const handleGrabActiveSelection = async () => {
    setIsGrabbing(true);
    setGrabNotice(null);
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id) {
        setGrabNotice('No active tab available.');
        return;
      }

      if (tab.title) setPageTitle(tab.title);
      if (tab.url) setPageUrl(tab.url);

      chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTED_TEXT' }, (response) => {
        setIsGrabbing(false);
        if (chrome.runtime?.lastError) {
          setGrabNotice('Could not connect to active page. Try refreshing the webpage.');
          return;
        }

        if (response && response.selectedText && response.selectedText.trim()) {
          const grabbed = response.selectedText.trim();
          setSelectedText(grabbed);
          setIsEditingSnippet(false);
          setGrabNotice(null);
          executeAction(grabbed, activeAction, explainStyle, replyTone, customLanguage);
        } else {
          setGrabNotice('No text is currently highlighted on this webpage. Select text with your mouse first!');
          setTimeout(() => setGrabNotice(null), 4000);
        }
      });
    } catch (err) {
      setIsGrabbing(false);
      setGrabNotice('Error querying active tab.');
    }
  };

  const handleActionChange = (newAction: ContextActionType) => {
    setActiveAction(newAction);
    const target = selectedText || manualInput;
    if (target.trim()) {
      executeAction(target, newAction, explainStyle, replyTone, customLanguage);
    }
  };

  const handleStyleChange = (newStyle: ExplainStyle) => {
    if (newStyle === explainStyle) return;
    setExplainStyle(newStyle);
    const target = selectedText || manualInput;
    if (target.trim() && activeAction === 'explain') {
      executeAction(target, 'explain', newStyle, replyTone, customLanguage);
    }
  };

  const handleToneChange = (newTone: ReplyTone) => {
    if (newTone === replyTone) return;
    setReplyTone(newTone);
    const target = selectedText || manualInput;
    if (target.trim() && activeAction === 'reply') {
      executeAction(target, 'reply', explainStyle, newTone, customLanguage);
    }
  };

  const handleLanguageToggle = async (newLang: OutputLanguage) => {
    setCustomLanguage(newLang);
    if (onLanguageChange) {
      onLanguageChange(newLang);
    }
    const target = selectedText || manualInput;
    if (target.trim() && generatedOutput) {
      executeAction(target, activeAction, explainStyle, replyTone, newLang);
    }
  };

  const handleCopy = async () => {
    if (!generatedOutput) return;
    try {
      await navigator.clipboard.writeText(generatedOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    setSelectedText(manualInput.trim());
    setIsEditingSnippet(false);
    executeAction(manualInput.trim(), activeAction, explainStyle, replyTone, customLanguage);
  };

  const handleRestoreHistory = (item: RecentExplanation) => {
    setSelectedText(item.selectedText);
    setGeneratedOutput(item.output);
    setActiveAction(item.action);
    setCustomLanguage(item.language);
    if (item.pageTitle) setPageTitle(item.pageTitle);
    setShowHistory(false);
  };

  const currentConfig = ACTION_CONFIGS[activeAction];
  const ActionIcon = currentConfig.icon;

  const renderFormattedOutput = (rawText: string) => {
    if (!rawText) return null;

    const lines = rawText.split('\n');
    return (
      <div className="space-y-2 text-xs text-[#E0E3E8] leading-relaxed font-sans select-text">
        {lines.map((line, index) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={index} className="h-1" />;
          }

          if (trimmed.startsWith('### ')) {
            return (
              <h3
                key={index}
                className="font-mono font-bold text-xs uppercase tracking-wider text-[#FFFFFF] pt-2 pb-0.5 border-b border-[#2A303A] flex items-center gap-1.5"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#D4FF00]" />
                <span>{trimmed.replace(/^###\s*/, '')}</span>
              </h3>
            );
          }

          if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const bulletContent = trimmed.replace(/^[-*]\s*/, '');
            const match = bulletContent.match(/^\*\*(.*?)\*\*:(.*)$/);
            if (match) {
              return (
                <div key={index} className="flex items-start gap-2 pl-1 font-sans">
                  <span className="text-[#D4FF00] mt-0.5 select-none font-bold font-mono">›</span>
                  <span>
                    <strong className="text-[#FFFFFF] font-semibold">{match[1]}:</strong>
                    <span className="text-[#C4CBD4] ml-1">{match[2]}</span>
                  </span>
                </div>
              );
            }
            return (
              <div key={index} className="flex items-start gap-2 pl-1 font-sans">
                <span className="text-[#D4FF00] mt-0.5 select-none font-bold font-mono">›</span>
                <span className="text-[#C4CBD4]">{bulletContent}</span>
              </div>
            );
          }

          return (
            <p key={index} className="text-[#E0E3E8]">
              {trimmed}
            </p>
          );
        })}
      </div>
    );
  };

  const displayText = selectedText;
  const isTextLong = displayText.length > 180;

  return (
    <div className="flex-1 flex flex-col p-3 gap-3 overflow-y-auto">
      {/* Explain Section Telemetry Header */}
      <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-3 space-y-2.5 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-[2px] ${currentConfig.badgeBg} border ${currentConfig.badgeBorder} flex items-center justify-center ${currentConfig.badgeText}`}
            >
              <ActionIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
                  {currentConfig.label}
                </h2>
                <span className="telemetry-led-lime" title="Comprehension Channel Live" />
              </div>
              <p className="text-[10px] text-[#737C8A] font-mono">{currentConfig.description}</p>
            </div>
          </div>

          {/* Header Controls: Language toggle & Recent History */}
          <div className="flex items-center gap-1.5">
            <LanguageToggle
              value={customLanguage}
              onChange={handleLanguageToggle}
              size="xs"
              showIcon={false}
            />
            {recentExplanations.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className={`p-1 rounded-[2px] text-[10px] font-mono border transition-colors flex items-center gap-1 ${
                  showHistory
                    ? 'bg-[#20242A] text-[#D4FF00] border-[#D4FF00]/50'
                    : 'text-[#9DA5B2] hover:text-[#FFFFFF] bg-[#181B1F] border-[#2A303A]'
                }`}
                title="Recent Explanations History"
              >
                <History className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Action Selector Segmented Channel (Explain / Translate / Reply) */}
        <div className="grid grid-cols-3 gap-1 bg-[#0C0D0E] p-1 rounded-[2px] border border-[#1F242C]">
          {(['explain', 'translate', 'reply'] as ContextActionType[]).map((type) => {
            const cfg = ACTION_CONFIGS[type];
            const Icon = cfg.icon;
            const isActive = activeAction === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => handleActionChange(type)}
                className={`py-1.5 px-2 rounded-[2px] text-[10px] font-mono font-bold uppercase flex items-center justify-center gap-1.5 transition-all ${
                  isActive
                    ? 'bg-[#D4FF00] text-black shadow-sm font-semibold'
                    : 'text-[#9BA3AF] hover:text-[#FFFFFF] hover:bg-[#181B1F]'
                }`}
              >
                <Icon className={`w-3 h-3 ${isActive ? 'text-black' : 'text-[#737C8A]'}`} />
                <span>{cfg.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent History Drawer */}
      {showHistory && recentExplanations.length > 0 && (
        <div className="rounded-[2px] bg-[#15181D] border border-[#343B45] p-2.5 space-y-2 animate-fade-in shadow-md">
          <div className="flex items-center justify-between text-[10px] font-mono font-bold text-[#FFFFFF] uppercase tracking-wider border-b border-[#2A303A] pb-1.5">
            <span className="flex items-center gap-1.5">
              <History className="w-3 h-3 text-[#D4FF00]" />
              <span>Recent Explained Snippets</span>
            </span>
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="text-[#737C8A] hover:text-[#FFFFFF]"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {recentExplanations.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleRestoreHistory(item)}
                className="w-full text-left p-2 rounded-[2px] bg-[#0C0D0E] hover:bg-[#1E222A] border border-[#2A303A] hover:border-[#D4FF00]/40 transition-colors space-y-1 group"
              >
                <div className="flex items-center justify-between text-[9px] font-mono text-[#737C8A]">
                  <span className="text-[#D4FF00] uppercase font-bold">{item.action}</span>
                  <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-[11px] text-[#E0E3E8] font-mono truncate group-hover:text-[#FFFFFF]">
                  "{item.selectedText}"
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Target Webpage & Live Active Tab Grab Bar */}
      <div className="p-2.5 rounded-[2px] bg-[#121417] border border-[#2A303A] flex items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Globe className="w-3.5 h-3.5 text-[#D4FF00] shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#737C8A] block leading-none">
              Active Page Context
            </span>
            <span className="text-[11px] text-[#FFFFFF] font-sans truncate block mt-0.5" title={pageTitle || 'Active tab'}>
              {pageTitle || 'Webpage Target'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGrabActiveSelection}
          disabled={isGrabbing}
          className="py-1 px-2.5 rounded-[2px] btn-lime text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 shrink-0 transition-all shadow-sm disabled:opacity-50"
          title="Pull whatever text is currently highlighted in the browser tab"
        >
          <MousePointerClick className="w-3 h-3" />
          <span>{isGrabbing ? 'Reading...' : 'Grab Selection'}</span>
        </button>
      </div>

      {/* Notice after attempting to grab selection */}
      {grabNotice && (
        <div className="p-2 rounded-[2px] bg-[#1E1B12] border border-[#F59E0B]/50 text-[#F59E0B] text-[10px] font-mono flex items-center gap-1.5 animate-fade-in">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{grabNotice}</span>
        </div>
      )}

      {/* Highlighted Text Snippet Box */}
      {selectedText ? (
        <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-3 space-y-2 relative shadow-sm">
          <div className="flex items-center justify-between text-[10px] text-[#737C8A] font-mono uppercase tracking-wider border-b border-[#2A303A] pb-1.5">
            <span className="flex items-center gap-1 text-[#E0E3E8] font-bold">
              <span className="text-[#D4FF00]">›</span>
              <span>Highlighted Section</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-[#5A6372] font-mono">{displayText.length} chars</span>
              <button
                type="button"
                onClick={() => setIsEditingSnippet(!isEditingSnippet)}
                className="text-[10px] text-[#D4FF00] hover:text-[#BCE600] font-mono font-semibold hover:underline"
              >
                {isEditingSnippet ? 'Cancel' : 'Edit'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedText('');
                  setGeneratedOutput('');
                  if (onClearAction) onClearAction();
                }}
                className="text-[10px] text-[#FF8888] hover:text-[#FFAAAA] font-mono font-semibold hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          {isEditingSnippet ? (
            <div className="space-y-2 pt-1">
              <textarea
                rows={3}
                value={selectedText}
                onChange={(e) => setSelectedText(e.target.value)}
                className="w-full text-xs p-2 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] text-[#FFFFFF] focus:outline-none focus:border-[#D4FF00] resize-none font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  setIsEditingSnippet(false);
                  executeAction(selectedText, activeAction, explainStyle, replyTone, customLanguage);
                }}
                className="py-1 px-3 rounded-[2px] bg-[#D4FF00] hover:bg-[#BCE600] text-black text-[10px] font-mono font-bold uppercase transition-colors shadow-sm"
              >
                Update & Re-Explain
              </button>
            </div>
          ) : (
            <div className="relative">
              <blockquote className="border-l-2 border-[#D4FF00] pl-2.5 py-0.5">
                <p
                  className={`text-xs text-[#E0E3E8] font-mono leading-relaxed select-text ${
                    !isSnippetExpanded && isTextLong ? 'line-clamp-3' : ''
                  }`}
                >
                  "{displayText}"
                </p>
              </blockquote>
              {isTextLong && (
                <button
                  type="button"
                  onClick={() => setIsSnippetExpanded(!isSnippetExpanded)}
                  className="mt-1 text-[10px] text-[#D4FF00] hover:text-[#BCE600] flex items-center gap-0.5 font-mono font-semibold"
                >
                  <span>{isSnippetExpanded ? 'Show less' : 'Show full highlighted text'}</span>
                  {isSnippetExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              )}
            </div>
          )}

          {/* Explanation Style Selector (when in Explain mode) */}
          {activeAction === 'explain' && (
            <div className="pt-2 border-t border-[#1F242C] space-y-1">
              <span className="text-[9px] text-[#737C8A] font-mono uppercase tracking-wider block">
                Explanation Depth:
              </span>
              <div className="grid grid-cols-3 gap-1">
                {EXPLAIN_STYLES.map((st) => {
                  const isSelected = explainStyle === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => handleStyleChange(st.id)}
                      className={`py-1 px-1.5 rounded-[2px] text-[9px] font-mono font-semibold uppercase transition-all ${
                        isSelected
                          ? 'bg-[#1F242C] text-[#D4FF00] border border-[#D4FF00]/60 shadow-sm'
                          : 'bg-[#0C0D0E] text-[#9BA3AF] hover:text-[#FFFFFF] border border-[#2A303A]'
                      }`}
                    >
                      <span>{st.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tone Selector (when in Reply mode) */}
          {activeAction === 'reply' && (
            <div className="pt-2 border-t border-[#1F242C] space-y-1">
              <span className="text-[9px] text-[#737C8A] font-mono uppercase tracking-wider block">
                Draft Tone:
              </span>
              <div className="grid grid-cols-3 gap-1">
                {REPLY_TONES.map((t) => {
                  const isSelected = replyTone === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleToneChange(t.id)}
                      className={`py-1 px-1.5 rounded-[2px] text-[9px] font-mono font-semibold uppercase transition-all flex items-center justify-center gap-1 ${
                        isSelected
                          ? 'bg-[#1F242C] text-[#D4FF00] border border-[#D4FF00]/60 shadow-sm'
                          : 'bg-[#0C0D0E] text-[#9BA3AF] hover:text-[#FFFFFF] border border-[#2A303A]'
                      }`}
                    >
                      <span>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Empty / No Highlight State & Manual Input */
        <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-3 space-y-3 shadow-sm animate-fade-in">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[#D4FF00]">
              <Sparkles className="w-4 h-4" />
              <h3 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
                How to Explain Any Text
              </h3>
            </div>
            <p className="text-xs text-[#9BA3AF] leading-relaxed font-sans">
              1. Highlight any text on the webpage using your mouse.
              <br />
              2. Click the <strong className="text-[#D4FF00] font-semibold">right button of the mouse</strong> and select{' '}
              <strong className="text-[#F59E0B] font-semibold">"Explain this with ASKbro"</strong> (or click the floating 💡 pill).
              <br />
              3. Or click <strong className="text-[#FFFFFF] font-semibold">"Grab Selection"</strong> above to explain what is currently highlighted!
            </p>
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-2 pt-1 border-t border-[#2A303A]">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#737C8A] block">
              Or paste text to explain:
            </span>
            <textarea
              rows={3}
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Paste or type any paragraph, code, or jargon to explain..."
              className="w-full text-xs p-2.5 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] text-[#FFFFFF] placeholder-[#5A6372] focus:outline-none focus:border-[#D4FF00] resize-none font-mono"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!manualInput.trim()}
                onClick={() => {
                  setActiveAction('explain');
                  setSelectedText(manualInput.trim());
                  executeAction(manualInput.trim(), 'explain', explainStyle, replyTone, customLanguage);
                }}
                className="flex-1 py-1.5 px-2 rounded-[2px] bg-[#181B1F] hover:bg-[#20252D] text-[#F59E0B] border border-[#F59E0B]/30 text-[10px] font-mono font-bold uppercase transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Lightbulb className="w-3.5 h-3.5" />
                <span>Explain</span>
              </button>

              <button
                type="button"
                disabled={!manualInput.trim()}
                onClick={() => {
                  setActiveAction('translate');
                  setSelectedText(manualInput.trim());
                  executeAction(manualInput.trim(), 'translate', explainStyle, replyTone, customLanguage);
                }}
                className="flex-1 py-1.5 px-2 rounded-[2px] bg-[#181B1F] hover:bg-[#20252D] text-[#D4FF00] border border-[#D4FF00]/30 text-[10px] font-mono font-bold uppercase transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <Languages className="w-3.5 h-3.5" />
                <span>Translate</span>
              </button>

              <button
                type="button"
                disabled={!manualInput.trim()}
                onClick={() => {
                  setActiveAction('reply');
                  setSelectedText(manualInput.trim());
                  executeAction(manualInput.trim(), 'reply', explainStyle, replyTone, customLanguage);
                }}
                className="flex-1 py-1.5 px-2 rounded-[2px] bg-[#181B1F] hover:bg-[#20252D] text-[#FFFFFF] border border-[#3A4250] text-[10px] font-mono font-bold uppercase transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <MessageSquareReply className="w-3.5 h-3.5" />
                <span>Draft</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* API Key Missing Callout */}
      {!hasGeminiKey && (
        <div className="p-3 rounded-[2px] bg-[#1E180E] border border-[#F59E0B]/40 text-[#F59E0B] space-y-2 animate-fade-in shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF]">
              Gemini API Key Required
            </span>
          </div>
          <p className="text-[11px] text-[#D8A657] font-sans leading-relaxed">
            Configure your Gemini API key to activate instant AI explanations for highlighted text.
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="py-1 px-3 rounded-[2px] bg-[#F59E0B] hover:bg-[#D97706] text-black text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <KeyRound className="w-3 h-3" />
            <span>Open Settings</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Rate Limit Banner */}
      {rateLimitInfo && (
        <RateLimitBanner
          initialSeconds={rateLimitInfo.seconds}
          message={rateLimitInfo.message}
          onOpenSettings={onOpenSettings}
          onRetry={() => executeAction(selectedText, activeAction, explainStyle, replyTone, customLanguage)}
          onDismiss={() => setRateLimitInfo(null)}
        />
      )}

      {/* Error Callout */}
      {error && (
        <div className="p-3 rounded-[2px] bg-[#221214] border border-[#FF5555]/40 text-[#FF8888] space-y-1.5 animate-fade-in">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#FF5555]" />
            <span>Execution Error</span>
          </div>
          <p className="text-[11px] text-[#D8A8A8] font-sans leading-relaxed">{error}</p>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && !generatedOutput && (
        <div className="p-3 rounded-[2px] bg-[#121417] border border-[#2A303A] space-y-2 animate-pulse">
          <div className="flex items-center gap-2 text-[#D4FF00] text-xs font-mono font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>Analyzing highlighted section with {settings.model}...</span>
          </div>
          <div className="h-2 bg-[#1F242C] rounded-[1px] w-5/6" />
          <div className="h-2 bg-[#1F242C] rounded-[1px] w-full" />
          <div className="h-2 bg-[#1F242C] rounded-[1px] w-4/6" />
        </div>
      )}

      {/* Generated Result Output */}
      {generatedOutput && (
        <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-3 space-y-2.5 relative animate-fade-in shadow-sm">
          <div className="flex items-center justify-between border-b border-[#2A303A] pb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4FF00]" />
              <span className="text-[10px] font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
                {currentConfig.shortLabel} Result
              </span>
              {isStreaming && (
                <span className="text-[9px] text-[#D4FF00] animate-pulse font-mono font-bold ml-1">
                  [Streaming...]
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="py-0.5 px-2 rounded-[2px] bg-[#221214] hover:bg-[#2E181B] text-[#FF8888] border border-[#FF5555]/40 text-[9px] font-mono font-bold uppercase transition-colors flex items-center gap-1"
                >
                  <StopCircle className="w-3 h-3" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="py-0.5 px-2 rounded-[2px] bg-[#181B1F] hover:bg-[#22262C] text-[#E0E3E8] border border-[#2A303A] text-[9px] font-mono font-semibold uppercase transition-colors flex items-center gap-1"
                  title="Copy result to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-[#D4FF00]" />
                      <span className="text-[#D4FF00] font-bold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-[#737C8A]" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="pt-0.5">{renderFormattedOutput(generatedOutput)}</div>

          {!isStreaming && (
            <div className="flex items-center justify-between pt-2 border-t border-[#2A303A] text-[9px] font-mono text-[#737C8A]">
              <span>CHANNEL: {customLanguage.toUpperCase()}</span>
              <div className="flex items-center gap-3">
                {onAskInChat && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskInChat(
                        `Regarding this highlighted text: "${selectedText.substring(0, 120)}...", can you explain more about this?`
                      )
                    }
                    className="text-[#D4FF00] hover:text-[#BCE600] flex items-center gap-1 transition-colors font-mono font-semibold uppercase"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>Ask in Chat</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    executeAction(selectedText, activeAction, explainStyle, replyTone, customLanguage)
                  }
                  className="hover:text-[#FFFFFF] flex items-center gap-1 transition-colors font-mono uppercase"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Regenerate</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

