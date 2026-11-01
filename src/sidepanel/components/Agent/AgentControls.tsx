import React from 'react';
import {
  CheckCircle2,
  Eye,
  SkipForward,
  Square,
  AlertTriangle,
  Plus,
  Minus,
  Sparkles,
  ShieldAlert,
  Loader2,
} from 'lucide-react';

export interface AgentControlsProps {
  /** Callback when user approves the pending action */
  onApprove: () => void | Promise<void>;
  /** Callback when user requests a dry-run highlight of the target element */
  onDryRun?: () => void | Promise<void>;
  /** Callback when user skips the current step and requests an alternative */
  onSkip?: () => void | Promise<void>;
  /** Callback when user aborts the agent task immediately */
  onStop: () => void | Promise<void>;
  /** Current step number (1-indexed) */
  currentStep?: number;
  /** Maximum allowable steps to prevent infinite loops (default: 10) */
  maxSteps?: number;
  /** Callback when user updates max steps limit */
  onMaxStepsChange?: (newMax: number) => void;
  /** Whether the pending step is flagged as consequential / high-stakes */
  isConsequential?: boolean;
  /** Whether an action is currently executing in the content script */
  isExecuting?: boolean;
  /** Whether the dry-run element highlight is actively pulsing */
  isDryRunning?: boolean;
  /** Global disabled state */
  disabled?: boolean;
  /** Whether the pending action is 'done' (completing the task) */
  isDoneAction?: boolean;
  /** Whether to show the step counter header */
  showStepCounter?: boolean;
  /** Custom additional CSS classes */
  className?: string;
}

/**
 * ASKbro Industrial Human-in-the-Loop (HITL) Execution Console
 * High-precision action sequencer and confirmation controls.
 */
export default function AgentControls({
  onApprove,
  onDryRun,
  onSkip,
  onStop,
  currentStep = 1,
  maxSteps = 10,
  onMaxStepsChange,
  isConsequential = false,
  isExecuting = false,
  isDryRunning = false,
  disabled = false,
  isDoneAction = false,
  showStepCounter = true,
  className = '',
}: AgentControlsProps) {
  const isLoopLimitReached = currentStep > maxSteps;

  const handleIncrementMax = () => {
    if (onMaxStepsChange && maxSteps < 50) {
      onMaxStepsChange(maxSteps + 5);
    }
  };

  const handleDecrementMax = () => {
    if (onMaxStepsChange && maxSteps > 5) {
      onMaxStepsChange(Math.max(5, maxSteps - 5));
    }
  };

  return (
    <div
      className={`space-y-2.5 p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] shadow-sm font-sans ${className}`}
      data-testid="askbro-agent-controls"
    >
      {/* Step Counter & Loop Prevention Header */}
      {showStepCounter && (
        <div className="flex items-center justify-between text-xs pb-2 border-b border-[#2A303A] font-mono">
          <div className="flex items-center gap-2">
            <span className="text-[#E0E3E8] font-medium">
              Step <span className="text-[#D4FF00] font-bold">#{currentStep}</span> of{' '}
              <span className="text-[#9DA5B2]">{maxSteps}</span>
            </span>
            {isLoopLimitReached && (
              <span className="flex items-center gap-1 text-[9px] font-bold text-[#F59E0B] bg-[#2A1E0B] border border-[#F59E0B]/50 px-1.5 py-0.2 rounded-[2px]">
                <AlertTriangle className="w-2.5 h-2.5 text-[#F59E0B]" />
                LIMIT REACHED
              </span>
            )}
          </div>

          {/* Configurable Max Steps Adjuster */}
          {onMaxStepsChange && (
            <div className="flex items-center gap-1.5 text-[11px] text-[#9DA5B2]">
              <span className="text-[9px] uppercase tracking-wider text-[#737C8A] font-bold">LIMIT:</span>
              <div className="flex items-center rounded-[2px] bg-[#121417] border border-[#2A303A] overflow-hidden">
                <button
                  type="button"
                  onClick={handleDecrementMax}
                  disabled={disabled || maxSteps <= 5}
                  className="px-1.5 py-0.5 hover:bg-[#20242A] text-[#E0E3E8] disabled:opacity-30 transition-colors"
                  title="Decrease max steps limit"
                  aria-label="Decrease max steps"
                >
                  <Minus className="w-2.5 h-2.5" />
                </button>
                <span className="px-2 font-mono text-[11px] font-bold text-[#FFFFFF] min-w-[20px] text-center">
                  {maxSteps}
                </span>
                <button
                  type="button"
                  onClick={handleIncrementMax}
                  disabled={disabled || maxSteps >= 50}
                  className="px-1.5 py-0.5 hover:bg-[#20242A] text-[#E0E3E8] disabled:opacity-30 transition-colors"
                  title="Increase max steps limit"
                  aria-label="Increase max steps"
                >
                  <Plus className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loop Limit Alert */}
      {isLoopLimitReached && (
        <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs flex items-start gap-2 animate-fade-in font-sans">
          <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-[#FFFFFF]">Maximum execution steps reached ({maxSteps})</p>
            <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
              Approval paused to prevent runaway loops. Increase limit above or stop the agent.
            </p>
          </div>
        </div>
      )}

      {/* Primary Action Buttons */}
      <div className="grid grid-cols-2 gap-2 font-mono">
        {/* Approve & Execute Button (Strict HITL Trigger) */}
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled || isExecuting || isLoopLimitReached}
          className={`col-span-2 py-2 px-3.5 rounded-[2px] font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-sm ${
            isConsequential
              ? 'bg-[#F59E0B] hover:bg-[#FBBF24] text-[#0C0D0E] border border-[#F59E0B] animate-pulse shadow-amber-glow'
              : 'btn-lime'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
          title={
            isLoopLimitReached
              ? 'Increase max steps to approve'
              : isConsequential
              ? 'Approve consequential/high-risk step'
              : 'Execute action on web page'
          }
          data-testid="askbro-btn-approve"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Executing Step...</span>
            </>
          ) : isDoneAction ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Finish & Complete Task</span>
            </>
          ) : isConsequential ? (
            <>
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Approve Consequential Step</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Approve & Execute</span>
            </>
          )}
        </button>

        {/* Dry Run Button (Preview / Element Highlight Only) */}
        <button
          type="button"
          onClick={onDryRun}
          disabled={disabled || isExecuting || isDoneAction}
          className={`py-1.5 px-3 rounded-[2px] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border ${
            isDryRunning
              ? 'bg-[#181B1F] border-[#D4FF00] text-[#D4FF00] shadow-lime-glow'
              : 'btn-graphite'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
          title="Highlight element outline and badge on the page without clicking or typing"
          data-testid="askbro-btn-dry-run"
        >
          {isDryRunning ? (
            <>
              <Sparkles className="w-3 h-3 text-[#D4FF00] animate-pulse" />
              <span>Outlining...</span>
            </>
          ) : (
            <>
              <Eye className="w-3 h-3 text-[#9DA5B2]" />
              <span>Dry Run</span>
            </>
          )}
        </button>

        {/* Skip Step Button */}
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled || isExecuting}
          className="py-1.5 px-3 rounded-[2px] btn-graphite text-xs font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
          title="Skip this element and ask the agent for an alternative action"
          data-testid="askbro-btn-skip"
        >
          <SkipForward className="w-3 h-3 text-[#9DA5B2]" />
          <span>Skip Step</span>
        </button>

        {/* Stop / Abort Agent Task Button */}
        <button
          type="button"
          onClick={onStop}
          disabled={disabled && !isExecuting}
          className="col-span-2 py-1.5 px-3 rounded-[2px] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all bg-[#121417] hover:bg-[#20242A] text-[#F59E0B] border border-[#F59E0B]/30 hover:border-[#F59E0B] disabled:opacity-30 disabled:cursor-not-allowed"
          title="Immediately abort the agent task and remove page badges"
          data-testid="askbro-btn-stop"
        >
          <Square className="w-3 h-3 text-[#F59E0B] fill-current" />
          <span>Stop Agent</span>
        </button>
      </div>
    </div>
  );
}
