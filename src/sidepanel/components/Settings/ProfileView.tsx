import React, { useState, useEffect } from 'react';
import {
  User,
  Mail,
  Phone,
  GraduationCap,
  Globe,
  Plus,
  X,
  Save,
  Trash2,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  Copy,
  Check,
  FileText,
  Loader2,
} from 'lucide-react';
import { UserProfile, DEFAULT_USER_PROFILE, PreferredTone } from '../../../types/profile';
import {
  getProfile,
  saveProfile,
  clearProfile,
  exportProfileAsJson,
  importProfileFromJson,
} from '../../../services/storage/profileStore';

export interface ProfileViewProps {
  onBack?: () => void;
  onProfileSaved?: (profile: UserProfile) => void;
  className?: string;
}

export default function ProfileView({ onBack, onProfileSaved, className = '' }: ProfileViewProps) {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [skillInput, setSkillInput] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<{
    type: 'idle' | 'saving' | 'saved' | 'error';
    message?: string;
  }>({ type: 'idle' });

  // Import / Export modal & feedback states
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importJsonText, setImportJsonText] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  useEffect(() => {
    loadProfileData();
  }, []);

  const loadProfileData = async () => {
    setIsLoading(true);
    try {
      const data = await getProfile();
      setProfile(data);
    } catch (err) {
      console.error('[ProfileView] Error loading profile:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: keyof UserProfile, value: any) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
    setSaveStatus({ type: 'idle' });
  };

  const handleAddSkill = () => {
    const raw = skillInput.trim();
    if (!raw) return;

    // Handle comma-separated skills entry
    const newSkills = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !profile.skills.includes(s));

    if (newSkills.length > 0) {
      setProfile((prev) => ({
        ...prev,
        skills: [...prev.skills, ...newSkills],
      }));
    }
    setSkillInput('');
    setSaveStatus({ type: 'idle' });
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setProfile((prev) => ({
      ...prev,
      skills: prev.skills.filter((s) => s !== skillToRemove),
    }));
    setSaveStatus({ type: 'idle' });
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaveStatus({ type: 'saving' });
    try {
      await saveProfile(profile);
      setSaveStatus({ type: 'saved', message: 'Profile data saved to device memory.' });
      onProfileSaved?.(profile);
    } catch (err: any) {
      setSaveStatus({ type: 'error', message: err?.message || 'Failed to save profile memory.' });
    }
  };

  const handleClear = async () => {
    try {
      await clearProfile();
      setProfile(DEFAULT_USER_PROFILE);
      setShowClearConfirm(false);
      setSaveStatus({ type: 'saved', message: 'Profile memory cleared.' });
    } catch (err: any) {
      setSaveStatus({ type: 'error', message: err?.message || 'Failed to clear profile.' });
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportProfileAsJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `askbro-profile-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ProfileView] Export failed:', err);
    }
  };

  const handleCopyJson = async () => {
    try {
      const json = await exportProfileAsJson();
      await navigator.clipboard.writeText(json);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('[ProfileView] Copy JSON failed:', err);
    }
  };

  const handleImportSubmit = async () => {
    if (!importJsonText.trim()) return;
    try {
      const imported = await importProfileFromJson(importJsonText);
      setProfile(imported);
      setShowImportModal(false);
      setImportJsonText('');
      setImportError(null);
      setSaveStatus({ type: 'saved', message: 'Profile imported and applied successfully.' });
    } catch (err: any) {
      setImportError(err?.message || 'Invalid profile JSON structure.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#737C8A] space-y-2 font-mono">
        <Loader2 className="w-5 h-5 animate-spin text-[#D4FF00]" />
        <span className="text-xs">Loading profile memory...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-3 pb-8 font-sans ${className}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#2A303A] font-mono">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#20242A] transition-all"
              title="Back"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}
          <div>
            <h1 className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider flex items-center gap-1.5">
              <span className="p-0.5 rounded-[2px] bg-[#121417] text-[#D4FF00] border border-[#2A303A] inline-flex">
                <User className="w-3 h-3" />
              </span>
              Local Profile Memory
            </h1>
            <p className="text-[9px] text-[#737C8A] mt-0.5">
              Encrypted locally on this machine for precise form-filling and job applications
            </p>
          </div>
        </div>
      </div>

      {/* Local-First Zero-Telemetry Trust Banner */}
      <div className="flex items-center gap-2 p-2.5 rounded-[2px] bg-[#121812] border border-[#D4FF00]/40 text-[#E0E3E8] text-xs font-mono">
        <div className="p-1 rounded-[2px] bg-[#181B1F] text-[#D4FF00] border border-[#D4FF00]/40 shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
        </div>
        <span className="text-[10px] leading-relaxed text-[#9DA5B2] font-mono">
          <strong className="text-[#D4FF00]">LOCAL-FIRST:</strong> Stored exclusively in{' '}
          <code className="text-[#FFFFFF] bg-[#181B1F] px-1 py-0.2 rounded border border-[#2A303A]">
            chrome.storage.local
          </code>
          . Never uploaded to remote servers.
        </span>
      </div>

      {/* Feedback Alert Banner */}
      {saveStatus.type !== 'idle' && (
        <div
          className={`p-2.5 rounded-[2px] border text-xs flex items-center gap-2 font-mono animate-fade-in ${
            saveStatus.type === 'saved'
              ? 'bg-[#121812] border-[#D4FF00]/40 text-[#D4FF00]'
              : saveStatus.type === 'error'
              ? 'bg-[#1A1712] border-[#F59E0B]/50 text-[#F59E0B]'
              : 'bg-[#181B1F] border-[#2A303A] text-[#FFFFFF]'
          }`}
        >
          {saveStatus.type === 'saved' && <CheckCircle2 className="w-3.5 h-3.5 text-[#D4FF00] shrink-0" />}
          {saveStatus.type === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />}
          {saveStatus.type === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D4FF00] shrink-0" />}
          <span className="font-semibold">{saveStatus.message || (saveStatus.type === 'saving' ? 'Saving profile memory...' : '')}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-3 font-sans">
        {/* Section 1: Personal Contact Info */}
        <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2.5 shadow-sm font-sans">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF] pb-1.5 border-b border-[#2A303A]">
            <User className="w-3 h-3 text-[#D4FF00]" />
            <span>Personal Information</span>
          </div>

          <div className="space-y-2">
            <div>
              <label htmlFor="fullName" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                value={profile.fullName}
                onChange={(e) => handleChange('fullName', e.target.value)}
                placeholder="e.g. Alex Rivera"
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="email" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="alex@example.com"
                  className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                  Phone Number
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="+1 555-0192"
                  className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Education & Academics */}
        <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2.5 shadow-sm font-sans">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF] pb-1.5 border-b border-[#2A303A]">
            <GraduationCap className="w-3 h-3 text-[#D4FF00]" />
            <span>Education &amp; Academics</span>
          </div>

          <div className="space-y-2">
            <div>
              <label htmlFor="collegeOrUniversity" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                College / University
              </label>
              <input
                id="collegeOrUniversity"
                type="text"
                value={profile.collegeOrUniversity}
                onChange={(e) => handleChange('collegeOrUniversity', e.target.value)}
                placeholder="e.g. Stanford University / IIT Bombay"
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="major" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                  Major / Degree
                </label>
                <input
                  id="major"
                  type="text"
                  value={profile.major}
                  onChange={(e) => handleChange('major', e.target.value)}
                  placeholder="e.g. Computer Science"
                  className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
                />
              </div>

              <div>
                <label htmlFor="graduationYear" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                  Graduation Year
                </label>
                <input
                  id="graduationYear"
                  type="text"
                  value={profile.graduationYear}
                  onChange={(e) => handleChange('graduationYear', e.target.value)}
                  placeholder="e.g. 2025"
                  className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Online Presence & Portfolios */}
        <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2.5 shadow-sm font-sans">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF] pb-1.5 border-b border-[#2A303A]">
            <Globe className="w-3 h-3 text-[#D4FF00]" />
            <span>Online Presence &amp; Portfolios</span>
          </div>

          <div className="space-y-2">
            <div>
              <label htmlFor="portfolioUrl" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                Portfolio URL
              </label>
              <input
                id="portfolioUrl"
                type="url"
                value={profile.portfolioUrl || ''}
                onChange={(e) => handleChange('portfolioUrl', e.target.value)}
                placeholder="https://alexrivera.dev"
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
              />
            </div>

            <div>
              <label htmlFor="linkedinUrl" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                LinkedIn URL
              </label>
              <input
                id="linkedinUrl"
                type="url"
                value={profile.linkedinUrl || ''}
                onChange={(e) => handleChange('linkedinUrl', e.target.value)}
                placeholder="https://linkedin.com/in/alexrivera"
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
              />
            </div>

            <div>
              <label htmlFor="githubUrl" className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1">
                GitHub URL
              </label>
              <input
                id="githubUrl"
                type="url"
                value={profile.githubUrl || ''}
                onChange={(e) => handleChange('githubUrl', e.target.value)}
                placeholder="https://github.com/alexrivera"
                className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Skills & Writing Tone */}
        <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2.5 shadow-sm font-sans">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF] pb-1.5 border-b border-[#2A303A]">
            <Sparkles className="w-3 h-3 text-[#D4FF00]" />
            <span>Skills &amp; Writing Preferences</span>
          </div>

          {/* Interactive Skills Chips */}
          <div>
            <label className="block text-[10px] font-mono uppercase font-bold text-[#9DA5B2] mb-1.5">
              Technical &amp; Professional Skills
            </label>

            <div className="flex flex-wrap gap-1 mb-2 min-h-[34px] p-2 rounded-[2px] bg-[#121417] border border-[#22262E]">
              {profile.skills.length === 0 ? (
                <span className="text-[10px] text-[#505967] italic py-0.5 font-mono">No skills registered. Type below to add.</span>
              ) : (
                profile.skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[2px] bg-[#181B1F] text-[#D4FF00] border border-[#343B45] text-[10px] font-mono font-bold"
                  >
                    <span>{skill}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill)}
                      className="hover:text-[#F59E0B] p-0.5 rounded transition-colors text-[#737C8A]"
                      title={`Remove ${skill}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))
              )}
            </div>

            <div className="flex gap-1.5 font-mono">
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSkill();
                  }
                }}
                placeholder="Add skill (e.g. TypeScript, React)..."
                className="flex-1 bg-[#121417] border border-[#2A303A] rounded-[2px] px-2.5 py-1 text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] font-sans"
              />
              <button
                type="button"
                onClick={handleAddSkill}
                disabled={!skillInput.trim()}
                className="px-3 py-1 rounded-[2px] btn-lime text-xs font-bold flex items-center gap-1 disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                <span>ADD</span>
              </button>
            </div>
          </div>

          {/* Preferred Writing Tone */}
          <div className="pt-1 font-mono">
            <label className="block text-[10px] uppercase font-bold text-[#9DA5B2] mb-1.5">
              Preferred Writing Tone for Drafts
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'professional', label: 'Professional', desc: 'Crisp & formal' },
                  { id: 'casual', label: 'Casual', desc: 'Friendly & direct' },
                  { id: 'hinglish', label: 'Hinglish', desc: 'Colloquial Hinglish' },
                ] as const
              ).map((tone) => {
                const isActive = profile.preferredTone === tone.id;
                return (
                  <button
                    key={tone.id}
                    type="button"
                    onClick={() => handleChange('preferredTone', tone.id)}
                    className={`p-2 rounded-[2px] border text-left transition-all ${
                      isActive
                        ? 'bg-[#20242A] border-[#D4FF00] text-[#D4FF00] shadow-sm'
                        : 'bg-[#121417] border-[#2A303A] text-[#9DA5B2] hover:border-[#343B45]'
                    }`}
                  >
                    <div className="font-bold text-xs">{tone.label}</div>
                    <div className="text-[9px] text-[#737C8A] mt-0.5">{tone.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Primary Save Button */}
        <div className="pt-1 flex items-center gap-2 font-mono">
          <button
            type="submit"
            disabled={saveStatus.type === 'saving'}
            className="flex-1 py-2 px-4 rounded-[2px] btn-lime text-xs font-bold flex items-center justify-center gap-2 shadow-sm disabled:opacity-40"
          >
            {saveStatus.type === 'saving' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving to Memory...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Profile Memory</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Section 5: Data Portability & Backup */}
      <div className="p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2 shadow-sm font-sans">
        <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[#FFFFFF] pb-1 border-b border-[#2A303A]">
          <FileText className="w-3 h-3 text-[#D4FF00]" />
          <span>Profile Backup &amp; Portability</span>
        </div>

        <p className="text-[10px] text-[#9DA5B2] leading-relaxed">
          Export your profile as JSON to backup your information or transfer it across machines.
        </p>

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 font-mono">
          <button
            type="button"
            onClick={handleExport}
            className="py-1 px-2.5 rounded-[2px] btn-graphite text-xs font-semibold flex items-center gap-1"
          >
            <Download className="w-3 h-3 text-[#D4FF00]" />
            <span>Download JSON</span>
          </button>

          <button
            type="button"
            onClick={handleCopyJson}
            className="py-1 px-2.5 rounded-[2px] btn-graphite text-xs font-semibold flex items-center gap-1"
          >
            {isCopied ? (
              <>
                <Check className="w-3 h-3 text-[#D4FF00]" />
                <span className="text-[#D4FF00]">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-[#9DA5B2]" />
                <span>Copy JSON</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowImportModal(true);
              setImportError(null);
            }}
            className="py-1 px-2.5 rounded-[2px] btn-graphite text-xs font-semibold flex items-center gap-1"
          >
            <Upload className="w-3 h-3 text-[#F59E0B]" />
            <span>Import JSON</span>
          </button>

          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            className="ml-auto py-1 px-2.5 rounded-[2px] btn-graphite text-xs font-semibold flex items-center gap-1 text-[#F59E0B] hover:text-[#FFFFFF]"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal for Clear Profile */}
      {showClearConfirm && (
        <div className="p-3 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 space-y-2 animate-fade-in shadow-md font-sans">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h2 className="text-xs font-mono font-bold text-[#FFFFFF] uppercase">Clear all profile memory?</h2>
              <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
                This will delete your name, contact details, and educational background from local device storage.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1.5 pt-1 font-mono">
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              className="py-1 px-2.5 rounded-[2px] btn-graphite text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="py-1 px-3 rounded-[2px] btn-amber text-xs font-bold"
            >
              Yes, Clear Memory
            </button>
          </div>
        </div>
      )}

      {/* Import JSON Modal */}
      {showImportModal && (
        <div className="p-3.5 rounded-[2px] bg-[#181B1F] border border-[#2A303A] space-y-2.5 animate-fade-in shadow-xl font-sans">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#2A303A] font-mono">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#FFFFFF] uppercase">
              <Upload className="w-3 h-3 text-[#D4FF00]" />
              <span>Import Profile from JSON</span>
            </div>
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="p-1 text-[#737C8A] hover:text-[#FFFFFF] rounded-[2px] transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[10px] text-[#9DA5B2] font-mono">
            Paste a valid JSON profile object below:
          </p>

          <textarea
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
            rows={5}
            placeholder={`{\n  "fullName": "Alex Rivera",\n  "email": "alex@example.com",\n  "skills": ["React", "TypeScript"]\n}`}
            className="w-full bg-[#121417] border border-[#2A303A] rounded-[2px] p-2 font-mono text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] shadow-well-inset"
          />

          {importError && (
            <div className="p-2 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#F59E0B] text-[10px] flex items-center gap-1.5 font-mono">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          <div className="flex justify-end gap-1.5 pt-1 font-mono">
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="py-1 px-2.5 rounded-[2px] btn-graphite text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImportSubmit}
              disabled={!importJsonText.trim()}
              className="py-1 px-3 rounded-[2px] btn-lime text-xs font-bold disabled:opacity-40"
            >
              Apply &amp; Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
