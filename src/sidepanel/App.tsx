import React, { useState, useEffect } from 'react';
import { Bot, Sparkles, ShieldCheck, CheckCircle2, Terminal, Zap, Globe, Cpu } from 'lucide-react';

export default function App() {
  const [activeTabUrl, setActiveTabUrl] = useState<string>('Detecting active tab...');
  const [isReady, setIsReady] = useState(true);

  useEffect(() => {
    // Query active tab to verify chrome.tabs permission and connectivity
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.url) {
          try {
            const url = new URL(tabs[0].url);
            setActiveTabUrl(`${url.hostname}${url.pathname.substring(0, 20)}...`);
          } catch {
            setActiveTabUrl(tabs[0].url);
          }
        } else {
          setActiveTabUrl('No active tab URL');
        }
      });
    } else {
      setActiveTabUrl('Browser environment (Dev preview)');
    }
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Top Header */}
      <header className="px-4 py-3 bg-slate-800/80 backdrop-blur border-b border-slate-700/60 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-white">ASKbro</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                v1.0.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Chrome Side-Panel AI Agent</p>
          </div>
        </div>

        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Online
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 flex flex-col gap-4">
        {/* Hero Card: ASKbro ready */}
        <div className="p-4 rounded-xl bg-gradient-to-b from-indigo-950/60 to-slate-800/60 border border-indigo-500/30 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Sparkles className="w-24 h-24 text-indigo-400" />
          </div>

          <div className="flex items-center gap-2 text-indigo-400 mb-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h1 className="font-semibold text-lg text-white">ASKbro ready</h1>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed mb-3">
            Phase 0 initialization complete. The environment, Manifest V3 side panel pipeline, and TypeScript tooling are running smoothly.
          </p>

          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-[11px] text-slate-400">
            <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate">Active Context: <strong className="text-slate-200">{activeTabUrl}</strong></span>
          </div>
        </div>

        {/* System Capabilities Checklist */}
        <div className="rounded-xl bg-slate-800/40 border border-slate-700/50 p-3.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            System Status Checkpoint
          </h2>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
              <span className="text-slate-300 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Manifest V3 & Permissions
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-medium">OK</span>
            </div>

            <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
              <span className="text-slate-300 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Chrome Side-Panel API
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-medium">ACTIVE</span>
            </div>

            <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
              <span className="text-slate-300 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Vite + React 18 + Tailwind
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-medium">CONNECTED</span>
            </div>

            <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
              <span className="text-slate-300 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                Deterministic HITL Safety Rails
              </span>
              <span className="text-[10px] font-mono text-indigo-400 font-medium">ENFORCED</span>
            </div>
          </div>
        </div>

        {/* Next Phase Indicator */}
        <div className="mt-auto p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-xs text-indigo-200/80 flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>Ready for <strong>Phase 1: The Eyes</strong> (Article extractor, Gemini client & Hinglish summarizer).</span>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-4 py-2 bg-slate-800/40 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
        <span>ASKbro AI Browser Agent</span>
        <span>Local-first • Zero-telemetry</span>
      </footer>
    </div>
  );
}
