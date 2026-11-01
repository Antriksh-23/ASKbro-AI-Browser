import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Zap,
  Globe,
  Settings as SettingsIcon,
  KeyRound,
  ArrowRight,
  AlertTriangle,
  MessageSquare,
  Camera,
  Bot,
  Activity,
  Cpu,
  Layers,
  Lightbulb,
  History,
} from 'lucide-react';
import { AISettings, DEFAULT_SETTINGS } from '../types/ai';
import { PageContentResponse, ContextMenuActionPayload } from '../types/messages';
import { getSettings, setLanguage } from '../services/storage/settingsStore';
import { getPendingContextAction, clearPendingContextAction } from '../background/menuHandler';
import { getActiveTab } from '../services/reader';
import { ChatHistorySession } from '../services/storage/historyStore';
import ApiKeySettings from './components/Settings/ApiKeySettings';
import SummaryCard from './components/Summary/SummaryCard';
import ArticleExtractCard from './components/Reader/ArticleExtractCard';
import LanguageToggle from './components/Common/LanguageToggle';
import ContextMenuActionCard from './components/Actions/ContextMenuActionCard';
import ChatView from './components/Chat/ChatView';
import { ExplainView } from './components/Explain';
import { ScreenshotModal } from './components/Vision';
import { AgentView } from './components/Agent';
import { SkillsLibrary } from './components/Skills';
import { HistoryView } from './components/History';

type ActiveView = 'chat' | 'explain' | 'agent' | 'skills' | 'dashboard' | 'history' | 'settings';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [activeTabUrl, setActiveTabUrl] = useState<string>('Detecting active tab...');
  const [activeTabFullUrl, setActiveTabFullUrl] = useState<string>('');
  const [activeTabTitle, setActiveTabTitle] = useState<string>('');
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [isSettingsLoaded, setIsSettingsLoaded] = useState<boolean>(false);
  const [extractedArticle, setExtractedArticle] = useState<PageContentResponse | null>(null);
  const [contextMenuAction, setContextMenuAction] = useState<ContextMenuActionPayload | null>(null);
  const [chatInitialQuery, setChatInitialQuery] = useState<string | null>(null);
  const [agentInitialGoal, setAgentInitialGoal] = useState<string | null>(null);
  const [isVisionModalOpen, setIsVisionModalOpen] = useState<boolean>(false);
  const [previousView, setPreviousView] = useState<ActiveView>('chat');
  const [isChatThinking, setIsChatThinking] = useState<boolean>(false);
  const [loadedChatSession, setLoadedChatSession] = useState<ChatHistorySession | null>(null);

  const openSettings = () => {
    setPreviousView(activeView === 'settings' ? 'chat' : activeView);
    setActiveView('settings');
  };

  useEffect(() => {
    // 1. Query active tab to verify chrome.tabs permission and connectivity
    const updateActiveTab = async () => {
      try {
        const tab = await getActiveTab();
        if (tab && tab.url) {
          setActiveTabFullUrl(tab.url);
          setActiveTabTitle(tab.title || '');
          // Invalidate extractedArticle if user navigated to a different URL
          setExtractedArticle((prev) => (prev && prev.url === tab.url ? prev : null));
          try {
            const url = new URL(tab.url);
            setActiveTabUrl(`${url.hostname}${url.pathname.substring(0, 24)}...`);
          } catch {
            setActiveTabUrl(tab.url);
          }
        } else {
          setActiveTabFullUrl('');
          setActiveTabTitle('');
          setActiveTabUrl('No active tab');
        }
      } catch {
        setActiveTabUrl('Browser environment');
      }
    };

    updateActiveTab();

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.onActivated?.addListener(updateActiveTab);
      chrome.tabs.onUpdated?.addListener(updateActiveTab);
    }

    // 2. Load stored settings and API key
    loadStoredSettings();

    // 3. Cold-start pickup: check for pending right-click context menu action
    getPendingContextAction()
      .then((pending) => {
        if (pending) {
          setContextMenuAction(pending);
          clearPendingContextAction();
          setActiveView('explain');
        }
      })
      .catch((err) => {
        console.warn('[ASKbro App] Error checking pending context action:', err);
      });

    // 4. Runtime listener for incoming context menu actions while side panel is already open
    const handleRuntimeMessage = (message: any) => {
      if (message?.type === 'CONTEXT_MENU_ACTION' && message.payload) {
        setContextMenuAction(message.payload);
        clearPendingContextAction();
        setActiveView('explain');
      } else if (message?.type === 'YOUTUBE_NAVIGATED') {
        updateActiveTab();
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    }

    return () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.onActivated?.removeListener(updateActiveTab);
        chrome.tabs.onUpdated?.removeListener(updateActiveTab);
      }
    };
  }, []);

  const loadStoredSettings = async () => {
    try {
      const stored = await getSettings();
      setSettings(stored);
    } catch (err) {
      console.error('[ASKbro App] Error loading settings:', err);
    } finally {
      setIsSettingsLoaded(true);
    }
  };

  const hasApiKey = Boolean(
    (settings.geminiApiKey && settings.geminiApiKey.trim().length >= 10) ||
    (settings.groqApiKey && settings.groqApiKey.trim().length >= 10)
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#0C0D0E] text-[#E0E3E8] font-sans antialiased selection:bg-[#D4FF00] selection:text-[#0C0D0E]">
      {/* Top Header — Industrial Console Bar */}
      <header className="px-3.5 py-2 bg-[#121417] border-b border-[#2A303A] flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          {/* Engineered Monogram Emblem */}
          <div className="w-6 h-6 rounded-[2px] bg-[#20242A] border border-[#343B45] text-[#D4FF00] flex items-center justify-center font-mono font-bold text-xs tracking-wider shadow-sm">
            <span className="leading-none">AB</span>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs tracking-wider text-[#FFFFFF]">
                ASKbro
              </span>
              <span className="telemetry-led-lime" title="Runtime Active" />
            </div>
            <span className="text-[9px] font-mono tracking-widest text-[#737C8A] uppercase leading-none mt-0.5">
              BROWSER INSTRUMENT
            </span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-1.5">
          {/* Global Language Switcher */}
          <LanguageToggle
            value={settings.language}
            onChange={async (newLang) => {
              setSettings((prev) => ({ ...prev, language: newLang }));
              await setLanguage(newLang);
            }}
            size="xs"
            showIcon={false}
          />

          {/* Missing Key Setup Indicator */}
          {isSettingsLoaded && !hasApiKey && (
            <button
              onClick={() => openSettings()}
              className="flex items-center gap-1 px-2 py-0.5 rounded-[2px] bg-[#2A1E0B] border border-[#F59E0B]/50 text-[#F59E0B] hover:bg-[#3D2B10] text-[10px] font-mono font-medium transition-colors"
              title="Click to configure Gemini or Groq API Key"
            >
              <KeyRound className="w-2.5 h-2.5" />
              <span>KEY REQUIRED</span>
            </button>
          )}

          {/* History Quick Trigger */}
          <button
            onClick={() => {
              if (activeView === 'history') {
                setActiveView(previousView === 'history' ? 'chat' : previousView);
              } else {
                setPreviousView(activeView === 'settings' ? 'chat' : activeView);
                setActiveView('history');
              }
            }}
            className={`p-1.5 rounded-[2px] transition-all ${
              activeView === 'history'
                ? 'bg-[#D4FF00] text-[#0C0D0E] font-bold shadow-sm'
                : 'text-[#9DA5B2] hover:text-[#D4FF00] hover:bg-[#20242A] border border-transparent hover:border-[#343B45]'
            }`}
            title="Activity History & Audit Logs"
            aria-label="History"
            data-testid="askbro-btn-history"
          >
            <History className="w-3.5 h-3.5" />
          </button>

          {/* Screen Capture Quick Trigger */}
          <button
            onClick={() => setIsVisionModalOpen(true)}
            className="p-1.5 rounded-[2px] text-[#9DA5B2] hover:text-[#D4FF00] hover:bg-[#20242A] border border-transparent hover:border-[#343B45] transition-all"
            title="Inspect screen (Charts, tables, errors)"
            aria-label="Capture Screen"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          {/* Settings Toggle Button */}
          <button
            onClick={() => {
              if (activeView === 'settings') {
                setActiveView(previousView);
              } else {
                openSettings();
              }
            }}
            className={`p-1.5 rounded-[2px] transition-all ${
              activeView === 'settings'
                ? 'bg-[#D4FF00] text-[#0C0D0E] font-bold shadow-sm'
                : 'text-[#9DA5B2] hover:text-[#FFFFFF] hover:bg-[#20242A] border border-transparent hover:border-[#343B45]'
            }`}
            title="Settings & System Configurations"
            aria-label="Settings"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Top View Navigation — Machined Tactile Segmented Channels */}
      {activeView !== 'settings' && activeView !== 'history' && (
        <nav className="mx-3 my-2 p-0.5 rounded-[2px] bg-[#121417] border border-[#2A303A] grid grid-cols-5 gap-0.5 shrink-0 font-mono text-[10px]">
          <button
            onClick={() => setActiveView('chat')}
            className={`py-1.5 px-0.5 rounded-[2px] font-medium flex items-center justify-center gap-1 transition-all ${
              activeView === 'chat'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm font-semibold'
                : 'text-[#9DA5B2] hover:text-[#E0E3E8] hover:bg-[#181B1F]'
            }`}
          >
            <MessageSquare className="w-3 h-3 shrink-0" />
            <span>CHAT</span>
            {isChatThinking && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#D4FF00] animate-ping ml-0.5"
                title="Generating answer..."
              />
            )}
          </button>
          <button
            onClick={() => setActiveView('explain')}
            className={`py-1.5 px-0.5 rounded-[2px] font-medium flex items-center justify-center gap-1 transition-all ${
              activeView === 'explain'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm font-semibold'
                : 'text-[#9DA5B2] hover:text-[#E0E3E8] hover:bg-[#181B1F]'
            }`}
          >
            <Lightbulb className="w-3 h-3 shrink-0" />
            <span>EXPLAIN</span>
          </button>
          <button
            onClick={() => setActiveView('agent')}
            className={`py-1.5 px-0.5 rounded-[2px] font-medium flex items-center justify-center gap-1 transition-all ${
              activeView === 'agent'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm font-semibold'
                : 'text-[#9DA5B2] hover:text-[#E0E3E8] hover:bg-[#181B1F]'
            }`}
          >
            <Bot className="w-3 h-3 shrink-0" />
            <span>AGENT</span>
          </button>
          <button
            onClick={() => setActiveView('skills')}
            className={`py-1.5 px-0.5 rounded-[2px] font-medium flex items-center justify-center gap-1 transition-all ${
              activeView === 'skills'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm font-semibold'
                : 'text-[#9DA5B2] hover:text-[#E0E3E8] hover:bg-[#181B1F]'
            }`}
          >
            <Zap className="w-3 h-3 shrink-0" />
            <span>SKILLS</span>
          </button>
          <button
            onClick={() => setActiveView('dashboard')}
            className={`py-1.5 px-0.5 rounded-[2px] font-medium flex items-center justify-center gap-1 transition-all ${
              activeView === 'dashboard'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm font-semibold'
                : 'text-[#9DA5B2] hover:text-[#E0E3E8] hover:bg-[#181B1F]'
            }`}
          >
            <Sparkles className="w-3 h-3 shrink-0" />
            <span>SUMMARY</span>
          </button>
        </nav>
      )}

      {/* Main Content Viewport — Persistent Views to Prevent Interrupted Thinking/Generation */}
      <main className="flex-1 flex flex-col min-h-0 relative">
        <div className={activeView === 'settings' ? 'flex-1 flex flex-col p-3 gap-3 overflow-y-auto' : 'hidden'}>
          <ApiKeySettings
            onBack={() => setActiveView(previousView)}
            onSettingsSaved={(newSettings) => {
              setSettings(newSettings);
            }}
          />
        </div>

        <div className={activeView === 'history' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <HistoryView
            onBack={() => setActiveView(previousView === 'history' ? 'chat' : previousView)}
            onLoadChatSession={(session) => {
              setLoadedChatSession(session);
              setActiveView('chat');
            }}
            onOpenAgentWithGoal={(goal) => {
              setAgentInitialGoal(goal);
              setActiveView('agent');
            }}
          />
        </div>

        <div className={activeView === 'explain' ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
          <ExplainView
            settings={settings}
            currentAction={contextMenuAction}
            onOpenSettings={() => openSettings()}
            onLanguageChange={async (newLang) => {
              setSettings((prev) => ({ ...prev, language: newLang }));
              await setLanguage(newLang);
            }}
            onAskInChat={(query) => {
              setChatInitialQuery(query);
              setActiveView('chat');
            }}
            onClearAction={() => setContextMenuAction(null)}
          />
        </div>

        <div className={activeView === 'agent' ? 'flex-1 flex flex-col min-h-0 overflow-y-auto' : 'hidden'}>
          <AgentView
            settings={settings}
            onOpenSettings={() => openSettings()}
            onOpenHistory={() => {
              setPreviousView(activeView === 'settings' ? 'chat' : activeView);
              setActiveView('history');
            }}
            onLanguageChange={async (newLang) => {
              setSettings((prev) => ({ ...prev, language: newLang }));
              await setLanguage(newLang);
            }}
            initialGoal={agentInitialGoal}
            onClearInitialGoal={() => setAgentInitialGoal(null)}
          />
        </div>

        <div className={activeView === 'skills' ? 'flex-1 flex flex-col min-h-0 overflow-y-auto' : 'hidden'}>
          <SkillsLibrary
            settings={settings}
            onOpenSettings={() => openSettings()}
            onRunAgentGoal={(goal) => {
              setAgentInitialGoal(goal);
              setActiveView('agent');
            }}
            onOpenInChat={(text) => {
              setChatInitialQuery(text);
              setActiveView('chat');
            }}
          />
        </div>

        <div className={activeView === 'chat' ? 'flex-1 flex flex-col min-h-0 h-full' : 'hidden'}>
          <ChatView
            settings={settings}
            onOpenSettings={() => openSettings()}
            onOpenHistory={() => {
              setPreviousView(activeView === 'settings' ? 'chat' : activeView);
              setActiveView('history');
            }}
            loadedSession={loadedChatSession}
            onClearLoadedSession={() => setLoadedChatSession(null)}
            onLanguageChange={async (newLang) => {
              setSettings((prev) => ({ ...prev, language: newLang }));
              await setLanguage(newLang);
            }}
            initialPageContext={
              extractedArticle && activeTabFullUrl && extractedArticle.url === activeTabFullUrl
                ? extractedArticle
                : null
            }
            onSwitchToSummary={() => setActiveView('dashboard')}
            initialQuery={chatInitialQuery}
            onClearInitialQuery={() => setChatInitialQuery(null)}
            isActive={activeView === 'chat'}
            onStreamingChange={setIsChatThinking}
          />
        </div>

        <div className={activeView === 'dashboard' ? 'flex-1 flex flex-col p-3 gap-3 overflow-y-auto' : 'hidden'}>
          {/* Intelligence & Structured Summaries Hub */}
          <div className="space-y-3 pb-6">
            {/* API Key Missing Callout Banner */}
            {isSettingsLoaded && !hasApiKey && (
              <div className="p-3 rounded-sm bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] space-y-2 animate-fade-in font-sans">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h2 className="text-xs font-semibold text-[#FFFFFF] font-mono uppercase tracking-wider">
                      AI API Key Required
                    </h2>
                    <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
                      Connect your Gemini or Groq API key to activate instant web intelligence, structured summaries, and computer-use actions.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openSettings()}
                  className="w-full py-1.5 px-3 rounded-[2px] btn-lime text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Configure API Key</span>
                  <ArrowRight className="w-3 h-3 ml-0.5" />
                </button>
              </div>
            )}

            {/* Right-Click AI Context Actions */}
            {contextMenuAction && (
              <ContextMenuActionCard
                actionPayload={contextMenuAction}
                settings={settings}
                onClearAction={() => setContextMenuAction(null)}
                onOpenSettings={() => openSettings()}
                onLanguageChange={async (newLang) => {
                  setSettings((prev) => ({ ...prev, language: newLang }));
                  await setLanguage(newLang);
                }}
                onAskInChat={(query) => {
                  setChatInitialQuery(query);
                  setActiveView('chat');
                }}
              />
            )}

            {/* Active Page Header Card — Industrial Telemetry Panel */}
            <div className="p-3 rounded-sm bg-[#181B1F] border border-[#2A303A] flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-[2px] bg-[#121417] border border-[#343B45] text-[#D4FF00] flex items-center justify-center shrink-0">
                  <Globe className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#737C8A]">ACTIVE TARGET</span>
                  </div>
                  <h3 className="text-xs font-semibold text-[#FFFFFF] truncate font-sans" title={activeTabTitle || activeTabUrl}>
                    {activeTabTitle || 'Active Webpage'}
                  </h3>
                  <p className="text-[10px] text-[#9DA5B2] font-mono truncate" title={activeTabFullUrl}>
                    {activeTabUrl}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setChatInitialQuery('Summarize this page in 3 bullets');
                  setActiveView('chat');
                }}
                className="px-2.5 py-1.5 rounded-[2px] btn-lime text-[11px] font-semibold flex items-center gap-1.5 shrink-0 shadow-sm"
              >
                <Sparkles className="w-3 h-3" />
                <span>Ask in Chat</span>
              </button>
            </div>

            {/* Structured Summarization Card */}
            <SummaryCard
              article={
                extractedArticle && activeTabFullUrl && extractedArticle.url === activeTabFullUrl
                  ? extractedArticle
                  : null
              }
              settings={settings}
              onOpenSettings={() => openSettings()}
              onLanguageChange={async (newLang) => {
                setSettings((prev) => ({ ...prev, language: newLang }));
                await setLanguage(newLang);
              }}
            />

            {/* Article Extractor Reader Card */}
            <ArticleExtractCard
              onContentExtracted={(content) => setExtractedArticle(content)}
              onSummarizeRequested={(content) => setExtractedArticle(content)}
            />
          </div>
        </div>
      </main>

      {/* Visual Screen Understanding Modal */}
      <ScreenshotModal
        isOpen={isVisionModalOpen}
        onClose={() => setIsVisionModalOpen(false)}
        settings={settings}
        onLanguageChange={async (newLang) => {
          setSettings((prev) => ({ ...prev, language: newLang }));
          await setLanguage(newLang);
        }}
        onOpenSettings={() => setActiveView('settings')}
        onAskInChat={(query, visualSummary) => {
          setChatInitialQuery(visualSummary || query);
          setActiveView('chat');
        }}
      />

      {/* Industrial Machine Telemetry Footer */}
      <footer className="px-3.5 py-1.5 border-t border-[#2A303A] bg-[#121417] text-[10px] text-[#737C8A] flex items-center justify-between font-mono">
        <span className="font-semibold tracking-wider text-[#9DA5B2]">ASKbro // <span className="uppercase">RUNTIME</span></span>
        <span className="flex items-center gap-1.5">
          <span className="telemetry-led-lime" />
          <span className="text-[#E0E3E8]">LOCAL ENGINE READY</span>
        </span>
      </footer>
    </div>
  );
}
