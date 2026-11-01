import React, { useState } from 'react';
import {
  MousePointerClick,
  Keyboard,
  ListFilter,
  ArrowUpDown,
  CheckCircle2,
  AlertTriangle,
  Tag,
  Hash,
  Edit2,
  Check,
  ShieldAlert,
  Compass,
} from 'lucide-react';
import type { ActionStep, ActionableElement, CompactActionElement, ActionType } from '../../../types/action';
import AgentControls from './AgentControls';
import ConsequentialConfirmationModal from './ConsequentialConfirmationModal';
import { checkConsequentialTarget, isActionConsequential } from '../../../services/safety/consequentialGuard';

export interface ActionCardProps {
  /** The pending action step proposed by the AI */
  step: ActionStep;
  /** Matched actionable element from the page scanner (if available) */
  element?: ActionableElement | CompactActionElement | null;
  /** Callback when user clicks 'Approve' (receives possibly user-edited step) */
  onApprove: (approvedStep: ActionStep) => void | Promise<void>;
  /** Callback when user clicks 'Dry Run' (highlights element without execution) */
  onDryRun?: (targetId: number | null) => void | Promise<void>;
  /** Callback when user clicks 'Skip' (skips this element and requests another) */
  onSkip?: (targetId: number | null) => void | Promise<void>;
  /** Callback when user clicks 'Stop' (aborts task immediately) */
  onStop: () => void | Promise<void>;
  /** Current step number (1-indexed) */
  currentStep?: number;
  /** Maximum allowable steps (default: 10) */
  maxSteps?: number;
  /** Callback when max steps limit is changed */
  onMaxStepsChange?: (newMax: number) => void;
  /** Whether the content script is currently executing the action */
  isExecuting?: boolean;
  /** Whether the dry run highlight is active */
  isDryRunning?: boolean;
  /** Whether controls are disabled */
  disabled?: boolean;
  /** Optional execution error to display */
  error?: string | null;
  /** Additional custom container styling */
  className?: string;
  /** Whether to render the embedded AgentControls (defaults to true) */
  showControls?: boolean;
}

/**
 * Helper to get visual configuration based on ActionType
 * Preserves accentColor property contract for automated tests
 */
export function getActionVisualConfig(action: ActionType) {
  switch (action) {
    case 'click':
      return {
        label: 'CLICK',
        icon: MousePointerClick,
        badgeStyle: 'bg-[#121417] text-[#D4FF00] border-[#343B45]',
        accentColor: 'blue',
      };
    case 'type':
      return {
        label: 'TYPE',
        icon: Keyboard,
        badgeStyle: 'bg-[#121417] text-[#E0E3E8] border-[#343B45]',
        accentColor: 'violet',
      };
    case 'select':
      return {
        label: 'SELECT',
        icon: ListFilter,
        badgeStyle: 'bg-[#121417] text-[#E0E3E8] border-[#343B45]',
        accentColor: 'emerald',
      };
    case 'scroll':
      return {
        label: 'SCROLL',
        icon: ArrowUpDown,
        badgeStyle: 'bg-[#121417] text-[#F59E0B] border-[#F59E0B]/50',
        accentColor: 'amber',
      };
    case 'done':
      return {
        label: 'DONE',
        icon: CheckCircle2,
        badgeStyle: 'bg-[#121417] text-[#D4FF00] border-[#D4FF00]/50',
        accentColor: 'cyan',
      };
    default:
      return {
        label: (action as string).toUpperCase(),
        icon: Compass,
        badgeStyle: 'bg-[#121417] text-[#9DA5B2] border-[#2A303A]',
        accentColor: 'slate',
      };
  }
}

/**
 * ASKbro Industrial Human-in-the-Loop (HITL) Action Inspector Card
 * Engineered action proposal bench with telemetry badges and verified execution gates.
 */
export default function ActionCard({
  step,
  element,
  onApprove,
  onDryRun,
  onSkip,
  onStop,
  currentStep = 1,
  maxSteps = 10,
  onMaxStepsChange,
  isExecuting = false,
  isDryRunning = false,
  disabled = false,
  error = null,
  className = '',
  showControls = true,
}: ActionCardProps) {
  // Allow user to fine-tune typed text before approving
  const [isEditingValue, setIsEditingValue] = useState<boolean>(false);
  const [editedValue, setEditedValue] = useState<string>(step.value ?? '');
  // Secondary Confirmation Modal state for consequential actions (Slice 4.3)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);

  // Deterministic Consequential Guardrail evaluation
  const targetCheck = checkConsequentialTarget(element);
  const isConsequential = Boolean(
    step.isConsequential || targetCheck.isConsequential || isActionConsequential(step, element)
  );
  const matchedConsequentialKeyword = targetCheck.matchedKeyword;

  const visual = getActionVisualConfig(step.action);
  const ActionIcon = visual.icon;
  const isDone = step.action === 'done';
  const hasTarget = step.targetId !== null;

  // Resolve target element description cues
  const elementTag = element
    ? 'tag' in element
      ? element.tag.toLowerCase()
      : element.type.toLowerCase()
    : null;

  const elementText =
    element?.text ||
    element?.placeholder ||
    element?.ariaLabel ||
    element?.name ||
    null;

  const effectiveValue = isEditingValue ? editedValue : (step.value ?? null);

  const handleApproveWithEdits = () => {
    const finalStep: ActionStep = {
      ...step,
      value: effectiveValue,
      isConsequential,
    };

    // If consequential action detected, open secondary confirmation modal (Slice 4.3)
    if (isConsequential) {
      setIsConfirmModalOpen(true);
    } else {
      onApprove(finalStep);
    }
  };

  const handleModalConfirm = () => {
    setIsConfirmModalOpen(false);
    const finalStep: ActionStep = {
      ...step,
      value: effectiveValue,
      isConsequential,
    };
    onApprove(finalStep);
  };

  const handleDryRunClick = () => {
    if (onDryRun) {
      onDryRun(step.targetId);
    }
  };

  const handleSkipClick = () => {
    if (onSkip) {
      onSkip(step.targetId);
    }
  };

  return (
    <div
      className={`rounded-[2px] bg-[#181B1F] border border-[#2A303A] shadow-sm overflow-hidden transition-all animate-fade-in font-sans ${className}`}
      data-testid="askbro-action-card"
    >
      {/* Consequential Alert Banner */}
      {isConsequential && (
        <div className="bg-[#1A1712] border-b border-[#F59E0B]/40 px-3 py-2 flex items-start gap-2.5 text-[#E0E3E8]">
          <ShieldAlert className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <span className="font-semibold text-[#FFFFFF] font-mono uppercase tracking-wider">
              High-Impact / Consequential Step {matchedConsequentialKeyword ? `(${matchedConsequentialKeyword.toUpperCase()})` : ''}
            </span>
            <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
              This action may submit a form, perform a transaction, or alter account data. Secondary confirmation is required before execution.
            </p>
          </div>
        </div>
      )}

      <div className="p-3 space-y-2.5">
        {/* Card Header: Action Primitive Badge & Status */}
        <div className="flex items-center justify-between font-mono">
          <div className="flex items-center gap-1.5">
            <div
              className={`px-2 py-0.5 rounded-[2px] text-xs font-bold uppercase tracking-wider flex items-center gap-1 border shadow-sm ${visual.badgeStyle}`}
              data-testid="askbro-action-type-badge"
            >
              <ActionIcon className="w-3.5 h-3.5" />
              <span>{visual.label}</span>
            </div>

            {hasTarget ? (
              <span
                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-[2px] text-xs font-bold bg-[#121417] text-[#D4FF00] border border-[#343B45] shadow-sm"
                title={`Target badge #${step.targetId} on page`}
                data-testid="askbro-target-badge-pill"
              >
                <Hash className="w-3 h-3 text-[#737C8A] -mr-0.5" />
                <span>{step.targetId}</span>
              </span>
            ) : isDone ? (
              <span className="text-[10px] text-[#D4FF00] bg-[#121417] border border-[#D4FF00]/40 px-2 py-0.5 rounded-[2px]">
                Task Finished
              </span>
            ) : (
              <span className="text-[10px] text-[#9DA5B2] bg-[#121417] px-2 py-0.5 rounded-[2px] border border-[#2A303A]">
                Page Viewport
              </span>
            )}
          </div>

          <span className="text-[10px] font-semibold text-[#9DA5B2] flex items-center gap-1.5">
            <span className="telemetry-led-lime" />
            <span>AWAITING APPROVAL</span>
          </span>
        </div>

        {/* Target Element Description Section */}
        {hasTarget && (
          <div className="p-2.5 rounded-[2px] bg-[#121417] border border-[#22262E] text-xs space-y-1.5">
            <div className="text-[9px] uppercase font-mono tracking-wider font-bold text-[#737C8A] flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Tag className="w-2.5 h-2.5 text-[#D4FF00]" />
                Target Element
              </span>
              {elementTag && (
                <span className="font-mono text-[#D4FF00] bg-[#181B1F] px-1.5 py-0.2 rounded-[2px] border border-[#2A303A]">
                  &lt;{elementTag}&gt;
                </span>
              )}
            </div>

            <div className="text-[#FFFFFF] font-sans font-medium">
              {elementText ? (
                <span className="text-[#E0E3E8]" title={elementText}>
                  &ldquo;{elementText.length > 90 ? `${elementText.substring(0, 90)}...` : elementText}&rdquo;
                </span>
              ) : (
                <span className="text-[#9DA5B2]">
                  Element #{step.targetId}{elementTag ? ` (${elementTag})` : ''} on page
                </span>
              )}
            </div>

            {element?.role && (
              <div className="text-[10px] text-[#737C8A] flex items-center gap-1 font-mono">
                <span>Role:</span>
                <span className="text-[#E0E3E8]">{element.role}</span>
              </div>
            )}
          </div>
        )}

        {/* Input Value Section (for type, select, scroll) */}
        {(step.action === 'type' || step.action === 'select' || (step.action === 'scroll' && step.value)) && (
          <div className="p-2.5 rounded-[2px] bg-[#121417] border border-[#22262E] text-xs space-y-1.5">
            <div className="flex items-center justify-between text-[9px] uppercase font-mono tracking-wider font-bold text-[#737C8A]">
              <span className="flex items-center gap-1">
                <Keyboard className="w-2.5 h-2.5 text-[#D4FF00]" />
                {step.action === 'type'
                  ? 'Input Value to Type'
                  : step.action === 'select'
                  ? 'Option to Select'
                  : 'Scroll Offset'}
              </span>

              {/* Allow inline editing for typed values */}
              {step.action === 'type' && (
                <button
                  type="button"
                  onClick={() => setIsEditingValue(!isEditingValue)}
                  className="flex items-center gap-1 text-[#9DA5B2] hover:text-[#FFFFFF] text-[10px] transition-colors"
                  title="Edit text before approving"
                >
                  <Edit2 className="w-2.5 h-2.5" />
                  <span>{isEditingValue ? 'Save' : 'Edit'}</span>
                </button>
              )}
            </div>

            {isEditingValue ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={editedValue}
                  onChange={(e) => setEditedValue(e.target.value)}
                  className="w-full bg-[#181B1F] border border-[#D4FF00] rounded-[2px] px-2 py-1 text-xs text-[#FFFFFF] focus:outline-none focus:ring-1 focus:ring-[#D4FF00]"
                  placeholder="Enter custom input text..."
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setIsEditingValue(false)}
                  className="p-1 rounded-[2px] btn-lime text-[#0C0D0E]"
                  title="Confirm edit"
                >
                  <Check className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="p-2 rounded-[2px] bg-[#181B1F] border border-[#2A303A] font-mono text-xs text-[#D4FF00] break-all">
                {step.value ? (
                  <span>{step.value}</span>
                ) : (
                  <span className="text-[#737C8A] italic">None (blank)</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reasoning / Rationale Section */}
        <div className="p-2.5 rounded-[2px] bg-[#121417] border border-[#22262E] text-xs space-y-1">
          <div className="text-[9px] uppercase font-mono tracking-wider font-bold text-[#737C8A] flex items-center gap-1">
            <span>Agent Reasoning</span>
          </div>
          <p className="text-[#C2C7D0] font-sans text-xs leading-relaxed" data-testid="askbro-action-reasoning">
            &ldquo;{step.reason}&rdquo;
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/40 text-[#E0E3E8] text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-[#FFFFFF] font-mono">Execution Error</span>
              <p className="text-[11px] text-[#C2C7D0] leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Embedded Human-in-the-Loop Controls */}
        {showControls && (
          <AgentControls
            onApprove={handleApproveWithEdits}
            onDryRun={handleDryRunClick}
            onSkip={handleSkipClick}
            onStop={onStop}
            currentStep={currentStep}
            maxSteps={maxSteps}
            onMaxStepsChange={onMaxStepsChange}
            isConsequential={isConsequential}
            isExecuting={isExecuting}
            isDryRunning={isDryRunning}
            disabled={disabled}
            isDoneAction={isDone}
          />
        )}
      </div>

      {/* Secondary Confirmation Modal for Consequential Actions (Slice 4.3) */}
      <ConsequentialConfirmationModal
        isOpen={isConfirmModalOpen}
        step={{ ...step, value: effectiveValue, isConsequential }}
        element={element}
        matchedKeyword={matchedConsequentialKeyword}
        onConfirm={handleModalConfirm}
        onCancel={() => setIsConfirmModalOpen(false)}
      />
    </div>
  );
}
