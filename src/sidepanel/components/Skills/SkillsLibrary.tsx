import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Plus,
  Download,
  Upload,
  RotateCcw,
  Search,
  CheckCircle2,
  AlertCircle,
  FileText,
  KeyRound,
  Layers,
  ArrowRight,
  BookOpen,
  Compass,
  Sliders,
  Terminal,
} from 'lucide-react';
import {
  SkillDefinition,
  SkillWorkflowType,
  SkillExecutionResult,
} from '../../../types/skills';
import { AISettings } from '../../../types/ai';
import {
  getSkills,
  saveSkill,
  deleteSkill,
  resetStarterSkills,
  exportSkillsToJson,
  importSkillsFromJson,
} from '../../../services/storage/skillsStore';
import {
  streamSkill,
  isProfileSkill,
} from '../../../services/ai/skillExecutor';
import {
  requestTabContentExtraction,
  getActiveTab,
} from '../../../services/reader';
import SkillCard from './SkillCard';
import SkillModal from './SkillModal';
import SkillExecutionDrawer from './SkillExecutionDrawer';

export interface SkillsLibraryProps {
  settings: AISettings;
  onOpenSettings?: () => void;
  onRunAgentGoal?: (goal: string) => void;
  onOpenInChat?: (text: string) => void;
  className?: string;
}

type CategoryFilter = 'all' | 'summary' | 'explanation' | 'reply' | 'fill_profile' | 'custom';

export default function SkillsLibrary({
  settings,
  onOpenSettings,
  onRunAgentGoal,
  onOpenInChat,
  className = '',
}: SkillsLibraryProps) {
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null);

  // Execution states
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [activeExecutionSkill, setActiveExecutionSkill] = useState<SkillDefinition | null>(null);
  const [pageTitle, setPageTitle] = useState<string>('');
  const [pageUrl, setPageUrl] = useState<string>('');
  const [userInstructions, setUserInstructions] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamedText, setStreamedText] = useState<string>('');
  const [executionResult, setExecutionResult] = useState<SkillExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);

  // Import modal states
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importJsonText, setImportJsonText] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const hasApiKey = Boolean(settings.geminiApiKey && settings.geminiApiKey.trim().length >= 10);

  useEffect(() => {
    loadSkills();
    loadTabInfo();
  }, []);

  const loadSkills = async () => {
    setIsLoading(true);
    try {
      const items = await getSkills();
      setSkills(items);
    } catch (err) {
      console.warn('[SkillsLibrary] Error loading skills:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTabInfo = async () => {
    try {
      const tab = await getActiveTab();
      if (tab) {
        setPageTitle(tab.title || '');
        setPageUrl(tab.url || '');
      }
    } catch {
      // ignore
    }
  };

  const handleSaveSkill = async (
    skillData: Partial<SkillDefinition> & { name: string; systemPrompt: string }
  ) => {
    try {
      await saveSkill(skillData);
      await loadSkills();
      setIsModalOpen(false);
      setEditingSkill(null);
      showFeedback('success', `Skill "${skillData.name}" saved successfully`);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to save skill');
    }
  };

  const handleDeleteSkill = async (skill: SkillDefinition) => {
    if (!confirm(`Are you sure you want to delete "${skill.name}"?`)) return;
    try {
      await deleteSkill(skill.id);
      await loadSkills();
      showFeedback('success', `Deleted "${skill.name}"`);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to delete skill');
    }
  };

  const handleRunSkill = async (skill: SkillDefinition) => {
    if (isProfileSkill(skill)) {
      onRunAgentGoal?.(`Fill this form from my profile`);
      return;
    }

    if (!hasApiKey) {
      showFeedback('error', 'Google Gemini API Key is required to run skills');
      onOpenSettings?.();
      return;
    }

    setActiveExecutionSkill(skill);
    setIsDrawerOpen(true);
    setIsStreaming(true);
    setStreamedText('');
    setExecutionResult(null);
    setExecutionError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const tab = await getActiveTab();
      let pageText = '';
      if (tab?.id) {
        setPageTitle(tab.title || '');
        setPageUrl(tab.url || '');
        const extracted = await requestTabContentExtraction(tab.id);
        if (extracted.success && extracted.textContent) {
          pageText = extracted.textContent;
        }
      }

      const result = await streamSkill(
        skill,
        {
          contextText: pageText,
          userInstructions,
          settings,
          signal: controller.signal,
        },
        (chunk: string) => {
          setStreamedText((prev) => prev + chunk);
        }
      );

      setExecutionResult(result);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setExecutionError(err?.message || 'Skill execution failed.');
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleAbortExecution = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  };

  const handleResetDefaults = async () => {
    if (!confirm('Reset all built-in starter skills to factory defaults? Your custom skills will be preserved.')) return;
    try {
      await resetStarterSkills();
      await loadSkills();
      showFeedback('success', 'Starter skills reset to factory defaults');
    } catch (err: any) {
      showFeedback('error', err?.message || 'Failed to reset skills');
    }
  };

  const handleExportAll = async () => {
    try {
      const json = await exportSkillsToJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `askbro-skills-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showFeedback('success', 'Skills exported to JSON file');
    } catch (err: any) {
      showFeedback('error', err?.message || 'Export failed');
    }
  };

  const handleExportSingle = async (skill: SkillDefinition) => {
    try {
      const json = await exportSkillsToJson([skill.id]);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `askbro-skill-${skill.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showFeedback('success', `Exported "${skill.name}"`);
    } catch (err: any) {
      showFeedback('error', err?.message || 'Export failed');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (text) {
        try {
          const imported = await importSkillsFromJson(text);
          await loadSkills();
          showFeedback('success', `Successfully imported ${imported.importedCount} skills`);
        } catch (err: any) {
          showFeedback('error', err?.message || 'Failed to import JSON file');
        }
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 3500);
  };

  const filteredSkills = skills.filter((s) => {
    const matchesSearch =
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (activeCategory === 'all') return true;
    if (activeCategory === 'custom') return !s.isBuiltIn;
    return s.actionWorkflow === activeCategory;
  });

  return (
    <div className={`space-y-3 pb-8 p-3 bg-[#0C0D0E] text-[#E0E3E8] font-sans ${className}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#2A303A] font-mono">
        <div>
          <h1 className="text-xs font-bold text-[#FFFFFF] uppercase tracking-wider flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-[#D4FF00]" />
            <span>One-Click Skills Library</span>
          </h1>
          <p className="text-[9px] text-[#737C8A] mt-0.5">
            Targeted automation recipes engineered for active web pages
          </p>
        </div>

        {/* Global Action Toolbar */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setEditingSkill(null);
              setIsModalOpen(true);
            }}
            className="py-1 px-2.5 rounded-[2px] btn-lime text-xs font-bold flex items-center gap-1 shadow-sm"
          >
            <Plus className="w-3 h-3" />
            <span>NEW SKILL</span>
          </button>
        </div>
      </div>

      {/* API Key Missing Callout Banner */}
      {!hasApiKey && (
        <div className="p-2.5 rounded-[2px] bg-[#1A1712] border border-[#F59E0B]/50 text-[#E0E3E8] space-y-2 animate-fade-in font-sans">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h2 className="text-xs font-semibold text-[#FFFFFF] font-mono uppercase">Gemini API Key Required</h2>
              <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
                Connect your Gemini API key in settings to execute skills on active web pages.
              </p>
            </div>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="py-1 px-2.5 rounded-[2px] btn-lime text-xs font-semibold font-mono flex items-center gap-1.5 shadow-sm"
            >
              <KeyRound className="w-3 h-3" />
              <span>Configure API Key</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-2 rounded-[2px] border text-xs flex items-center gap-2 animate-fade-in font-mono ${
            feedback.type === 'success'
              ? 'bg-[#121812] border-[#D4FF00]/40 text-[#D4FF00]'
              : 'bg-[#1A1712] border-[#F59E0B]/50 text-[#F59E0B]'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Toolbar: Search + Import/Export Tools */}
      <div className="flex items-center gap-1.5 font-mono">
        <div className="relative flex-1">
          <Search className="w-3 h-3 text-[#737C8A] absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills, tags..."
            className="w-full pl-7 pr-2.5 py-1.5 rounded-[2px] bg-[#15181C] border border-[#2A303A] text-xs text-[#FFFFFF] placeholder-[#505967] focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 shadow-well-inset font-sans"
          />
        </div>

        {/* Hidden file input for import */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept=".json"
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 rounded-[2px] btn-graphite"
          title="Import skills from JSON file"
          aria-label="Import Skills JSON"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleExportAll}
          className="p-1.5 rounded-[2px] btn-graphite"
          title="Export all skills to JSON file"
          aria-label="Export All Skills"
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleResetDefaults}
          className="p-1.5 rounded-[2px] btn-graphite"
          title="Reset starter skills to default"
          aria-label="Reset Defaults"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Category Filter Chips */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none text-[10px] font-mono">
        {[
          { id: 'all', label: 'ALL' },
          { id: 'summary', label: 'EXAM & NOTES' },
          { id: 'explanation', label: 'EXPLAIN' },
          { id: 'reply', label: 'REPLY' },
          { id: 'fill_profile', label: 'AUTOFILL' },
          { id: 'custom', label: 'CUSTOM' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveCategory(tab.id as CategoryFilter)}
            className={`px-2 py-0.5 rounded-[2px] whitespace-nowrap transition-all font-semibold ${
              activeCategory === tab.id
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] shadow-sm'
                : 'bg-[#121417] text-[#9DA5B2] hover:text-[#FFFFFF] border border-[#2A303A]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Skills Grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-10 text-[#737C8A] space-y-2 font-mono">
          <div className="w-5 h-5 border-2 border-[#2A303A] border-t-[#D4FF00] rounded-full animate-spin" />
          <span className="text-xs">Loading skills library...</span>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="p-6 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-center space-y-2 shadow-sm font-sans">
          <BookOpen className="w-6 h-6 text-[#737C8A] mx-auto" />
          <p className="text-xs font-mono font-bold text-[#FFFFFF] uppercase">No matching skills found</p>
          <p className="text-[11px] text-[#9DA5B2]">
            {searchQuery
              ? `No skills matched "${searchQuery}". Clear your search or create a new skill.`
              : 'Create your first custom one-click skill recipe.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setActiveCategory('all');
            }}
            className="text-xs font-mono text-[#D4FF00] hover:underline pt-1 inline-block"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onRun={handleRunSkill}
              onEdit={(s) => {
                setEditingSkill(s);
                setIsModalOpen(true);
              }}
              onDelete={handleDeleteSkill}
              onExport={handleExportSingle}
              isExecuting={isStreaming && activeExecutionSkill?.id === skill.id}
            />
          ))}
        </div>
      )}

      {/* Skill Creation / Edit Modal */}
      <SkillModal
        isOpen={isModalOpen}
        skill={editingSkill}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSkill(null);
        }}
        onSave={handleSaveSkill}
      />

      {/* Skill Execution Drawer */}
      <SkillExecutionDrawer
        isOpen={isDrawerOpen}
        skill={activeExecutionSkill}
        pageTitle={pageTitle}
        pageUrl={pageUrl}
        isStreaming={isStreaming}
        streamedText={streamedText}
        result={executionResult}
        error={executionError}
        userInstructions={userInstructions}
        onUserInstructionsChange={setUserInstructions}
        onRun={() => activeExecutionSkill && handleRunSkill(activeExecutionSkill)}
        onAbort={handleAbortExecution}
        onClose={() => {
          handleAbortExecution();
          setIsDrawerOpen(false);
          setActiveExecutionSkill(null);
        }}
        onContinueInChat={(chatText) => {
          setIsDrawerOpen(false);
          onOpenInChat?.(chatText);
        }}
      />
    </div>
  );
}
