import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Save,
  Trash2,
  ArrowLeft,
  Sparkles,
  Zap,
  User,
  Compass,
  Sliders,
} from 'lucide-react';
import {
  AISettings,
  ConnectionTestResult,
  SUPPORTED_MODELS,
  SUPPORTED_GROQ_MODELS,
  OutputLanguage,
  DEFAULT_SETTINGS,
} from '../../../types/ai';
import {
  getSettings,
  saveSettings,
  testGeminiConnection,
  testGroqConnection,
  clearAllSettings,
} from '../../../services/storage/settingsStore';
import LanguageToggle from '../Common/LanguageToggle';
import ProfileView from './ProfileView';

interface ApiKeySettingsProps {
  onBack?: () => void;
  onSettingsSaved?: (settings: AISettings) => void;
}

export default function ApiKeySettings({ onBack, onSettingsSaved }: ApiKeySettingsProps) {
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);

  const [isLoading, setIsLoading] = useState(true);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);

  // Connection testing states
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<ConnectionTestResult | null>(null);

  const [isTestingGroq, setIsTestingGroq] = useState(false);
  const [groqTestResult, setGroqTestResult] = useState<ConnectionTestResult | null>(null);

  // Save feedback state
  const [saveStatus, setSaveStatus] = useState<{ type: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({
    type: 'idle',
  });

  // Settings sub-tab navigation ('keys' | 'profile')
  const [activeTab, setActiveTab] = useState<'keys' | 'profile'>('keys');

  useEffect(() => {
    async function loadSettings() {
      setIsLoading(true);
      try {
        const loaded = await getSettings();
        setSettings(loaded);
      } catch (err) {
        console.error('[ApiKeySettings] Error loading settings:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleGeminiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings((prev) => ({ ...prev, geminiApiKey: e.target.value }));
    setGeminiTestResult(null);
    setSaveStatus({ type: 'idle' });
  };

  const handleGroqKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSettings((prev) => ({ ...prev, groqApiKey: e.target.value }));
    setGroqTestResult(null);
    setSaveStatus({ type: 'idle' });
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSettings((prev) => ({ ...prev, model: e.target.value }));
    setSaveStatus({ type: 'idle' });
  };

  const handleLanguageChange = (language: OutputLanguage) => {
    setSettings((prev) => ({ ...prev, language }));
    setSaveStatus({ type: 'idle' });
  };

  const handleTestGemini = async () => {
    if (!settings.geminiApiKey?.trim()) return;
    setIsTestingGemini(true);
    setGeminiTestResult(null);
    try {
      const res = await testGeminiConnection(settings.geminiApiKey, settings.model);
      setGeminiTestResult(res);
    } catch (err: any) {
      setGeminiTestResult({
        provider: 'gemini',
        success: false,
        message: err?.message || 'Connection ping failed.',
        timestamp: Date.now(),
      });
    } finally {
      setIsTestingGemini(false);
    }
  };

  const handleTestGroq = async () => {
    if (!settings.groqApiKey?.trim()) return;
    setIsTestingGroq(true);
    setGroqTestResult(null);
    try {
      const res = await testGroqConnection(settings.groqApiKey);
      setGroqTestResult(res);
    } catch (err: any) {
      setGroqTestResult({
        provider: 'groq',
        success: false,
        message: err?.message || 'Groq connection ping failed.',
        timestamp: Date.now(),
      });
    } finally {
      setIsTestingGroq(false);
    }
  };

  const handleSave = async () => {
    setSaveStatus({ type: 'saving' });
    try {
      await saveSettings(settings);
      setSaveStatus({ type: 'saved', message: 'Configurations committed to local storage.' });
      onSettingsSaved?.(settings);
    } catch (err: any) {
      setSaveStatus({ type: 'error', message: err?.message || 'Failed to persist settings.' });
    }
  };

  const handleClearKeys = async () => {
    if (!confirm('Clear all stored API keys and reset settings?')) return;
    try {
      await clearAllSettings();
      setSettings(DEFAULT_SETTINGS);
      setGeminiTestResult(null);
      setGroqTestResult(null);
      setSaveStatus({ type: 'saved', message: 'All keys cleared.' });
    } catch (err: any) {
      setSaveStatus({ type: 'error', message: err?.message || 'Failed to clear settings.' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#737C8A] space-y-2 font-mono">
        <Loader2 className="w-5 h-5 animate-spin text-[#D4FF00]" />
        <span className="text-xs">Loading telemetry...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 bg-[#0C0D0E] text-[#E0E3E8] min-h-full font-sans animate-fade-in">
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="self-start flex items-center gap-1.5 text-xs text-[#9DA5B2] hover:text-[#FFFFFF] transition-colors py-1 px-1 -ml-1 rounded-[2px] font-mono"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>BACK TO CONSOLE</span>
        </button>
      )}

      {/* Settings Sub-Tab Navigation */}
      <div className="flex items-center gap-1 p-0.5 rounded-[2px] bg-[#121417] border border-[#2A303A] shrink-0 font-mono text-[11px]">
        <button
          type="button"
          onClick={() => setActiveTab('keys')}
          className={`flex-1 py-1.5 px-3 rounded-[2px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'keys'
              ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm'
              : 'text-[#9DA5B2] hover:text-[#FFFFFF] hover:bg-[#181B1F]'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" />
          <span>API KEYS &amp; MODELS</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex-1 py-1.5 px-3 rounded-[2px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'profile'
              ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm'
              : 'text-[#9DA5B2] hover:text-[#FFFFFF] hover:bg-[#181B1F]'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>PROFILE MEMORY</span>
        </button>
      </div>

      {activeTab === 'profile' ? (
        <ProfileView onBack={onBack} />
      ) : (
        <>
          {/* Section Header */}
          <div className="border-b border-[#2A303A] pb-2 font-mono">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[2px] bg-[#181B1F] text-[#D4FF00] flex items-center justify-center border border-[#2A303A]">
                <KeyRound className="w-3.5 h-3.5" />
              </div>
              <div>
                <h2 className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">System &amp; Key Settings</h2>
                <p className="text-[9px] text-[#737C8A]">Configure AI inference providers for summarization and actions</p>
              </div>
            </div>
          </div>

          {/* Primary Provider: Gemini API */}
          <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2.5 shadow-sm font-sans">
            <div className="flex items-center justify-between font-mono">
              <div className="flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-[#D4FF00]" />
                <label htmlFor="gemini-key-input" className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">
                  Google Gemini API Key
                </label>
              </div>
              <span className="text-[9px] font-mono uppercase font-bold px-1.5 py-0.2 rounded-[2px] bg-[#142000] text-[#D4FF00] border border-[#D4FF00]/40">
                Primary
              </span>
            </div>

            <p className="text-[11px] text-[#9DA5B2] leading-relaxed">
              Powers article summarization, YouTube extraction, and element detection.
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 ml-1 text-[#D4FF00] hover:underline font-mono"
              >
                Get free key from Google AI Studio
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </p>

            {/* Input Field with Masking */}
            <div className="relative flex items-center font-mono">
              <input
                id="gemini-key-input"
                type={showGeminiKey ? 'text' : 'password'}
                value={settings.geminiApiKey}
                onChange={handleGeminiKeyChange}
                placeholder="AIzaSy..."
                autoComplete="off"
                spellCheck="false"
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 pr-14 text-xs text-[#FFFFFF] placeholder-[#505967] font-mono focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 transition-all shadow-well-inset"
              />
              <div className="absolute right-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  title={showGeminiKey ? 'Hide key' : 'Show key'}
                  className="p-1 text-[#737C8A] hover:text-[#FFFFFF] transition-colors rounded-[2px]"
                >
                  {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Test Connection Button & Status */}
            <div className="flex items-center justify-between pt-0.5 font-mono">
              <button
                type="button"
                onClick={handleTestGemini}
                disabled={isTestingGemini || !settings.geminiApiKey.trim()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] btn-graphite text-[11px] font-semibold disabled:opacity-40"
              >
                {isTestingGemini ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-[#D4FF00]" />
                    <span>Pinging...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3 h-3 text-[#D4FF00]" />
                    <span>Test Connection</span>
                  </>
                )}
              </button>

              {settings.geminiApiKey.trim().length >= 10 && !geminiTestResult && (
                <span className="text-[10px] text-[#D4FF00] font-semibold flex items-center gap-1">
                  <span className="telemetry-led-lime" />
                  Key provided
                </span>
              )}
            </div>

            {/* Gemini Test Feedback Card */}
            {geminiTestResult && (
              <div
                className={`p-2 rounded-[2px] border text-xs flex items-start gap-2 animate-fade-in font-mono ${
                  geminiTestResult.success
                    ? 'bg-[#121812] border-[#D4FF00]/40 text-[#D4FF00]'
                    : 'bg-[#1A1712] border-[#F59E0B]/50 text-[#F59E0B]'
                }`}
              >
                {geminiTestResult.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#D4FF00] shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-0.5">
                  <p className="font-semibold text-[11px] leading-tight">{geminiTestResult.message}</p>
                  {geminiTestResult.latencyMs !== undefined && (
                    <p className="text-[10px] opacity-75">Latency: {geminiTestResult.latencyMs}ms</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Secondary Provider: Groq Cloud API */}
          <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2.5 shadow-sm font-sans">
            <div className="flex items-center justify-between font-mono">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[#F59E0B]" />
                <label htmlFor="groq-key-input" className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">
                  Groq Cloud API Key
                </label>
              </div>
              <span className="text-[9px] font-mono uppercase font-semibold px-1.5 py-0.2 rounded-[2px] bg-[#121417] text-[#9DA5B2] border border-[#2A303A]">
                Fallback
              </span>
            </div>

            <p className="text-[11px] text-[#9DA5B2] leading-relaxed">
              Provides automated fallback when Gemini reaches rate limit thresholds.
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 ml-1 text-[#F59E0B] hover:underline font-mono"
              >
                Get Groq key
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </p>

            {/* Input Field with Masking */}
            <div className="relative flex items-center font-mono">
              <input
                id="groq-key-input"
                type={showGroqKey ? 'text' : 'password'}
                value={settings.groqApiKey || ''}
                onChange={handleGroqKeyChange}
                placeholder="gsk_..."
                autoComplete="off"
                spellCheck="false"
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 pr-14 text-xs text-[#FFFFFF] placeholder-[#505967] font-mono focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 transition-all shadow-well-inset"
              />
              <div className="absolute right-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowGroqKey(!showGroqKey)}
                  title={showGroqKey ? 'Hide key' : 'Show key'}
                  className="p-1 text-[#737C8A] hover:text-[#FFFFFF] transition-colors rounded-[2px]"
                >
                  {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="flex items-center justify-between pt-0.5 font-mono">
              <button
                type="button"
                onClick={handleTestGroq}
                disabled={isTestingGroq || !settings.groqApiKey?.trim()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] btn-graphite text-[11px] font-semibold disabled:opacity-40"
              >
                {isTestingGroq ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-[#F59E0B]" />
                    <span>Pinging...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3 h-3 text-[#F59E0B]" />
                    <span>Test Groq Ping</span>
                  </>
                )}
              </button>
            </div>

            {/* Groq Test Feedback Card */}
            {groqTestResult && (
              <div
                className={`p-2 rounded-[2px] border text-xs flex items-start gap-2 animate-fade-in font-mono ${
                  groqTestResult.success
                    ? 'bg-[#121812] border-[#D4FF00]/40 text-[#D4FF00]'
                    : 'bg-[#1A1712] border-[#F59E0B]/50 text-[#F59E0B]'
                }`}
              >
                {groqTestResult.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#D4FF00] shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0 mt-0.5" />
                )}
                <div className="flex-1 space-y-0.5">
                  <p className="font-semibold text-[11px] leading-tight">{groqTestResult.message}</p>
                  {groqTestResult.latencyMs !== undefined && (
                    <p className="text-[10px] opacity-75">Latency: {groqTestResult.latencyMs}ms</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Model & Language Preferences */}
          <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-3 shadow-sm font-sans">
            <h3 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">Model &amp; Output Preferences</h3>

            {/* Default Model Selector */}
            <div className="space-y-1 font-mono">
              <label htmlFor="model-select" className="text-[10px] uppercase font-bold text-[#9DA5B2]">
                Active AI Model
              </label>
              <select
                id="model-select"
                value={settings.model}
                onChange={handleModelChange}
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] focus:outline-none focus:border-[#D4FF00] font-sans"
              >
                <optgroup label="Google Gemini">
                  {SUPPORTED_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Groq Cloud (Ultra Fast / Low Latency)">
                  {SUPPORTED_GROQ_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Language Selection Toggle */}
            <div className="space-y-1.5 font-mono">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-bold text-[#9DA5B2]">
                  Default Summarization Tone &amp; Language
                </label>
                <LanguageToggle
                  value={settings.language}
                  onChange={handleLanguageChange}
                  size="xs"
                  autoPersist={false}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleLanguageChange('en')}
                  className={`px-2.5 py-2 rounded-[2px] text-xs font-semibold border text-left transition-all ${
                    settings.language === 'en'
                      ? 'bg-[#20242A] border-[#D4FF00] text-[#D4FF00] shadow-sm'
                      : 'bg-[#121417] border-[#2A303A] text-[#9DA5B2] hover:text-[#FFFFFF]'
                  }`}
                >
                  <div className="font-bold">English</div>
                  <div className="text-[9px] text-[#737C8A]">Standard concise notes</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleLanguageChange('hinglish')}
                  className={`px-2.5 py-2 rounded-[2px] text-xs font-semibold border text-left transition-all ${
                    settings.language === 'hinglish'
                      ? 'bg-[#20242A] border-[#D4FF00] text-[#D4FF00] shadow-sm'
                      : 'bg-[#121417] border-[#2A303A] text-[#9DA5B2] hover:text-[#FFFFFF]'
                  }`}
                >
                  <div className="font-bold">Hinglish</div>
                  <div className="text-[9px] text-[#737C8A]">Colloquial Hindi-English</div>
                </button>
              </div>
            </div>
          </div>

          {/* Feedback Toast / Status Banner */}
          {saveStatus.type === 'saved' && (
            <div className="p-2.5 rounded-[2px] bg-[#121812] border border-[#D4FF00]/40 text-[#D4FF00] text-xs flex items-center gap-2 shadow-sm animate-fade-in font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#D4FF00] shrink-0" />
              <span>{saveStatus.message || 'Settings saved successfully!'}</span>
            </div>
          )}

          {saveStatus.type === 'error' && (
            <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs flex items-center gap-2 shadow-sm animate-fade-in font-mono">
              <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
              <span>{saveStatus.message || 'Error saving settings.'}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1 font-mono">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus.type === 'saving'}
              className="flex-1 py-1.5 px-3.5 rounded-[2px] btn-lime text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40"
            >
              {saveStatus.type === 'saving' ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-3 h-3" />
                  <span>Save Settings</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleClearKeys}
              title="Clear all stored API keys"
              className="py-1.5 px-3 rounded-[2px] btn-graphite text-xs font-semibold flex items-center justify-center gap-1.5 hover:text-[#F59E0B]"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>

          {/* Security & Privacy Guarantee */}
          <div className="p-2.5 rounded-[2px] bg-[#121417] border border-[#2A303A] text-[10px] text-[#9DA5B2] flex items-start gap-2 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-[#D4FF00] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold text-[#FFFFFF]">LOCAL-FIRST &amp; ZERO TELEMETRY</span>
              <p className="leading-relaxed font-sans text-[11px] text-[#737C8A]">
                Keys are stored in <code className="text-[#D4FF00] font-mono">chrome.storage.local</code> on your device. ASKbro never relays keys to external proxy servers.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
