import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  KeyRound,
  RefreshCw,
  Clock,
  X,
  CheckCircle2,
} from 'lucide-react';
import { AIProvider } from '../../../types/ai';
import { formatQuotaBannerMessage } from '../../../services/ai/rateLimiter';

export interface RateLimitBannerProps {
  initialSeconds?: number;
  message?: string;
  isMultimodal?: boolean;
  provider?: AIProvider;
  onOpenSettings?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export default function RateLimitBanner({
  initialSeconds = 30,
  message,
  isMultimodal = false,
  provider = 'gemini',
  onOpenSettings,
  onRetry,
  onDismiss,
  compact = false,
}: RateLimitBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState<number>(Math.max(1, initialSeconds));

  useEffect(() => {
    setSecondsLeft(Math.max(1, initialSeconds));
  }, [initialSeconds]);

  useEffect(() => {
    if (secondsLeft <= 0) return;

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsLeft]);

  const isCooldownFinished = secondsLeft === 0;
  const displayMessage =
    message || formatQuotaBannerMessage(secondsLeft);

  return (
    <div
      className={`rounded-sm border font-sans transition-all animate-fade-in ${
        isCooldownFinished
          ? 'bg-[#181B1F] border-[#D4FF00]/40 text-[#E0E3E8]'
          : 'bg-[#1A1712] border-[#F59E0B]/40 text-[#E0E3E8]'
      } ${compact ? 'p-2.5 space-y-2' : 'p-3 space-y-2.5'}`}
      role="alert"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <div
            className={`p-1.5 rounded-[2px] shrink-0 mt-0.5 border ${
              isCooldownFinished
                ? 'bg-[#152200] border-[#D4FF00]/50 text-[#D4FF00]'
                : 'bg-[#2A1E0B] border-[#F59E0B]/50 text-[#F59E0B]'
            }`}
          >
            {isCooldownFinished ? (
              <RefreshCw className="w-3.5 h-3.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" />
            )}
          </div>

          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold tracking-tight text-[#FFFFFF]">
                {isCooldownFinished
                  ? 'Cooldown Finished'
                  : 'Free-Tier Rate Limit Reached'}
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-[2px] border flex items-center gap-1 ${
                  isCooldownFinished
                    ? 'bg-[#121417] text-[#D4FF00] border-[#D4FF00]/40'
                    : 'bg-[#121417] text-[#F59E0B] border-[#F59E0B]/40'
                }`}
              >
                <Clock className="w-2.5 h-2.5" />
                {isCooldownFinished ? 'Ready to retry' : `${secondsLeft}s remaining`}
              </span>
              {provider && (
                <span className="text-[9px] uppercase font-mono font-semibold px-1.5 py-0.5 rounded-[2px] bg-[#20242A] text-[#9DA5B2] border border-[#343B45]">
                  {provider}
                </span>
              )}
            </div>

            <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
              {displayMessage}
            </p>
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[#737C8A] hover:text-[#E0E3E8] p-1 rounded transition-colors"
            title="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Action triggers */}
      <div className="flex items-center gap-2 pt-1 border-t border-[#2A303A]">
        {isCooldownFinished && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="py-1 px-3 rounded-[2px] btn-lime text-xs font-semibold flex items-center gap-1.5 shadow-sm"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry Query Now</span>
          </button>
        )}

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="py-1 px-2.5 rounded-[2px] btn-graphite text-[11px] font-mono flex items-center gap-1.5"
          >
            <KeyRound className="w-3 h-3 text-[#D4FF00]" />
            <span>Switch / Upgrade API Key</span>
          </button>
        )}
      </div>
    </div>
  );
}
