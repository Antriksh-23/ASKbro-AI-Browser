import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Save,
  AlertCircle,
  GraduationCap,
  Languages,
  MailCheck,
  UserCheck,
  BookOpen,
  Brain,
  Terminal,
  Zap,
  MessageSquare,
  Plus,
  Compass,
} from 'lucide-react';
import {
  SkillDefinition,
  SkillWorkflowType,
} from '../../../types/skills';

export interface SkillModalProps {
  isOpen: boolean;
  skill?: SkillDefinition | null;
  onClose: () => void;
  onSave: (skill: Partial<SkillDefinition> & { name: string; systemPrompt: string }) => Promise<void>;
}

const AVAILABLE_ICONS = [
  { name: 'Sparkles', icon: <Sparkles className="w-3.5 h-3.5" />, label: 'Magic' },
  { name: 'GraduationCap', icon: <GraduationCap className="w-3.5 h-3.5" />, label: 'Exam' },
  { name: 'Languages', icon: <Languages className="w-3.5 h-3.5" />, label: 'Language' },
  { name: 'MailCheck', icon: <MailCheck className="w-3.5 h-3.5" />, label: 'Email' },
  { name: 'UserCheck', icon: <UserCheck className="w-3.5 h-3.5" />, label: 'Profile' },
  { name: 'BookOpen', icon: <BookOpen className="w-3.5 h-3.5" />, label: 'Study' },
  { name: 'Brain', icon: <Brain className="w-3.5 h-3.5" />, label: 'Reason' },
  { name: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" />, label: 'Code' },
  { name: 'Zap', icon: <Zap className="w-3.5 h-3.5" />, label: 'Fast' },
  { name: 'MessageSquare', icon: <MessageSquare className="w-3.5 h-3.5" />, label: 'Chat' },
];

const WORKFLOW_OPTIONS: { value: SkillWorkflowType; label: string; description: string }[] = [
  {
    value: 'summary',
    label: 'Exam Notes & Summarization',
    description: 'Generates structured revision notes, key concepts, formulas, and Q&A from page text.',
  },
  {
    value: 'explanation',
    label: 'Conversational Breakdown (Hinglish/Plain)',
    description: 'Demystifies complex jargon, code, or ideas into friendly conversational language.',
  },
  {
    value: 'reply',
    label: 'Draft Polite Communication',
    description: 'Generates warm, executive-grade email or chat replies tailored to context.',
  },
  {
    value: 'fill_profile',
    label: 'Agent Form Fill',
    description: 'Triggers browser agent to auto-populate form fields using your stored personal profile.',
  },
  {
    value: 'custom',
    label: 'Custom Autonomous Prompt',
    description: 'Executes bespoke multi-step prompts directly against active document context.',
  },
];

export default function SkillModal({
  isOpen,
  skill,
  onClose,
  onSave,
}: SkillModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [actionWorkflow, setActionWorkflow] = useState<SkillWorkflowType>('summary');
  const [icon, setIcon] = useState('Sparkles');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (skill) {
      setName(skill.name || '');
      setDescription(skill.description || '');
      setSystemPrompt(skill.systemPrompt || '');
      setActionWorkflow(skill.actionWorkflow || 'summary');
      setIcon(skill.icon || 'Sparkles');
      setTags(skill.tags || []);
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('');
      setActionWorkflow('summary');
      setIcon('Sparkles');
      setTags([]);
    }
    setError(null);
  }, [skill, isOpen]);

  if (!isOpen) return null;

  const handleAddTag = () => {
    const clean = tagInput.trim().replace(/^#/, '').toLowerCase();
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Skill name is required.');
      return;
    }
    if (!description.trim()) {
      setError('Skill description is required.');
      return;
    }
    if (!systemPrompt.trim()) {
      setError('System prompt instructions are required.');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        actionWorkflow,
        icon,
        tags,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save skill.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-fade-in font-sans">
      <div
        className="w-full max-w-lg rounded-[2px] bg-[#181B1F] border border-[#2A303A] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-[#E0E3E8]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-modal-title"
      >
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#121417] border-b border-[#2A303A] flex items-center justify-between font-mono">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#D4FF00] flex items-center justify-center">
              <Compass className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 id="skill-modal-title" className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">
                {skill ? 'Edit Skill Recipe' : 'Create One-Click Skill'}
              </h2>
              <p className="text-[10px] text-[#737C8A]">
                Craft reusable automated prompt recipes for active web pages
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#20242A] transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 overflow-y-auto flex-1 bg-[#181B1F]">
          {error && (
            <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] text-xs flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1">
            <label className="block text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
              Skill Name <span className="text-[#D4FF00]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Contract Risk Spotter, YouTube Notes, Code Reviewer"
              maxLength={80}
              className="w-full px-2.5 py-1.5 rounded-[2px] bg-[#121417] border border-[#2A303A] text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 font-sans"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="block text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
              Description <span className="text-[#D4FF00]">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Scans active page for liability clauses, indemnity, and auto-renewals."
              maxLength={280}
              className="w-full px-2.5 py-1.5 rounded-[2px] bg-[#121417] border border-[#2A303A] text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 font-sans"
              required
            />
          </div>

          {/* Workflow Type */}
          <div className="space-y-1">
            <label className="block text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">
              Action Workflow Target
            </label>
            <select
              value={actionWorkflow}
              onChange={(e) => setActionWorkflow(e.target.value as SkillWorkflowType)}
              className="w-full px-2.5 py-1.5 rounded-[2px] bg-[#121417] border border-[#2A303A] text-xs text-[#FFFFFF] focus:outline-none focus:border-[#D4FF00] font-sans"
            >
              {WORKFLOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[#737C8A] pt-0.5 font-mono">
              {WORKFLOW_OPTIONS.find((w) => w.value === actionWorkflow)?.description}
            </p>
          </div>

          {/* Icon Selector */}
          <div className="space-y-1">
            <label className="block text-xs font-mono font-bold text-[#FFFFFF] uppercase tracking-wider">Choose Icon</label>
            <div className="grid grid-cols-5 gap-1.5">
              {AVAILABLE_ICONS.map((ic) => (
                <button
                  key={ic.name}
                  type="button"
                  onClick={() => setIcon(ic.name)}
                  className={`p-1.5 rounded-[2px] border text-xs flex flex-col items-center gap-1 transition-all ${
                    icon === ic.name
                      ? 'bg-[#20242A] border-[#D4FF00] text-[#D4FF00]'
                      : 'bg-[#121417] border-[#2A303A] text-[#9DA5B2] hover:text-[#FFFFFF] hover:bg-[#20242A]'
                  }`}
                >
                  {ic.icon}
                  <span className="text-[9px] font-mono">{ic.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* System Prompt */}
          <div className="space-y-1">
            <div className="flex items-center justify-between font-mono">
              <label className="block text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">
                System Prompt Instructions <span className="text-[#D4FF00]">*</span>
              </label>
              <span className="text-[10px] text-[#737C8A]">{systemPrompt.length} chars</span>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Define exact AI persona, instructions, and required output structure. Page context is automatically injected into <page_context> tags."
              rows={5}
              className="w-full px-2.5 py-1.5 rounded-[2px] bg-[#121417] border border-[#2A303A] text-xs text-[#E0E3E8] font-mono placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 resize-y"
              required
            />
          </div>

          {/* Tags */}
          <div className="space-y-1 font-mono">
            <label className="block text-xs font-bold text-[#FFFFFF] uppercase tracking-wider">Tags</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Add tag (e.g. legal, research)"
                className="flex-1 px-2.5 py-1 rounded-[2px] bg-[#121417] border border-[#2A303A] text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00]"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-2.5 py-1 rounded-[2px] btn-graphite text-xs font-semibold flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>ADD</span>
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap pt-1">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] font-mono px-2 py-0.2 rounded-[2px] bg-[#121417] border border-[#2A303A] text-[#9DA5B2] flex items-center gap-1"
                  >
                    <span>#{t}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(t)}
                      className="hover:text-[#F59E0B]"
                      aria-label={`Remove tag ${t}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-4 py-2.5 bg-[#121417] border-t border-[#2A303A] flex items-center justify-end gap-2 font-mono">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-[2px] btn-graphite text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="px-3.5 py-1.5 rounded-[2px] btn-lime text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-40"
          >
            {isSaving ? (
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                <span>Saving...</span>
              </span>
            ) : (
              <>
                <Save className="w-3 h-3" />
                <span>Save Skill</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
