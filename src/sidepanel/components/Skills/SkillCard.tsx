import React from 'react';
import {
  GraduationCap,
  Languages,
  MailCheck,
  UserCheck,
  BookOpen,
  Brain,
  Terminal,
  Zap,
  MessageSquare,
  Edit3,
  Trash2,
  Download,
  Play,
  Compass,
} from 'lucide-react';
import { SkillDefinition } from '../../../types/skills';

export interface SkillCardProps {
  skill: SkillDefinition;
  onRun: (skill: SkillDefinition) => void;
  onEdit: (skill: SkillDefinition) => void;
  onDelete?: (skill: SkillDefinition) => void;
  onExport?: (skill: SkillDefinition) => void;
  isExecuting?: boolean;
}

export function getSkillIcon(iconName?: string) {
  switch (iconName) {
    case 'GraduationCap':
      return <GraduationCap className="w-3.5 h-3.5 text-[#D4FF00]" />;
    case 'Languages':
      return <Languages className="w-3.5 h-3.5 text-[#F59E0B]" />;
    case 'MailCheck':
      return <MailCheck className="w-3.5 h-3.5 text-[#D4FF00]" />;
    case 'UserCheck':
      return <UserCheck className="w-3.5 h-3.5 text-[#E0E3E8]" />;
    case 'BookOpen':
      return <BookOpen className="w-3.5 h-3.5 text-[#FFFFFF]" />;
    case 'Brain':
      return <Brain className="w-3.5 h-3.5 text-[#D4FF00]" />;
    case 'Terminal':
      return <Terminal className="w-3.5 h-3.5 text-[#9DA5B2]" />;
    case 'Zap':
      return <Zap className="w-3.5 h-3.5 text-[#F59E0B]" />;
    case 'MessageSquare':
      return <MessageSquare className="w-3.5 h-3.5 text-[#D4FF00]" />;
    default:
      return <Compass className="w-3.5 h-3.5 text-[#D4FF00]" />;
  }
}

export function getWorkflowBadge(workflow?: string) {
  switch (workflow) {
    case 'summary':
      return { label: 'Exam & Notes', color: 'bg-[#121417] text-[#FFFFFF] border-[#2A303A]' };
    case 'explanation':
      return { label: 'Hinglish Explainer', color: 'bg-[#121417] text-[#D4FF00] border-[#D4FF00]/40' };
    case 'reply':
      return { label: 'Polite Draft', color: 'bg-[#121417] text-[#E0E3E8] border-[#343B45]' };
    case 'fill_profile':
      return { label: 'Agent Autofill', color: 'bg-[#2A1E0B] text-[#F59E0B] border-[#F59E0B]/40' };
    default:
      return { label: 'Custom Recipe', color: 'bg-[#121417] text-[#9DA5B2] border-[#2A303A]' };
  }
}

export default function SkillCard({
  skill,
  onRun,
  onEdit,
  onDelete,
  onExport,
  isExecuting = false,
}: SkillCardProps) {
  const workflowBadge = getWorkflowBadge(skill.actionWorkflow);

  return (
    <div className="flex flex-col justify-between p-3 rounded-[2px] bg-[#181B1F] border border-[#2A303A] hover:border-[#343B45] transition-all duration-150 group shadow-sm font-sans">
      {/* Top Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[2px] bg-[#121417] border border-[#2A303A] flex items-center justify-center shrink-0">
              {getSkillIcon(skill.icon)}
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="font-semibold text-xs text-[#FFFFFF] group-hover:text-[#D4FF00] transition-colors">
                  {skill.name}
                </h3>
                {skill.isBuiltIn ? (
                  <span className="text-[9px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.2 rounded-[2px] bg-[#121417] text-[#9DA5B2] border border-[#2A303A]">
                    Starter
                  </span>
                ) : (
                  <span className="text-[9px] font-mono uppercase tracking-wider font-semibold px-1.5 py-0.2 rounded-[2px] bg-[#2A1E0B] text-[#F59E0B] border border-[#F59E0B]/40">
                    Custom
                  </span>
                )}
              </div>
              <span
                className={`inline-block text-[9px] font-mono font-medium px-1.5 py-0.2 rounded-[2px] border mt-1 ${workflowBadge.color}`}
              >
                {workflowBadge.label}
              </span>
            </div>
          </div>

          {/* Quick Toolbar */}
          <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
            {onExport && (
              <button
                type="button"
                onClick={() => onExport(skill)}
                className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#20242A] transition-colors"
                title="Export this skill as JSON"
                aria-label={`Export ${skill.name}`}
              >
                <Download className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onEdit(skill)}
              className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#FFFFFF] hover:bg-[#20242A] transition-colors"
              title="Edit skill details and prompt"
              aria-label={`Edit ${skill.name}`}
            >
              <Edit3 className="w-3 h-3" />
            </button>
            {onDelete && !skill.isBuiltIn && (
              <button
                type="button"
                onClick={() => onDelete(skill)}
                className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#F59E0B] hover:bg-[#2A1E0B] transition-colors"
                title="Delete this skill"
                aria-label={`Delete ${skill.name}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-[11px] text-[#9DA5B2] leading-relaxed line-clamp-2">
          {skill.description}
        </p>

        {/* Tags */}
        {skill.tags && skill.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            {skill.tags.map((t, idx) => (
              <span
                key={idx}
                className="text-[9px] text-[#737C8A] font-mono px-1 py-0.2 rounded-[2px] bg-[#121417] border border-[#22262E]"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Footer Run Action */}
      <div className="pt-2.5 mt-2 border-t border-[#22262E] flex items-center justify-between font-mono">
        <span className="text-[9px] text-[#737C8A] uppercase tracking-wider">ONE-CLICK DIRECT</span>
        <button
          type="button"
          onClick={() => onRun(skill)}
          disabled={isExecuting}
          className="py-1 px-2.5 rounded-[2px] btn-lime font-bold text-[11px] flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-40"
        >
          <Play className="w-2.5 h-2.5 fill-current" />
          <span>Run One-Click</span>
        </button>
      </div>
    </div>
  );
}
