import React from 'react';
import { Languages } from 'lucide-react';
import { OutputLanguage } from '../../../types/ai';
import { setLanguage } from '../../../services/storage/settingsStore';

export interface LanguageToggleProps {
  /** The currently active language ('en' or 'hinglish') */
  value: OutputLanguage;
  /** Callback invoked when the user selects a language */
  onChange: (language: OutputLanguage) => void;
  /** Visual display size */
  size?: 'xs' | 'sm' | 'md';
  /** Whether to show a compact language globe/translate icon */
  showIcon?: boolean;
  /** Whether buttons are disabled (e.g. during active generation) */
  disabled?: boolean;
  /** Whether to automatically persist changes to chrome.storage.local (default: true) */
  autoPersist?: boolean;
  /** Additional container CSS classes */
  className?: string;
  /** Optional custom id */
  id?: string;
}

/**
 * ASKbro Industrial Precision Language Switcher
 * Engineered toggle between English and colloquial Hinglish telemetry.
 */
export default function LanguageToggle({
  value = 'en',
  onChange,
  size = 'sm',
  showIcon = false,
  disabled = false,
  autoPersist = true,
  className = '',
  id,
}: LanguageToggleProps) {
  const isEn = value === 'en';
  const isHinglish = value === 'hinglish';

  const handleSelect = async (lang: OutputLanguage) => {
    if (disabled || lang === value) return;

    // 1. Notify parent component immediately for zero-lag UI response
    onChange(lang);

    // 2. Persist to chrome.storage.local if enabled
    if (autoPersist) {
      try {
        await setLanguage(lang);
      } catch (err) {
        console.error('[LanguageToggle] Failed to persist language to storage:', err);
      }
    }
  };

  // Size styling variants
  const sizeClasses = {
    xs: {
      container: 'p-0.5 text-[9px]',
      button: 'px-1.5 py-0.5 rounded-[2px]',
      icon: 'w-2.5 h-2.5',
    },
    sm: {
      container: 'p-0.5 text-[10px]',
      button: 'px-2 py-0.5 rounded-[2px]',
      icon: 'w-3 h-3',
    },
    md: {
      container: 'p-0.5 text-xs',
      button: 'px-2.5 py-1 rounded-[2px]',
      icon: 'w-3.5 h-3.5',
    },
  }[size];

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Output Language Selection"
      className={`inline-flex items-center rounded-sm bg-[#121417] border border-[#2A303A] font-mono select-none transition-colors ${
        sizeClasses.container
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
    >
      {showIcon && (
        <span className="pl-1.5 pr-0.5 text-[#737C8A] flex items-center" aria-hidden="true">
          <Languages className={sizeClasses.icon} />
        </span>
      )}

      {/* English Radio Option */}
      <button
        type="button"
        role="radio"
        aria-checked={isEn}
        disabled={disabled}
        onClick={() => handleSelect('en')}
        title="English — Standard concise structured notes"
        className={`font-semibold tracking-wider transition-all duration-100 focus:outline-none flex items-center gap-1 ${
          sizeClasses.button
        } ${
          isEn
            ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm'
            : 'text-[#9DA5B2] hover:text-[#E0E3E8] hover:bg-[#181B1F]'
        }`}
      >
        <span className={`w-1 h-1 rounded-[0.5px] ${isEn ? 'bg-[#D4FF00]' : 'bg-transparent'}`} />
        <span>EN</span>
      </button>

      {/* Hinglish Radio Option */}
      <button
        type="button"
        role="radio"
        aria-checked={isHinglish}
        disabled={disabled}
        onClick={() => handleSelect('hinglish')}
        title="Hinglish — Colloquial Hindi in Roman script keeping technical terms intact"
        className={`font-semibold tracking-wider transition-all duration-100 focus:outline-none flex items-center gap-1 ${
          sizeClasses.button
        } ${
          isHinglish
            ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm'
            : 'text-[#9DA5B2] hover:text-[#E0E3E8] hover:bg-[#181B1F]'
        }`}
      >
        <span className={`w-1 h-1 rounded-[0.5px] ${isHinglish ? 'bg-[#D4FF00]' : 'bg-transparent'}`} />
        <span>HIN</span>
      </button>
    </div>
  );
}
