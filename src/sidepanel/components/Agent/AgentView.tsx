import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Play,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ListOrdered,
  History,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Loader2,
  Square,
  Crosshair,
  ExternalLink,
  Download,
  FileText,
  Terminal,
} from 'lucide-react';
import type {
  ActionStep,
  ActionableElement,
  CompactActionElement,
  ActionHistoryEntry,
  AgentTaskSession,
} from '../../../types/action';
import type { AISettings, OutputLanguage } from '../../../types/ai';
import {
  scanTabActionMap,
  highlightTabElement,
  clearTabBadges,
  executeTabAction,
} from '../../../services/ai/actionMap';
import { predictNextAction } from '../../../services/ai/schemas';
import { getActiveTab, isRestrictedUrl } from '../../../services/reader';
import { checkDomainSafety } from '../../../services/safety/domainGuard';
import {
  saveAgentSession,
  getAgentSession,
  clearAgentSession,
  recordAuditLogEntry,
  getAuditLog,
  exportAuditLogAsJson,
} from '../../../background/stateManager';
import { getProfile, planFormFillFromProfile } from '../../../services/storage/profileStore';
import ActionCard from './ActionCard';
import LanguageToggle from '../Common/LanguageToggle';

export interface AgentViewProps {
  settings: AISettings;
  onOpenSettings?: () => void;
  onOpenHistory?: () => void;
  onLanguageChange?: (language: OutputLanguage) => void;
  initialGoal?: string | null;
  onClearInitialGoal?: () => void;
  className?: string;
}

const QUICK_GOALS = [
  'Fill this form from my profile',
  'Find the search bar and type something',
  'Locate login or sign up button',
  'Scroll down to explore page content',
  'Find pricing or subscription plans',
];

export default function AgentView({
  settings,
  onOpenSettings,
  onOpenHistory,
  onLanguageChange,
  initialGoal = null,
  onClearInitialGoal,
  className = '',
}: AgentViewProps) {
  const [taskId, setTaskId] = useState<string>('');
  const [goal, setGoal] = useState<string>(initialGoal || '');
  const [status, setStatus] = useState<
    'idle' | 'scanning' | 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'aborted' | 'error'
  >('idle');
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [maxSteps, setMaxSteps] = useState<number>(10);
  const [pendingStep, setPendingStep] = useState<ActionStep | null>(null);
  const [matchedElement, setMatchedElement] = useState<ActionableElement | CompactActionElement | null>(null);
  const [currentActionMap, setCurrentActionMap] = useState<ActionableElement[]>([]);
  const [history, setHistory] = useState<ActionHistoryEntry[]>([]);
  const [skippedElementIds, setSkippedElementIds] = useState<number[]>([]);
  const [isDryRunning, setIsDryRunning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(false);
  const [tabInfo, setTabInfo] = useState<{ id?: number; title: string; url: string; isRestricted?: boolean } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const hasApiKey = Boolean(settings.geminiApiKey && settings.geminiApiKey.trim().length >= 10);

  // Domain Guard evaluation (Slice 4.3)
  const domainSafety = checkDomainSafety(tabInfo?.url);
  const isDomainBlocked = domainSafety.isBlocked;

  // Sync initial goal if passed
  useEffect(() => {
    if (initialGoal && initialGoal.trim()) {
      setGoal(initialGoal);
      onClearInitialGoal?.();
    }
  }, [initialGoal]);

  // Load active tab info on mount
  useEffect(() => {
    refreshTabInfo();
  }, []);

  // Rehydration from chrome.storage.session across Worker Hibernation
  useEffect(() => {
    rehydrateSession();
  }, []);

  const rehydrateSession = async () => {
    try {
      const saved = await getAgentSession();
      if (saved && (saved.status === 'awaiting_approval' || saved.status === 'planning' || saved.status === 'scanning')) {
        setTaskId(saved.taskId);
        setGoal(saved.goal);
        setStatus(saved.status);
        setCurrentStepIndex(saved.currentStepIndex);
        setMaxSteps(saved.maxSteps);
        if (saved.pendingStep) {
          setPendingStep({
            ...saved.pendingStep,
            targetElementId: saved.pendingStep.targetElementId ?? saved.pendingStep.targetId ?? null,
          });
        } else {
          setPendingStep(null);
        }
        setMatchedElement(saved.pendingElement);
        setHistory(saved.history || []);
        setSkippedElementIds(saved.skippedElementIds || []);
      }
    } catch (err) {
      console.warn('[ASKbro AgentView] Session rehydration failed:', err);
    }
  };

  const refreshTabInfo = async () => {
    try {
      const tab = await getActiveTab();
      if (tab) {
        setTabInfo({
          id: tab.id,
          title: tab.title || '',
          url: tab.url || '',
          isRestricted: isRestrictedUrl(tab.url),
        });
      }
    } catch {
      // ignore
    }
  };

  /**
   * Starts an agent execution session
   */
  const handleStartTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanGoal = goal.trim();
    if (!cleanGoal || !hasApiKey || isDomainBlocked) return;

    const newTaskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setTaskId(newTaskId);
    setStatus('scanning');
    setCurrentStepIndex(1);
    setHistory([]);
    setSkippedElementIds([]);
    setErrorMessage(null);

    await saveAgentSession({
      taskId: newTaskId,
      goal: cleanGoal,
      status: 'scanning',
      currentStepIndex: 1,
      maxSteps,
      pendingStep: null,
      pendingElement: null,
      tabId: tabInfo?.id ?? null,
      tabUrl: tabInfo?.url ?? null,
      tabTitle: tabInfo?.title ?? null,
      history: [],
      skippedElementIds: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }).catch(() => {});

    runAgentCycle(1, cleanGoal, newTaskId, []);
  };

  /**
   * Main iterative agent loop step
   */
  const runAgentCycle = async (
    stepNumber: number,
    currentGoal: string,
    activeTaskId: string,
    currentSkipped: number[]
  ) => {
    setStatus('scanning');
    setErrorMessage(null);

    try {
      // 1. Scan page to build interactive action map and attach Shadow DOM badges
      const scanRes = await scanTabActionMap(tabInfo?.id);
      const actionMap = scanRes?.elements || [];
      if (!actionMap.length) {
        throw new Error('Failed to scan actionable page elements.');
      }

      setCurrentActionMap(actionMap);

      // Check if user has an Autofill Profile intent and pre-plan from store
      if (/fill|profile|apply|form|resume/i.test(currentGoal)) {
        const profile = await getProfile().catch(() => null);
        if (profile) {
          const profilePlan = planFormFillFromProfile(actionMap, profile);
          if (profilePlan) {
            const matchingElem = actionMap.find((el: ActionableElement) => el.id === profilePlan.targetId) || null;
            setPendingStep(profilePlan);
            setMatchedElement(matchingElem);
            setStatus('awaiting_approval');
            return;
          }
        }
      }

      // 2. Formulate next step with Gemini structured prediction
      setStatus('planning');
      const filteredElements = actionMap.filter((el: ActionableElement) => !currentSkipped.includes(el.id));

      const predicted = await predictNextAction({
        goal: currentGoal,
        actionMap: filteredElements,
        pageMeta: { title: tabInfo?.title, url: tabInfo?.url },
        apiKey: settings.geminiApiKey,
        model: settings.model,
        language: settings.language,
      });

      const matched = actionMap.find((el: ActionableElement) => el.id === predicted.targetId) || null;

      setPendingStep(predicted);
      setMatchedElement(matched);
      setStatus('awaiting_approval');

      await saveAgentSession({
        taskId: activeTaskId,
        goal: currentGoal,
        status: 'awaiting_approval',
        currentStepIndex: stepNumber,
        maxSteps,
        pendingStep: predicted,
        pendingElement: matched,
        tabId: tabInfo?.id ?? null,
        tabUrl: tabInfo?.url ?? null,
        tabTitle: tabInfo?.title ?? null,
        history,
        skippedElementIds: currentSkipped,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      }).catch(() => {});
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Agent cycle failed to complete.');
    }
  };

  /**
   * User approves the pending step
   */
  const handleApprove = async (stepToExecute: ActionStep) => {
    if (!stepToExecute) return;
    setStatus('executing');

    const historyEntry: ActionHistoryEntry = {
      stepNumber: currentStepIndex,
      action: stepToExecute.action,
      targetId: stepToExecute.targetId,
      value: stepToExecute.value,
      reason: stepToExecute.reason,
      status: 'approved',
      executedAt: Date.now(),
    };

    const nextHistory = [...history, historyEntry];
    setHistory(nextHistory);

    try {
      // Dispatch action strictly through verified content script bridge
      const execRes = await executeTabAction(stepToExecute, tabInfo?.id);

      await recordAuditLogEntry(
        {
          ...historyEntry,
          status: execRes.success ? 'completed' : 'failed',
          error: execRes.error,
        },
        { taskId, goal, tabId: tabInfo?.id, tabUrl: tabInfo?.url, tabTitle: tabInfo?.title }
      );

      if (!execRes.success) {
        throw new Error(execRes.error || 'Content action execution failed.');
      }

      if (stepToExecute.action === 'done') {
        setStatus('completed');
        await clearTabBadges(tabInfo?.id);
        return;
      }

      // Check max steps loop limit
      if (currentStepIndex >= maxSteps) {
        setStatus('idle');
        setErrorMessage(`Loop prevention triggered: Max steps limit (${maxSteps}) reached.`);
        await clearTabBadges(tabInfo?.id);
        return;
      }

      const nextStepIndex = currentStepIndex + 1;
      setCurrentStepIndex(nextStepIndex);
      setPendingStep(null);
      setMatchedElement(null);

      // Next iteration with brief delay for DOM stability
      setTimeout(() => {
        runAgentCycle(nextStepIndex, goal, taskId, skippedElementIds);
      }, 700);
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'Execution error encountered on page.');
    }
  };

  /**
   * Dry run outline preview of target element
   */
  const handleDryRun = async (targetId: number | null) => {
    if (targetId === null) return;
    setIsDryRunning(true);
    try {
      await highlightTabElement(targetId, tabInfo?.id);
    } finally {
      setTimeout(() => setIsDryRunning(false), 2000);
    }
  };

  /**
   * Skip current element and formulate alternative
   */
  const handleSkip = async (targetId: number | null) => {
    const updatedSkipped = targetId !== null ? [...skippedElementIds, targetId] : skippedElementIds;
    setSkippedElementIds(updatedSkipped);

    if (pendingStep) {
      const skipEntry: ActionHistoryEntry = {
        stepNumber: currentStepIndex,
        action: pendingStep.action,
        targetId: pendingStep.targetId,
        value: pendingStep.value,
        reason: 'User requested alternative element',
        status: 'skipped',
        executedAt: Date.now(),
      };
      setHistory((prev) => [...prev, skipEntry]);
    }

    runAgentCycle(currentStepIndex, goal, taskId, updatedSkipped);
  };

  /**
   * Stop / halt agent execution immediately
   */
  const handleStop = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStatus('aborted');

    if (pendingStep) {
      await recordAuditLogEntry(
        {
          stepNumber: currentStepIndex,
          action: pendingStep.action,
          targetId: pendingStep.targetId,
          value: pendingStep.value,
          reason: 'User halted agent task execution',
          status: 'stopped',
          executedAt: Date.now(),
        },
        { taskId, goal, tabId: tabInfo?.id, tabUrl: tabInfo?.url, tabTitle: tabInfo?.title }
      );
    }

    await saveAgentSession({
      taskId,
      goal,
      status: 'aborted',
      currentStepIndex,
      maxSteps,
      pendingStep: null,
      pendingElement: null,
      tabId: tabInfo?.id ?? null,
      tabUrl: tabInfo?.url ?? null,
      tabTitle: tabInfo?.title ?? null,
      history,
      skippedElementIds,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }).catch(() => {});

    setPendingStep(null);
    setMatchedElement(null);
    await clearTabBadges(tabInfo?.id);
  };

  /**
   * Reset session back to idle
   */
  const handleReset = async () => {
    setStatus('idle');
    setGoal('');
    setTaskId('');
    setPendingStep(null);
    setMatchedElement(null);
    setHistory([]);
    setSkippedElementIds([]);
    setCurrentStepIndex(0);
    setErrorMessage(null);
    await clearAgentSession();
    await clearTabBadges(tabInfo?.id);
  };

  /**
   * Export audit log as formatted JSON file
   */
  const handleExportAuditLog = async () => {
    try {
      const json = await exportAuditLogAsJson(taskId);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `askbro-audit-${taskId || 'session'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[ASKbro AgentView] Failed to export audit log:', err);
    }
  };

  return (
    <div className={`flex flex-col h-full space-y-2.5 p-3 text-[#E0E3E8] bg-[#0C0D0E] font-sans ${className}`}>
      {/* Agent Header — Hardware Console Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#2A303A]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#D4FF00] flex items-center justify-center shadow-sm">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider flex items-center gap-1.5">
              <span>Browser Agent</span>
              {isDomainBlocked ? (
                <span
                  className="text-[9px] font-mono font-bold text-[#F59E0B] bg-[#2A1E0B] border border-[#F59E0B]/50 px-1.5 py-0.2 rounded-[2px] flex items-center gap-1"
                  data-testid="askbro-domain-guard-badge"
                >
                  <ShieldAlert className="w-2.5 h-2.5" />
                  <span>Protected Domain ({domainSafety.matchedKeyword?.toUpperCase()})</span>
                </span>
              ) : (
                <span className="text-[9px] font-mono font-bold text-[#D4FF00] bg-[#121417] border border-[#D4FF00]/40 px-1.5 py-0.2 rounded-[2px]">
                  HITL Controlled
                </span>
              )}
            </h2>
            <p className="text-[9px] text-[#737C8A] font-mono">Under strict human review at every step</p>
          </div>
        </div>

        {onLanguageChange && (
          <LanguageToggle
            value={settings.language}
            onChange={onLanguageChange}
            size="xs"
            showIcon={false}
          />
        )}
      </div>

      {/* API Key Missing Callout */}
      {!hasApiKey && (
        <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs space-y-2 animate-fade-in">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#C2C7D0] leading-relaxed">Connect your Gemini API key to activate the controlled agent loop.</p>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="py-1 px-2.5 rounded-[2px] btn-lime font-mono text-[11px] shadow-sm"
            >
              Configure API Key
            </button>
          )}
        </div>
      )}

      {/* Domain Guard Protective Banner (Slice 4.3) */}
      {isDomainBlocked && (
        <div
          className="p-3 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs space-y-1 shadow-sm font-sans"
          data-testid="askbro-domain-guard-banner"
        >
          <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] text-[#F59E0B] uppercase">
            <ShieldAlert className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
            <span>Protected Domain Guardrail Active</span>
          </div>
          <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
            {domainSafety.reason ||
              'Banking, payment, and checkout pages are restricted to prevent unauthorized transactions.'}
          </p>
        </div>
      )}

      {/* Task Input Section (when idle, completed, or aborted) */}
      {(status === 'idle' || status === 'completed' || status === 'aborted') && (
        <div className="space-y-2.5 bg-[#181B1F] border border-[#2A303A] rounded-[2px] p-3 shadow-sm font-sans">
          <form onSubmit={handleStartTask} className="space-y-2.5">
            <div>
              <label className="block text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider mb-1">
                Mission Goal &amp; Directives:
              </label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={
                  settings.language === 'hinglish'
                    ? 'E.g., Search bar me laptop search karo, ya sign up button find karo...'
                    : 'E.g., Fill the job application, click the pricing tab, or find the submit button...'
                }
                rows={2}
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 resize-none font-sans"
              />
            </div>

            {/* Quick Suggestion Chips */}
            <div className="space-y-1">
              <span className="text-[9px] uppercase font-mono tracking-wider font-bold text-[#737C8A]">
                Quick Prompts:
              </span>
              <div className="flex flex-wrap gap-1">
                {QUICK_GOALS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setGoal(q)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-[2px] bg-[#121417] hover:bg-[#20242A] text-[#9DA5B2] hover:text-[#FFFFFF] border border-[#2A303A] hover:border-[#343B45] transition-all text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-[#22262E] font-mono">
              <div className="flex items-center gap-1.5 text-xs text-[#9DA5B2]">
                <span className="text-[10px] uppercase text-[#737C8A]">Max Steps:</span>
                <span className="text-[#D4FF00] font-bold">{maxSteps}</span>
              </div>

              <button
                type="submit"
                disabled={!goal.trim() || !hasApiKey || isDomainBlocked}
                className="py-1.5 px-3 rounded-[2px] btn-lime font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
                title={
                  isDomainBlocked
                    ? 'Automation is disabled on protected banking/payment domains'
                    : 'Start Agent Task'
                }
                data-testid="askbro-btn-start-task"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Start Agent Task</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Progress / Loading Spinner when Scanning or Planning */}
      {(status === 'scanning' || status === 'planning') && (
        <div className="p-5 rounded-[2px] bg-[#181B1F] border border-[#2A303A] flex flex-col items-center justify-center text-center space-y-2.5 shadow-sm animate-fade-in font-sans">
          <Loader2 className="w-6 h-6 text-[#D4FF00] animate-spin" />
          <div className="space-y-0.5">
            <h3 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
              {status === 'scanning' ? 'Scanning Interactive Elements...' : 'Formulating Next Step...'}
            </h3>
            <p className="text-[11px] text-[#9DA5B2] max-w-[260px] font-mono">
              {status === 'scanning'
                ? 'Assigning numbered badges in closed Shadow DOM overlay.'
                : 'Evaluating action map with Gemini structured output.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleStop}
            className="text-[11px] font-mono text-[#F59E0B] hover:underline pt-0.5"
          >
            Cancel Task
          </button>
        </div>
      )}

      {/* Human-in-the-Loop Action Approval Card (Slice 3.4) */}
      {status === 'awaiting_approval' && pendingStep && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs px-0.5 font-mono">
            <span className="font-semibold text-[#D4FF00] flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
              <ShieldCheck className="w-3 h-3 text-[#D4FF00]" />
              <span>Human Approval Required</span>
            </span>
            <span className="text-[10px] text-[#737C8A] truncate max-w-[150px]" title={goal}>
              Goal: {goal}
            </span>
          </div>

          <ActionCard
            step={pendingStep}
            element={matchedElement}
            onApprove={handleApprove}
            onDryRun={handleDryRun}
            onSkip={handleSkip}
            onStop={handleStop}
            currentStep={currentStepIndex}
            maxSteps={maxSteps}
            onMaxStepsChange={(newMax) => setMaxSteps(newMax)}
            isDryRunning={isDryRunning}
            error={errorMessage}
          />
        </div>
      )}

      {/* Completed State */}
      {status === 'completed' && (
        <div className="p-3.5 rounded-[2px] bg-[#121812] border border-[#D4FF00]/40 space-y-2.5 text-center shadow-sm animate-fade-in font-sans">
          <div className="w-7 h-7 rounded-[2px] bg-[#181B1F] border border-[#D4FF00]/40 flex items-center justify-center text-[#D4FF00] mx-auto">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">Task Completed Successfully!</h3>
            <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
              Agent achieved goal in {history.filter((h) => h.status === 'approved' || h.status === 'completed').length} executed steps.
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="py-1 px-3 rounded-[2px] btn-lime text-xs font-bold font-mono shadow-sm"
          >
            Start New Task
          </button>
        </div>
      )}

      {/* Aborted State */}
      {status === 'aborted' && (
        <div className="p-3.5 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2 text-center shadow-sm animate-fade-in font-sans">
          <h3 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">Agent Task Stopped</h3>
          <p className="text-[11px] text-[#9DA5B2]">Badges removed and execution halted safely.</p>
          <button
            type="button"
            onClick={handleReset}
            className="py-1 px-3 rounded-[2px] btn-graphite text-xs font-mono font-semibold"
          >
            Reset
          </button>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && status !== 'awaiting_approval' && (
        <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs space-y-1 animate-fade-in font-sans">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#FFFFFF] font-mono">Execution Notice</span>
              <p className="text-[11px] text-[#C2C7D0] leading-relaxed">{errorMessage}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-[10px] font-mono text-[#F59E0B] hover:underline pt-0.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Execution Audit Log / History */}
      {history.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-[#2A303A] font-mono">
          <div className="flex items-center justify-between text-xs text-[#9DA5B2]">
            <button
              type="button"
              onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
              className="flex items-center gap-1.5 hover:text-[#FFFFFF] transition-colors"
            >
              <History className="w-3 h-3 text-[#D4FF00]" />
              <span className="text-[11px]">Audit Trail ({history.length})</span>
              {isHistoryExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            <div className="flex items-center gap-1">
              {onOpenHistory && (
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="flex items-center gap-1 text-[10px] text-[#D4FF00] hover:text-[#FFFFFF] transition-colors px-1.5 py-0.5 rounded-[2px] hover:bg-[#20242A]"
                  title="View full persistent activity history"
                >
                  <span>FULL HISTORY</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleExportAuditLog}
                className="flex items-center gap-1 text-[10px] text-[#9DA5B2] hover:text-[#FFFFFF] transition-colors px-1.5 py-0.5 rounded-[2px] hover:bg-[#20242A]"
                title="Export audit trail as JSON"
              >
                <Download className="w-2.5 h-2.5" />
                <span>EXPORT</span>
              </button>
            </div>
          </div>

          {isHistoryExpanded && (
            <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
              {history.map((entry, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded-[2px] bg-[#121417] border border-[#22262E] text-[10px] flex items-center justify-between gap-2 shadow-sm font-mono"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-[#D4FF00] font-bold">#{entry.stepNumber}</span>
                    <span className="font-bold uppercase text-[9px] px-1 py-0.2 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#FFFFFF]">
                      {entry.action}
                    </span>
                    {entry.targetId !== null && (
                      <span className="text-[#9DA5B2]">#{entry.targetId}</span>
                    )}
                    <span className="text-[#737C8A] truncate font-sans">&ldquo;{entry.reason}&rdquo;</span>
                  </div>

                  <span
                    className={`text-[9px] font-bold uppercase px-1 py-0.2 rounded-[2px] shrink-0 ${
                      entry.status === 'completed' || entry.status === 'approved'
                        ? 'bg-[#142000] text-[#D4FF00] border border-[#D4FF00]/40'
                        : entry.status === 'skipped'
                        ? 'bg-[#2A1E0B] text-[#F59E0B] border border-[#F59E0B]/40'
                        : 'bg-[#1F1814] text-[#E0E3E8] border border-[#343B45]'
                    }`}
                  >
                    {entry.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
