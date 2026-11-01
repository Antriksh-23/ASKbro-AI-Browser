import React, { useState } from 'react';
import {
  Play,
  RotateCcw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Languages,
  BookOpen,
} from 'lucide-react';
import { OutputLanguage, AISettings, StructuredSummaryOutput } from '../../../types/ai';
import { generateStructuredSummary, GeminiError } from '../../../services/ai/gemini';

interface GeminiTestCardProps {
  settings: AISettings;
}

const SAMPLE_TEXT = `Modern web browsers have evolved from passive document viewers into active application platforms. With the introduction of Chrome Manifest V3 and the Side Panel API, AI assistants can now inspect active tab contexts and interact with users without taking over full screen real estate. However, autonomous browser agents pose safety hazards if granted unchecked access to banking sites, password managers, or sensitive forms. ASKbro introduces a Human-in-the-Loop (HITL) architecture where every computer-use action requires explicit approval, backed by deterministic client-side safety rails.`;

export default function GeminiTestCard({ settings }: GeminiTestCardProps) {
  const [inputText, setInputText] = useState(SAMPLE_TEXT);
  const [language, setLanguage] = useState<OutputLanguage>(settings.language || 'en');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [summaryResult, setSummaryResult] = useState<StructuredSummaryOutput | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleTestSummarize = async () => {
    if (!settings.geminiApiKey?.trim()) {
      setErrorMsg('Please configure your Gemini API Key in Settings first.');
      return;
    }

    setIsStreaming(true);
    setErrorMsg(null);
    setStreamedText('');
    setSummaryResult(null);

    try {
      const result = await generateStructuredSummary({
        content: inputText,
        title: 'Browser AI Agents & HITL Architecture',
        url: 'https://askbro.dev/architecture',
        language,
        apiKey: settings.geminiApiKey,
        model: settings.model,
        onChunk: (_delta, accumulated) => {
          setStreamedText(accumulated);
        },
      });

      setSummaryResult(result);
    } catch (err: unknown) {
      if (err instanceof GeminiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Unknown generation failure');
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleReset = () => {
    setInputText(SAMPLE_TEXT);
    setStreamedText('');
    setSummaryResult(null);
    setErrorMsg(null);
  };

  return (
    <div className="rounded-[2px] bg-[#181B1F] border border-[#2A303A] p-3.5 space-y-3 shadow-sm animate-fade-in font-sans">
      <div className="flex items-center justify-between border-b border-[#2A303A] pb-2 font-mono">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-[2px] bg-[#121417] border border-[#2A303A] text-[#D4FF00]">
            <BookOpen className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">
            Client Inference Preview
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLanguage(language === 'en' ? 'hinglish' : 'en')}
            className="flex items-center gap-1 px-2 py-0.5 rounded-[2px] text-[10px] bg-[#121417] hover:bg-[#20242A] border border-[#2A303A] text-[#D4FF00] font-semibold font-mono"
            title="Toggle language between English and Hinglish"
          >
            <Languages className="w-2.5 h-2.5 text-[#D4FF00]" />
            <span className="uppercase">{language}</span>
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[#9DA5B2] leading-relaxed">
        Test streaming generation and structured summarization using{' '}
        <span className="font-mono text-[#D4FF00] bg-[#121417] px-1.5 py-0.2 rounded-[2px] border border-[#2A303A]">{settings.model}</span>.
      </p>

      {/* Input sample text */}
      <div className="space-y-1 font-mono">
        <label className="text-[10px] uppercase font-bold text-[#9DA5B2]">Sample Text to Summarize:</label>
        <textarea
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] p-2.5 text-xs text-[#E0E3E8] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 font-sans shadow-well-inset"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 font-mono">
        <button
          type="button"
          onClick={handleTestSummarize}
          disabled={isStreaming || !inputText.trim()}
          className="flex-1 py-1.5 px-3.5 rounded-[2px] btn-lime text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40"
        >
          {isStreaming ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Streaming Gemini...</span>
            </>
          ) : (
            <>
              <Play className="w-3 h-3 fill-current" />
              <span>Test Streaming Summary</span>
            </>
          )}
        </button>

        {(streamedText || summaryResult || errorMsg) && (
          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded-[2px] btn-graphite"
            title="Reset test output"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Error state */}
      {errorMsg && (
        <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs flex items-start gap-2 shadow-sm font-sans">
          <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-xs text-[#FFFFFF] font-mono uppercase">Inference Error</span>
            <p className="text-[11px] leading-relaxed text-[#C2C7D0]">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Streaming in progress */}
      {isStreaming && !summaryResult && streamedText && (
        <div className="p-2.5 rounded-[2px] bg-[#121417] border border-[#2A303A] text-xs space-y-1.5 animate-fade-in font-mono shadow-well-inset">
          <div className="flex items-center gap-1.5 text-[#D4FF00] text-[10px] font-bold uppercase tracking-wider">
            <span>Streaming Generation...</span>
          </div>
          <pre className="text-[11px] text-[#E0E3E8] font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {streamedText}
          </pre>
        </div>
      )}

      {/* Structured Summary Result Card */}
      {summaryResult && (
        <div className="p-3 rounded-[2px] bg-[#121417] border border-[#2A303A] text-xs space-y-2.5 animate-fade-in font-sans shadow-well-inset">
          <div className="flex items-center justify-between border-b border-[#2A303A] pb-1.5 font-mono">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#D4FF00] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Summary Result
            </span>
            <span className="text-[9px] text-[#9DA5B2] uppercase bg-[#181B1F] px-1.5 py-0.2 rounded-[2px] border border-[#2A303A]">
              Tone: {summaryResult.language}
            </span>
          </div>

          {/* 1. TL;DR */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-[#D4FF00]">
              1. TL;DR
            </span>
            <p className="text-[#FFFFFF] leading-relaxed bg-[#181B1F] p-2 rounded-[2px] border border-[#22262E] text-xs">
              {summaryResult.summary.tldr}
            </p>
          </div>

          {/* 2. Key Takeaways */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-[#FFFFFF]">
              2. 5 Key Takeaways
            </span>
            <ul className="space-y-1 pl-0.5">
              {summaryResult.summary.keyTakeaways.map((point, idx) => (
                <li key={idx} className="text-xs text-[#C2C7D0] leading-relaxed flex items-start gap-1.5">
                  <span className="text-[#D4FF00] font-bold font-mono">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 3. What To Do Next */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono text-[#D4FF00]">
              3. What To Do Next
            </span>
            <ul className="space-y-1 pl-0.5">
              {summaryResult.summary.actionableSteps.map((step, idx) => (
                <li key={idx} className="text-xs text-[#E0E3E8] leading-relaxed flex items-start gap-1.5">
                  <span className="text-[#D4FF00] font-bold font-mono">→</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
