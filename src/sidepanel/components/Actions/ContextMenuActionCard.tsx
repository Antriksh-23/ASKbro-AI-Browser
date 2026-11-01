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
} from 'lucide-react';
import { AISettings, OutputLanguage, ReplyTone } from '../../../types/ai';
import { ContextActionType, ContextMenuActionPayload } from '../../../types/messages';
import { streamContextMenuAction } from '../../../services/ai/contextMenuActions';
import LanguageToggle from '../Common/LanguageToggle';
import RateLimitBanner from '../Common/RateLimitBanner';

export interface ContextMenuActionCardProps {
  actionPayload: ContextMenuActionPayload | null;
  settings: AISettings;
  onClearAction: () => void;
  onOpenSettings: () => void;
  onLanguageChange?: (lang: OutputLanguage) => void;
  onAskInChat?: (query: string) => void;
}

const ACTION_CONFIGS: Record<
  ContextActionType,
  {
    label: string;
    shortLabel: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    bgBadge: string;
    borderBadge: string;
    textBadge: string;
  }
> = {
  explain: {
    label: 'Explain Selection',
    shortLabel: 'Explain',
    description: 'Simplifies jargon, technical concepts & dense text',
    icon: Lightbulb,
    accentColor: 'amber',
    bgBadge: 'bg-[#181B1F]',
    borderBadge: 'border-[#F59E0B]/40',
    textBadge: 'text-[#F59E0B]',
  },
  translate: {
    label: 'Translate to Hindi / Hinglish',
    shortLabel: 'Translate',
    description: 'Accurate Devanagari Hindi & colloquial Roman Hinglish',
    icon: Languages,
    accentColor: 'lime',
    bgBadge: 'bg-[#181B1F]',
    borderBadge: 'border-[#D4FF00]/40',
    textBadge: 'text-[#D4FF00]',
  },
  reply: {
    label: 'Draft a Reply',
    shortLabel: 'Draft Reply',
    description: 'Professional, direct, or casual ready-to-send replies',
    icon: MessageSquareReply,
    accentColor: 'silver',
    bgBadge: 'bg-[#181B1F]',
    borderBadge: 'border-[#444D5B]',
    textBadge: 'text-[#FFFFFF]',
  },
};

const REPLY_TONES: Array<{ id: ReplyTone; label: string; icon: string }> = [
  { id: 'professional', label: 'Professional', icon: '👔' },
  { id: 'direct', label: 'Direct', icon: '⚡' },
  { id: 'casual', label: 'Casual', icon: '💬' },
];

export default function ContextMenuActionCard({
  actionPayload,
  settings,
  onClearAction,
  onOpenSettings,
  onLanguageChange,
  onAskInChat,
}: ContextMenuActionCardProps) {
  const [selectedText, setSelectedText] = useState<string>('');
  const [activeAction, setActiveAction] = useState<ContextActionType>('explain');
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

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCustomLanguage(settings.language || 'en');
  }, [settings.language]);

  useEffect(() => {
    if (actionPayload && actionPayload.selectedText) {
      setSelectedText(actionPayload.selectedText);
      setActiveAction(actionPayload.action);
      setIsEditingSnippet(false);
      setGeneratedOutput('');
      setError(null);
      executeAction(actionPayload.selectedText, actionPayload.action, replyTone, customLanguage);
    }
  }, [actionPayload?.id]);

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
    tone: ReplyTone = replyTone,
    lang: OutputLanguage = customLanguage
  ) => {
    if (!textToProcess || !textToProcess.trim()) {
      setError('Please provide text to process.');
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
        selectedText: textToProcess,
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
    } catch (err: any) {
      if (err.name === 'AbortError') return;

      console.error('[ContextMenuActionCard] Execution error:', err);
      const message = err?.message || 'Failed to complete quick action.';
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

  const handleActionTabChange = (newAction: ContextActionType) => {
    if (newAction === activeAction && generatedOutput) return;
    setActiveAction(newAction);
    const targetText = selectedText || manualInput;
    if (targetText.trim()) {
      executeAction(targetText, newAction, replyTone, customLanguage);
    }
  };

  const handleToneChange = (newTone: ReplyTone) => {
    if (newTone === replyTone) return;
    setReplyTone(newTone);
    const targetText = selectedText || manualInput;
    if (targetText.trim() && activeAction === 'reply') {
      executeAction(targetText, 'reply', newTone, customLanguage);
    }
  };

  const handleLanguageToggle = async (newLang: OutputLanguage) => {
    setCustomLanguage(newLang);
    if (onLanguageChange) {
      onLanguageChange(newLang);
    }
    const targetText = selectedText || manualInput;
    if (targetText.trim() && generatedOutput) {
      executeAction(targetText, activeAction, replyTone, newLang);
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
    executeAction(manualInput.trim(), activeAction, replyTone, customLanguage);
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
                className="font-mono font-bold text-xs uppercase tracking-wider text-[#FFFFFF] pt-1.5 pb-0.5 border-b border-[#2A303A]"
              >
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

  if (!selectedText && !actionPayload) {
    return (
      <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-3 space-y-3 shadow-sm animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#D4FF00]">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
              Right-Click Quick Actions
            </h2>
          </div>
          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-[2px] bg-[#181B1F] text-[#D4FF00] border border-[#D4FF00]/40">
            Active
          </span>
        </div>

        <p className="text-xs text-[#9BA3AF] leading-relaxed font-sans">
          Highlight any text on any webpage and right-click to instantly{' '}
          <strong className="text-[#F59E0B] font-semibold">Explain</strong>,{' '}
          <strong className="text-[#D4FF00] font-semibold">Translate</strong>, or{' '}
          <strong className="text-[#FFFFFF] font-semibold">Draft a reply</strong>.
        </p>

        {/* Manual Test Input Area */}
        <form onSubmit={handleManualSubmit} className="space-y-2 pt-1">
          <textarea
            rows={2}
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Or type/paste any text here to test quick actions..."
            className="w-full text-xs p-2.5 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] text-[#FFFFFF] placeholder-[#5A6372] focus:outline-none focus:border-[#D4FF00] resize-none font-mono"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!manualInput.trim()}
              onClick={() => {
                setActiveAction('explain');
                setSelectedText(manualInput.trim());
                executeAction(manualInput.trim(), 'explain', replyTone, customLanguage);
              }}
              className="flex-1 py-1 px-2 rounded-[2px] bg-[#181B1F] hover:bg-[#20252D] text-[#F59E0B] border border-[#F59E0B]/30 text-[10px] font-mono font-semibold uppercase transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <Lightbulb className="w-3 h-3" />
              <span>Explain</span>
            </button>

            <button
              type="button"
              disabled={!manualInput.trim()}
              onClick={() => {
                setActiveAction('translate');
                setSelectedText(manualInput.trim());
                executeAction(manualInput.trim(), 'translate', replyTone, customLanguage);
              }}
              className="flex-1 py-1 px-2 rounded-[2px] bg-[#181B1F] hover:bg-[#20252D] text-[#D4FF00] border border-[#D4FF00]/30 text-[10px] font-mono font-semibold uppercase transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <Languages className="w-3 h-3" />
              <span>Translate</span>
            </button>

            <button
              type="button"
              disabled={!manualInput.trim()}
              onClick={() => {
                setActiveAction('reply');
                setSelectedText(manualInput.trim());
                executeAction(manualInput.trim(), 'reply', replyTone, customLanguage);
              }}
              className="flex-1 py-1 px-2 rounded-[2px] bg-[#181B1F] hover:bg-[#20252D] text-[#FFFFFF] border border-[#3A4250] text-[10px] font-mono font-semibold uppercase transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <MessageSquareReply className="w-3 h-3" />
              <span>Draft</span>
            </button>
          </div>
        </form>
      </div>
    );
  }

  const displayText = selectedText;
  const isTextLong = displayText.length > 160;

  return (
    <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-3 space-y-3 relative overflow-hidden transition-all animate-fade-in">
      {/* Top Banner & Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-6 h-6 rounded-[2px] ${currentConfig.bgBadge} border ${currentConfig.borderBadge} flex items-center justify-center ${currentConfig.textBadge}`}
          >
            <ActionIcon className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">{currentConfig.label}</h2>
              <span
                className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded-[2px] ${currentConfig.bgBadge} border ${currentConfig.borderBadge} ${currentConfig.textBadge}`}
              >
                {currentConfig.shortLabel}
              </span>
            </div>
            <p className="text-[9px] text-[#737C8A] font-mono">{currentConfig.description}</p>
          </div>
        </div>

        {/* Right Controls: Language toggle & Dismiss */}
        <div className="flex items-center gap-1.5">
          <LanguageToggle
            value={customLanguage}
            onChange={handleLanguageToggle}
            size="xs"
            showIcon={false}
          />
          <button
            type="button"
            onClick={() => {
              if (abortControllerRef.current) {
                abortControllerRef.current.abort();
              }
              setSelectedText('');
              setGeneratedOutput('');
              onClearAction();
            }}
            className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#181B1F] transition-colors"
            title="Dismiss action"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Action Selector Segmented Channel */}
      <div className="grid grid-cols-3 gap-1 bg-[#0C0D0E] p-1 rounded-[2px] border border-[#1F242C]">
        {(['explain', 'translate', 'reply'] as ContextActionType[]).map((type) => {
          const cfg = ACTION_CONFIGS[type];
          const Icon = cfg.icon;
          const isActive = activeAction === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => handleActionTabChange(type)}
              className={`py-1 px-2 rounded-[2px] text-[10px] font-mono font-bold uppercase flex items-center justify-center gap-1.5 transition-all ${
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

      {/* Selected Text Snippet Quote Box */}
      <div className="p-2.5 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-[#737C8A] font-mono uppercase tracking-wider">
          <span className="flex items-center gap-1">
            <span className="text-[#D4FF00] font-mono font-bold">›</span>
            <span>Selected Snippet</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[#5A6372] font-mono">{displayText.length} chars</span>
            <button
              type="button"
              onClick={() => setIsEditingSnippet(!isEditingSnippet)}
              className="text-[10px] text-[#D4FF00] hover:text-[#BCE600] font-mono font-semibold hover:underline"
            >
              {isEditingSnippet ? 'Done' : 'Edit'}
            </button>
          </div>
        </div>

        {isEditingSnippet ? (
          <div className="space-y-2 pt-1">
            <textarea
              rows={3}
              value={selectedText}
              onChange={(e) => setSelectedText(e.target.value)}
              className="w-full text-xs p-2 rounded-[2px] bg-[#121417] border border-[#2A303A] text-[#FFFFFF] focus:outline-none focus:border-[#D4FF00] resize-none font-mono"
            />
            <button
              type="button"
              onClick={() => {
                setIsEditingSnippet(false);
                executeAction(selectedText, activeAction, replyTone, customLanguage);
              }}
              className="py-1 px-2.5 rounded-[2px] bg-[#D4FF00] hover:bg-[#BCE600] text-black text-[10px] font-mono font-bold uppercase transition-colors shadow-sm"
            >
              Update & Run
            </button>
          </div>
        ) : (
          <div className="relative">
            <p
              className={`text-xs text-[#E0E3E8] font-mono leading-relaxed ${
                !isSnippetExpanded && isTextLong ? 'line-clamp-3' : ''
              }`}
            >
              {displayText}
            </p>
            {isTextLong && (
              <button
                type="button"
                onClick={() => setIsSnippetExpanded(!isSnippetExpanded)}
                className="mt-1 text-[10px] text-[#D4FF00] hover:text-[#BCE600] flex items-center gap-0.5 font-mono font-semibold"
              >
                <span>{isSnippetExpanded ? 'Show less' : 'Show full snippet'}</span>
                {isSnippetExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tone Switcher (when reply) */}
      {activeAction === 'reply' && (
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-[10px] text-[#737C8A] flex items-center gap-1 shrink-0 font-mono uppercase tracking-wider">
            <SlidersHorizontal className="w-3 h-3 text-[#737C8A]" />
            <span>Tone:</span>
          </span>
          <div className="flex items-center gap-1.5 flex-1">
            {REPLY_TONES.map((t) => {
              const isSelected = replyTone === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleToneChange(t.id)}
                  className={`py-1 px-2.5 rounded-[2px] text-[10px] font-mono font-semibold uppercase transition-all flex items-center gap-1 ${
                    isSelected
                      ? 'bg-[#181B1F] text-[#D4FF00] border border-[#D4FF00]/50 shadow-sm'
                      : 'bg-[#0C0D0E] text-[#9BA3AF] hover:text-[#FFFFFF] border border-[#2A303A]'
                  }`}
                >
                  <span className="text-[10px]">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* API Key Missing Callout */}
      {!hasGeminiKey && (
        <div className="p-3 rounded-[2px] bg-[#1E180E] border border-[#F59E0B]/40 text-[#F59E0B] space-y-2 animate-fade-in shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF]">Gemini API Key Required</span>
          </div>
          <p className="text-[11px] text-[#D8A657] font-sans leading-relaxed">
            Configure your Gemini key to execute right-click Explain, Translate, and Draft actions.
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
          onRetry={() => executeAction(selectedText, activeAction, replyTone, customLanguage)}
          onDismiss={() => setRateLimitInfo(null)}
        />
      )}

      {/* Error Callout */}
      {error && (
        <div className="p-3 rounded-[2px] bg-[#221214] border border-[#FF5555]/40 text-[#FF8888] space-y-1.5 animate-fade-in">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#FF5555]" />
            <span>Action Error</span>
          </div>
          <p className="text-[11px] text-[#D8A8A8] font-sans leading-relaxed">{error}</p>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && !generatedOutput && (
        <div className="p-3 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] space-y-2 animate-pulse">
          <div className="flex items-center gap-2 text-[#D4FF00] text-xs font-mono font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>Reasoning with {settings.model}...</span>
          </div>
          <div className="h-2 bg-[#1F242C] rounded-[1px] w-5/6" />
          <div className="h-2 bg-[#1F242C] rounded-[1px] w-full" />
          <div className="h-2 bg-[#1F242C] rounded-[1px] w-4/6" />
        </div>
      )}

      {/* Generated Result Output */}
      {generatedOutput && (
        <div className="p-3 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] space-y-2.5 relative animate-fade-in">
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
                        `Regarding this excerpt: "${selectedText.substring(0, 120)}...", can you explain more about this?`
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
                  onClick={() => executeAction(selectedText, activeAction, replyTone, customLanguage)}
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
