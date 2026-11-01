import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Crop,
  RotateCcw,
  Check,
  X,
  Square,
  Copy,
  MessageSquare,
  Bot,
  AlertCircle,
  BarChart3,
  Table,
  AlertTriangle,
  Layout,
  Eye,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  AISettings,
  CropRect,
  OutputLanguage,
  VisionPresetType,
} from '../../../types/ai';
import {
  VISION_PRESET_LIST,
  VISION_PRESET_PROMPTS,
  streamAnalyzeScreenshot,
  cropImageDataUrl,
} from '../../../services/ai/vision';
import { requestTabScreenshot } from '../../../background/captureHandler';
import { getActiveTab, isRestrictedUrl } from '../../../services/reader';
import { isRateLimitError, getRetryAfterSeconds, formatQuotaBannerMessage } from '../../../services/ai/rateLimiter';
import LanguageToggle from '../Common/LanguageToggle';
import RateLimitBanner from '../Common/RateLimitBanner';

export interface ScreenshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AISettings;
  onLanguageChange?: (language: OutputLanguage) => void;
  onOpenSettings?: () => void;
  onAskInChat?: (query: string, visualSummary?: string) => void;
  initialDataUrl?: string | null;
}

export default function ScreenshotModal({
  isOpen,
  onClose,
  settings,
  onLanguageChange,
  onOpenSettings,
  onAskInChat,
  initialDataUrl,
}: ScreenshotModalProps) {
  const [fullScreenshot, setFullScreenshot] = useState<string | null>(initialDataUrl || null);
  const [activeImageDataUrl, setActiveImageDataUrl] = useState<string | null>(initialDataUrl || null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [activeTabInfo, setActiveTabInfo] = useState<{ title: string; url: string } | null>(null);

  // Analysis state
  const [activePreset, setActivePreset] = useState<VisionPresetType>('chart');
  const [userQuery, setUserQuery] = useState<string>(VISION_PRESET_PROMPTS.chart.prompt);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [streamingResponse, setStreamingResponse] = useState<string>('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [rateLimitInfo, setRateLimitInfo] = useState<{ seconds: number; message: string } | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Crop / Inspector state
  const [isCropMode, setIsCropMode] = useState<boolean>(false);
  const [isCropped, setIsCropped] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentSelection, setCurrentSelection] = useState<CropRect | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const resultsEndRef = useRef<HTMLDivElement | null>(null);

  const hasApiKey = Boolean(settings.geminiApiKey && settings.geminiApiKey.trim().length >= 10);

  // Snaps tab screenshot on open if not already provided
  useEffect(() => {
    if (isOpen) {
      if (!initialDataUrl) {
        handleCaptureTab();
      } else {
        setFullScreenshot(initialDataUrl);
        setActiveImageDataUrl(initialDataUrl);
      }
    } else {
      handleStopGenerating();
    }
  }, [isOpen, initialDataUrl]);

  const handleCaptureTab = async () => {
    setIsCapturing(true);
    setCaptureError(null);
    setAnalysisError(null);
    setIsCropped(false);
    setCurrentSelection(null);
    setIsCropMode(false);

    try {
      const tab = await getActiveTab();
      if (tab) {
        setActiveTabInfo({
          title: tab.title || 'Active Tab',
          url: tab.url || '',
        });

        if (isRestrictedUrl(tab.url)) {
          throw new Error(
            `Cannot capture internal browser pages (${tab.url || 'chrome://'}). Please switch to an active web page and click Try Again.`
          );
        }
      }

      const dataUrl = await requestTabScreenshot({
        format: 'png',
        windowId: tab?.windowId,
      });
      setFullScreenshot(dataUrl);
      setActiveImageDataUrl(dataUrl);
    } catch (err: any) {
      console.error('[ASKbro Vision] Capture error:', err);
      let errorMsg = err?.message || 'Could not capture active tab screen.';
      setCaptureError(errorMsg);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleSelectPreset = (presetId: VisionPresetType) => {
    setActivePreset(presetId);
    setUserQuery(VISION_PRESET_PROMPTS[presetId].prompt);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCropMode || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const y = Math.max(0, e.clientY - rect.top);

    setIsDragging(true);
    setDragStart({ x, y });
    setCurrentSelection({ x, y, width: 0, height: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const currentY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const left = Math.min(dragStart.x, currentX);
    const top = Math.min(dragStart.y, currentY);
    const width = Math.abs(currentX - dragStart.x);
    const height = Math.abs(currentY - dragStart.y);

    setCurrentSelection({ x: left, y: top, width, height });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleApplyCrop = async () => {
    if (!currentSelection || !imageContainerRef.current || !fullScreenshot) return;
    if (currentSelection.width < 10 || currentSelection.height < 10) return;

    try {
      const croppedUrl = await cropImageDataUrl(fullScreenshot, currentSelection);

      setActiveImageDataUrl(croppedUrl);
      setIsCropped(true);
      setIsCropMode(false);
      setCurrentSelection(null);
    } catch (err) {
      console.error('[ASKbro Vision] Crop error:', err);
    }
  };

  const handleResetCrop = () => {
    setActiveImageDataUrl(fullScreenshot);
    setIsCropped(false);
    setIsCropMode(false);
    setCurrentSelection(null);
  };

  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
  };

  const handleAnalyze = async () => {
    if (!activeImageDataUrl || !userQuery.trim()) return;

    if (!hasApiKey) {
      setAnalysisError('Please configure your Gemini API Key in Settings to enable visual multimodal inspection.');
      return;
    }

    setIsAnalyzing(true);
    setStreamingResponse('');
    setAnalysisError(null);
    setRateLimitInfo(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamAnalyzeScreenshot({
        imageDataUrl: activeImageDataUrl,
        query: userQuery.trim(),
        language: settings.language || 'en',
        pageTitle: activeTabInfo?.title,
        pageUrl: activeTabInfo?.url,
        apiKey: settings.geminiApiKey,
        model: settings.model,
        signal: controller.signal,
        onChunk: (_delta: string, accumulated: string) => {
          setStreamingResponse(accumulated);
          resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        },
      });
    } catch (err: any) {
      if (err.name === 'AbortError') return;

      console.error('[ASKbro Vision] Analysis error:', err);
      if (isRateLimitError(err)) {
        const retrySecs = getRetryAfterSeconds(err);
        setRateLimitInfo({
          seconds: retrySecs,
          message: formatQuotaBannerMessage(retrySecs),
        });
      } else {
        setAnalysisError(err?.message || 'Multimodal inspection failed.');
      }
    } finally {
      setIsAnalyzing(false);
      abortControllerRef.current = null;
    }
  };

  const handleCopyResult = async () => {
    if (!streamingResponse) return;
    try {
      await navigator.clipboard.writeText(streamingResponse);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleSendToChat = () => {
    if (onAskInChat) {
      onAskInChat(
        `Visual Question: ${userQuery}`,
        `### Visual Inspection Result:\n${streamingResponse}`
      );
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vision-modal-title"
    >
      {/* Top Header */}
      <header className="px-3.5 py-2.5 bg-[#121417] border-b border-[#2A303A] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#D4FF00] flex items-center justify-center">
            <Camera className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 id="vision-modal-title" className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider flex items-center gap-1.5">
              <span>Visual Screen Understanding</span>
            </h2>
            <p className="text-[9px] font-mono text-[#737C8A] truncate max-w-[220px]" title={activeTabInfo?.title}>
              {activeTabInfo?.title || 'Screen Snapshot'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCaptureTab}
            disabled={isCapturing}
            className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#181B1F] transition-colors"
            title="Recapture screen"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCapturing ? 'animate-spin text-[#D4FF00]' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#181B1F] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#0C0D0E] custom-scrollbar">
        {/* Capture Error Banner */}
        {captureError && (
          <div className="p-3 rounded-[2px] bg-[#221214] border border-[#FF5555]/40 text-[#FFFFFF] text-xs flex items-start gap-2.5 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-[#FF5555] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-mono font-bold text-xs uppercase tracking-wider text-[#FF8888]">Capture Notice</p>
              <p className="text-[11px] text-[#E0E3E8] font-sans">{captureError}</p>
              <button
                onClick={handleCaptureTab}
                className="mt-1 px-2.5 py-1 rounded-[2px] bg-[#FF5555] hover:bg-[#E04444] text-[10px] font-mono font-bold uppercase text-white transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Screenshot Preview & Crop Tool */}
        <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-2.5 space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className="font-bold text-[#737C8A] uppercase">Preview:</span>
              {isCropped ? (
                <span className="px-1.5 py-0.2 rounded-[2px] bg-[#181B1F] text-[#D4FF00] border border-[#D4FF00]/40 text-[9px] font-bold uppercase">
                  Cropped Region
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded-[2px] bg-[#0C0D0E] text-[#737C8A] border border-[#1F242C] text-[9px] font-semibold uppercase">
                  Full Screen
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {!isCropped ? (
                <button
                  type="button"
                  onClick={() => setIsCropMode(!isCropMode)}
                  className={`px-2 py-0.5 rounded-[2px] text-[10px] font-mono font-bold uppercase flex items-center gap-1 transition-all ${
                    isCropMode
                      ? 'bg-[#D4FF00] text-black shadow-sm font-semibold'
                      : 'bg-[#181B1F] hover:bg-[#22262C] text-[#E0E3E8] border border-[#2A303A]'
                  }`}
                  title="Drag on image to select a region to inspect"
                >
                  <Crop className="w-3 h-3" />
                  <span>{isCropMode ? 'Cancel' : 'Crop Area'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleResetCrop}
                  className="px-2 py-0.5 rounded-[2px] text-[10px] font-mono font-bold uppercase bg-[#181B1F] hover:bg-[#22262C] text-[#E0E3E8] border border-[#2A303A] flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Full Screen</span>
                </button>
              )}
            </div>
          </div>

          {/* Image Container with Interactive Crop Overlay */}
          <div
            ref={imageContainerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className={`relative rounded-[2px] overflow-hidden border border-[#2A303A] bg-[#050607] flex items-center justify-center min-h-[140px] max-h-[220px] select-none ${
              isCropMode ? 'cursor-crosshair' : 'cursor-default'
            }`}
          >
            {isCapturing ? (
              <div className="flex flex-col items-center gap-2 py-8 text-[#737C8A] text-xs font-mono">
                <RefreshCw className="w-5 h-5 text-[#D4FF00] animate-spin" />
                <span className="text-[10px] uppercase tracking-wider text-[#D4FF00]">Capturing viewport...</span>
              </div>
            ) : activeImageDataUrl ? (
              <>
                <img
                  ref={imageElementRef}
                  src={activeImageDataUrl}
                  alt="Captured Tab Screen"
                  className="w-full h-auto max-h-[220px] object-contain pointer-events-none"
                  draggable={false}
                />

                {isCropMode && currentSelection && currentSelection.width > 2 && currentSelection.height > 2 && (
                  <div
                    className="absolute border-2 border-[#D4FF00] bg-[#D4FF00]/15 pointer-events-none transition-none shadow-sm"
                    style={{
                      left: `${currentSelection.x}px`,
                      top: `${currentSelection.y}px`,
                      width: `${currentSelection.width}px`,
                      height: `${currentSelection.height}px`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 px-1 py-0.2 rounded-[1px] bg-[#D4FF00] text-black text-[9px] font-mono font-bold uppercase shadow-sm">
                      {Math.round(currentSelection.width)} × {Math.round(currentSelection.height)}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-[#5A6372] font-mono text-xs py-8 uppercase">No screen snapshot available</div>
            )}
          </div>

          {/* Crop Instructions & Apply Action */}
          {isCropMode && (
            <div className="flex items-center justify-between p-2 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] text-xs animate-fade-in">
              <span className="text-[10px] text-[#9BA3AF] font-mono">
                Drag a box over the chart, table, or error to crop.
              </span>
              <button
                type="button"
                onClick={handleApplyCrop}
                disabled={!currentSelection || currentSelection.width < 10 || currentSelection.height < 10}
                className="px-2 py-0.5 rounded-[2px] bg-[#D4FF00] hover:bg-[#BCE600] disabled:opacity-40 text-black text-[10px] font-mono font-bold uppercase flex items-center gap-1 transition-colors shadow-sm"
              >
                <Check className="w-3 h-3" />
                <span>Apply Crop</span>
              </button>
            </div>
          )}
        </div>

        {/* Preset Visual Prompts */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-[#737C8A] px-1 font-mono uppercase tracking-wider">
            <span className="font-bold">Analysis Presets</span>
            <span className="text-[9px]">Select target</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {VISION_PRESET_LIST.map((preset) => {
              const isSelected = activePreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.id)}
                  className={`p-2 rounded-[2px] text-left border text-xs transition-all flex items-start gap-2 ${
                    isSelected
                      ? 'bg-[#181B1F] border-[#D4FF00] text-[#FFFFFF] shadow-sm'
                      : 'bg-[#121417] hover:bg-[#181B1F] border-[#2A303A] text-[#9BA3AF]'
                  }`}
                >
                  <div className={`p-1 rounded-[2px] shrink-0 mt-0.5 ${
                    isSelected ? 'bg-[#D4FF00] text-black font-semibold' : 'bg-[#0C0D0E] text-[#D4FF00] border border-[#2A303A]'
                  }`}>
                    {preset.id === 'chart' && <BarChart3 className="w-3 h-3" />}
                    {preset.id === 'table' && <Table className="w-3 h-3" />}
                    {preset.id === 'error' && <AlertTriangle className="w-3 h-3" />}
                    {preset.id === 'ui' && <Layout className="w-3 h-3" />}
                    {preset.id === 'general' && <Eye className="w-3 h-3" />}
                  </div>
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-[10px] uppercase tracking-wide block truncate text-[#FFFFFF]">{preset.label}</span>
                    <span className="text-[9px] text-[#737C8A] font-mono leading-tight block truncate">
                      {preset.description}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Query Input Area */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-[#737C8A] px-1 font-mono uppercase tracking-wider">
            <label htmlFor="vision-prompt-input" className="font-bold">
              Prompt Instructions:
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-[#5A6372]">Language:</span>
              <LanguageToggle
                value={settings.language}
                onChange={(newLang) => onLanguageChange?.(newLang)}
                size="xs"
                showIcon={false}
              />
            </div>
          </div>

          <div className="bg-[#121417] border border-[#2A303A] rounded-[2px] p-2 focus-within:border-[#D4FF00] transition-colors">
            <textarea
              id="vision-prompt-input"
              rows={2}
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              disabled={isAnalyzing}
              placeholder="Ask anything about the visual content in this screen..."
              className="w-full bg-transparent text-xs text-[#FFFFFF] placeholder-[#5A6372] resize-none outline-none leading-relaxed font-mono"
            />

            <div className="flex items-center justify-between pt-1.5 border-t border-[#1F242C] text-[9px] font-mono text-[#5A6372]">
              <span>Interprets charts, tables, diagrams, and error text</span>
              {isAnalyzing ? (
                <button
                  type="button"
                  onClick={handleStopGenerating}
                  className="px-2 py-0.5 rounded-[2px] bg-[#221214] hover:bg-[#2E181B] text-[#FF8888] border border-[#FF5555]/40 text-[9px] font-mono font-bold uppercase flex items-center gap-1 transition-colors shadow-sm"
                >
                  <Square className="w-2.5 h-2.5 fill-[#FF8888]" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={!activeImageDataUrl || !userQuery.trim() || !hasApiKey}
                  className="px-3 py-1 rounded-[2px] bg-[#D4FF00] hover:bg-[#BCE600] disabled:bg-[#181B1F] disabled:text-[#5A6372] text-black font-mono font-bold text-[10px] uppercase flex items-center gap-1.5 shadow-sm transition-all disabled:shadow-none disabled:cursor-not-allowed"
                >
                  <Search className="w-3 h-3 text-black stroke-[2.5]" />
                  <span>Inspect Screen</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Free-Tier Rate Limit Quota Banner */}
        {rateLimitInfo && (
          <RateLimitBanner
            initialSeconds={rateLimitInfo.seconds}
            message={rateLimitInfo.message}
            isMultimodal={true}
            onOpenSettings={onOpenSettings}
            onRetry={handleAnalyze}
            onDismiss={() => setRateLimitInfo(null)}
          />
        )}

        {/* Analysis Stream Results */}
        {(streamingResponse || isAnalyzing || analysisError) && (
          <div className="rounded-[2px] bg-[#121417] border border-[#2A303A] p-3 space-y-2 shadow-sm animate-fade-in">
            <div className="flex items-center justify-between pb-2 border-b border-[#2A303A] text-xs">
              <div className="flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-[#D4FF00]" />
                <span className="font-mono font-bold text-xs uppercase tracking-wider text-[#FFFFFF]">Visual Analysis</span>
                {isAnalyzing && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D4FF00] animate-pulse ml-1" />
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {streamingResponse && (
                  <>
                    <button
                      onClick={handleCopyResult}
                      className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#181B1F] transition-colors"
                      title="Copy response"
                    >
                      {isCopied ? <Check className="w-3 h-3 text-[#D4FF00]" /> : <Copy className="w-3 h-3" />}
                    </button>

                    {onAskInChat && (
                      <button
                        onClick={handleSendToChat}
                        className="px-2 py-0.5 rounded-[2px] bg-[#181B1F] hover:bg-[#22262C] text-[#D4FF00] hover:text-[#BCE600] text-[9px] font-mono font-bold uppercase flex items-center gap-1 border border-[#2A303A] transition-colors"
                        title="Send analysis to Page Chat for follow-up questions"
                      >
                        <MessageSquare className="w-2.5 h-2.5" />
                        <span>Discuss in Chat</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {analysisError ? (
              <div className="text-xs text-[#FF8888] p-2 rounded-[2px] bg-[#221214] border border-[#FF5555]/40 font-mono">
                {analysisError}
              </div>
            ) : (
              <div className="text-xs text-[#E0E3E8] whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto pr-1 font-sans custom-scrollbar">
                {streamingResponse || 'Inspecting visual screen elements...'}
                {isAnalyzing && (
                  <span className="inline-block w-1.5 h-3 ml-1 bg-[#D4FF00] animate-pulse align-middle" />
                )}
                <div ref={resultsEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="px-3.5 py-2 bg-[#0C0D0E] border-t border-[#1F242C] text-[9px] font-mono text-[#5A6372] flex items-center justify-between shrink-0 uppercase tracking-wider">
        <span>Grounded visual OCR & multimodal reasoning</span>
        <button
          onClick={onClose}
          className="text-[#9BA3AF] hover:text-[#FFFFFF] uppercase transition-colors"
        >
          Close
        </button>
      </footer>
    </div>
  );
}
