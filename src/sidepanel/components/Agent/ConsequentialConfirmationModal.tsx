import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  X,
  Hash,
} from 'lucide-react';
import type { ActionStep, ActionableElement, CompactActionElement } from '../../../types/action';
import { getActionVisualConfig } from './ActionCard';

export interface ConsequentialConfirmationModalProps {
  /** Whether the confirmation modal is open */
  isOpen: boolean;
  /** The pending action step proposed by the AI */
  step: ActionStep;
  /** Target element metadata if available */
  element?: ActionableElement | CompactActionElement | null;
  /** Specific keyword that triggered the consequential flag (e.g., submit, pay, delete) */
  matchedKeyword?: string;
  /** Callback when user confirms execution with the toggle enabled */
  onConfirm: () => void;
  /** Callback when user cancels or dismisses the modal */
  onCancel: () => void;
}

/**
 * ASKbro Industrial Consequential Action Interlock Sheet
 * Secondary confirmation barrier for high-stakes browser operations.
 */
export default function ConsequentialConfirmationModal({
  isOpen,
  step,
  element,
  matchedKeyword,
  onConfirm,
  onCancel,
}: ConsequentialConfirmationModalProps) {
  const [isConfirmed, setIsConfirmed] = useState<boolean>(false);

  // Reset confirmation toggle whenever modal opens or step changes
  useEffect(() => {
    if (isOpen) {
      setIsConfirmed(false);
    }
  }, [isOpen, step]);

  if (!isOpen) return null;

  const visual = getActionVisualConfig(step.action);
  const ActionIcon = visual.icon;

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

  const keywordLabel = (matchedKeyword || 'Submit / Pay / Delete').toUpperCase();

  const handleConfirmClick = () => {
    if (!isConfirmed) return;
    onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consequential-modal-title"
      data-testid="askbro-consequential-modal"
    >
      <div className="relative w-full max-w-md rounded-[2px] bg-[#181B1F] border border-[#F59E0B]/50 shadow-2xl overflow-hidden text-[#E0E3E8] animate-in zoom-in-95 duration-100 font-sans">
        {/* Muted Amber Safety Interlock Header */}
        <div className="bg-[#1A1712] px-3.5 py-3 border-b border-[#F59E0B]/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-[2px] bg-[#2A1E0B] border border-[#F59E0B]/50 text-[#F59E0B]">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 id="consequential-modal-title" className="text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider flex items-center gap-1.5">
                <span>High-Consequence Action</span>
                <span className="text-[9px] font-mono uppercase bg-[#2A1E0B] text-[#F59E0B] border border-[#F59E0B]/50 px-1 py-0.2 rounded-[2px] font-bold">
                  {keywordLabel}
                </span>
              </h3>
              <p className="text-[10px] text-[#9DA5B2] font-mono mt-0.5">Secondary verification required before dispatch</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#20242A] transition-all"
            aria-label="Close confirmation modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 space-y-3 text-xs">
          {/* Action Details Box */}
          <div className="p-3 rounded-[2px] bg-[#121417] border border-[#2A303A] space-y-2">
            <div className="text-[9px] uppercase font-mono tracking-wider font-bold text-[#737C8A] flex items-center justify-between">
              <span>Proposed Operation</span>
              <div className="flex items-center gap-1.5">
                <span className={`px-1.5 py-0.5 rounded-[2px] text-[9px] font-mono font-bold border flex items-center gap-1 ${visual.badgeStyle}`}>
                  <ActionIcon className="w-2.5 h-2.5" />
                  <span>{visual.label}</span>
                </span>
                {step.targetId !== null && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-[2px] font-mono text-[9px] font-bold bg-[#181B1F] text-[#D4FF00] border border-[#343B45]">
                    <Hash className="w-2.5 h-2.5 text-[#737C8A]" />
                    <span>{step.targetId}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Target element description */}
            <div className="text-[#E0E3E8] font-medium pt-0.5">
              {elementText ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[#737C8A] text-[10px] font-mono">Target:</span>
                  <span className="text-[#FFFFFF]">
                    &ldquo;{elementText.length > 70 ? `${elementText.substring(0, 70)}...` : elementText}&rdquo;
                  </span>
                  {elementTag && (
                    <span className="text-[9px] font-mono text-[#D4FF00] bg-[#181B1F] px-1 py-0.2 rounded-[2px] border border-[#2A303A]">
                      &lt;{elementTag}&gt;
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-[#9DA5B2] font-mono text-[11px]">
                  Target: Element #{step.targetId} on page
                </div>
              )}
            </div>

            {step.value && (
              <div className="text-[11px] text-[#E0E3E8] flex items-center gap-1.5 pt-0.5">
                <span className="text-[#737C8A] font-mono text-[10px]">Value:</span>
                <span className="font-mono text-[#D4FF00] bg-[#181B1F] px-1.5 py-0.5 rounded-[2px] border border-[#2A303A]">
                  {step.value}
                </span>
              </div>
            )}

            {/* Rationale */}
            <div className="pt-0.5 text-[11px] text-[#9DA5B2] leading-relaxed">
              &ldquo;{step.reason}&rdquo;
            </div>
          </div>

          {/* Warning Impact Description */}
          <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/40 text-[#E0E3E8] space-y-1">
            <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase text-[#F59E0B]">
              <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
              <span>Potential Irreversible Impact</span>
            </div>
            <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
              This action may submit binding application data, execute a payment or order placement, or alter records on the active website.
            </p>
          </div>

          {/* Explicit Confirmation Toggle */}
          <label
            className={`flex items-start gap-2.5 p-3 rounded-[2px] border transition-all cursor-pointer select-none font-sans ${
              isConfirmed
                ? 'bg-[#181B1F] border-[#D4FF00] text-[#FFFFFF]'
                : 'bg-[#121417] border-[#2A303A] hover:border-[#343B45] text-[#9DA5B2]'
            }`}
            data-testid="askbro-consequential-toggle-container"
          >
            <input
              type="checkbox"
              checked={isConfirmed}
              onChange={(e) => setIsConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded-[1px] border-[#343B45] text-[#D4FF00] focus:ring-0 bg-[#0C0D0E] cursor-pointer"
              data-testid="askbro-consequential-toggle"
            />
            <div className="space-y-0.5">
              <span className="font-semibold text-xs text-[#FFFFFF]">
                I understand this action is consequential
              </span>
              <p className="text-[10px] text-[#9DA5B2] leading-snug">
                I have inspected the target element and explicitly authorize ASKbro to execute this step.
              </p>
            </div>
          </label>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-3 bg-[#121417] border-t border-[#2A303A] flex items-center justify-end gap-2 font-mono">
          <button
            type="button"
            onClick={onCancel}
            className="py-1.5 px-3 rounded-[2px] btn-graphite text-xs font-semibold"
            data-testid="askbro-consequential-cancel-btn"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={!isConfirmed}
            className={`py-1.5 px-3.5 rounded-[2px] font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm ${
              isConfirmed
                ? 'btn-amber cursor-pointer'
                : 'bg-[#20242A] text-[#505967] border border-[#2A303A] opacity-40 cursor-not-allowed'
            }`}
            data-testid="askbro-consequential-confirm-btn"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Confirm &amp; Execute</span>
          </button>
        </div>
      </div>
    </div>
  );
}
