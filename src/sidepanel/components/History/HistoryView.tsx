import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  MessageSquare,
  Bot,
  Search,
  Trash2,
  Download,
  Copy,
  Check,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Globe,
  Clock,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Activity,
  Layers,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import {
  ChatHistorySession,
  getChatHistory,
  deleteChatHistorySession,
  clearAllChatHistory,
  exportChatHistoryAsJson,
  exportChatHistoryAsMarkdown,
  getAgentActionHistory,
  clearAgentActionHistory,
  deleteAgentAuditEntry,
  getAppHistorySummary,
  clearAllAppHistory,
  AppHistorySummary,
} from '../../../services/storage/historyStore';
import { ActionAuditLogEntry } from '../../../types/action';

export interface HistoryViewProps {
  onBack: () => void;
  onLoadChatSession: (session: ChatHistorySession) => void;
  onOpenAgentWithGoal?: (goal: string) => void;
}

type HistoryTab = 'chat' | 'agent' | 'all';

export default function HistoryView({
  onBack,
  onLoadChatSession,
  onOpenAgentWithGoal,
}: HistoryViewProps) {
  const [activeTab, setActiveTab] = useState<HistoryTab>('chat');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [chatSessions, setChatSessions] = useState<ChatHistorySession[]>([]);
  const [auditLogs, setAuditLogs] = useState<ActionAuditLogEntry[]>([]);
  const [summary, setSummary] = useState<AppHistorySummary>({
    chatSessionsCount: 0,
    totalChatMessages: 0,
    agentActionsCount: 0,
    lastActiveTimestamp: null,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [agentFilterStatus, setAgentFilterStatus] = useState<string>('all');
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Load history data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [chats, audits, sum] = await Promise.all([
        getChatHistory(),
        getAgentActionHistory(),
        getAppHistorySummary(),
      ]);
      setChatSessions(chats);
      setAuditLogs(audits);
      setSummary(sum);
    } catch (err) {
      console.error('[ASKbro HistoryView] Error loading history data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const showNotice = (msg: string) => {
    setFeedbackNotice(msg);
    setTimeout(() => setFeedbackNotice(null), 3000);
  };

  // Filtered Chat Sessions
  const filteredChatSessions = useMemo(() => {
    if (!searchQuery.trim()) return chatSessions;
    const q = searchQuery.toLowerCase().trim();
    return chatSessions.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.url.toLowerCase().includes(q)) return true;
      if (s.previewText.toLowerCase().includes(q)) return true;
      return s.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [chatSessions, searchQuery]);

  // Filtered Agent Audit Logs
  const filteredAuditLogs = useMemo(() => {
    let result = auditLogs;
    if (agentFilterStatus !== 'all') {
      result = result.filter((e) => e.status === agentFilterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((e) => {
        if (e.goal && e.goal.toLowerCase().includes(q)) return true;
        if (e.tabTitle && e.tabTitle.toLowerCase().includes(q)) return true;
        if (e.tabUrl && e.tabUrl.toLowerCase().includes(q)) return true;
        if (e.reason && e.reason.toLowerCase().includes(q)) return true;
        if (e.action && e.action.toLowerCase().includes(q)) return true;
        if (e.value && e.value.toLowerCase().includes(q)) return true;
        return false;
      });
    }
    return result;
  }, [auditLogs, agentFilterStatus, searchQuery]);

  // Delete single chat session
  const handleDeleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteChatHistorySession(id);
    setChatSessions((prev) => prev.filter((s) => s.id !== id));
    if (expandedSessionId === id) setExpandedSessionId(null);
    showNotice('Conversation removed from history.');
    getAppHistorySummary().then(setSummary);
  };

  // Delete single agent audit log entry
  const handleDeleteAudit = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteAgentAuditEntry(id);
    setAuditLogs((prev) => prev.filter((entry) => entry.id !== id));
    showNotice('Audit entry removed.');
    getAppHistorySummary().then(setSummary);
  };

  // Clear based on current active tab
  const handleConfirmClear = async () => {
    if (activeTab === 'chat') {
      await clearAllChatHistory();
      setChatSessions([]);
      showNotice('All chat conversation history cleared.');
    } else if (activeTab === 'agent') {
      await clearAgentActionHistory();
      setAuditLogs([]);
      showNotice('All agent action logs cleared.');
    } else {
      await clearAllAppHistory();
      setChatSessions([]);
      setAuditLogs([]);
      showNotice('All conversation and activity history cleared.');
    }
    setShowClearConfirm(false);
    getAppHistorySummary().then(setSummary);
  };

  // Copy full transcript of a chat
  const handleCopyTranscript = async (session: ChatHistorySession, e: React.MouseEvent) => {
    e.stopPropagation();
    const md = await exportChatHistoryAsMarkdown(session.id);
    await navigator.clipboard.writeText(md);
    setCopiedId(session.id);
    setTimeout(() => setCopiedId(null), 2000);
    showNotice('Conversation transcript copied to clipboard!');
  };

  // Export JSON download
  const handleExportJson = async () => {
    try {
      let exportString = '';
      let filename = 'askbro-history.json';
      if (activeTab === 'chat') {
        exportString = await exportChatHistoryAsJson();
        filename = `askbro-chat-history-${Date.now()}.json`;
      } else if (activeTab === 'agent') {
        exportString = JSON.stringify(auditLogs, null, 2);
        filename = `askbro-audit-log-${Date.now()}.json`;
      } else {
        const fullBackup = {
          chatSessions,
          auditLogs,
          exportedAt: new Date().toISOString(),
        };
        exportString = JSON.stringify(fullBackup, null, 2);
        filename = `askbro-full-history-${Date.now()}.json`;
      }

      const blob = new Blob([exportString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotice(`Exported ${filename} successfully!`);
    } catch (err) {
      console.error('[ASKbro HistoryView] Export error:', err);
    }
  };

  // Export Markdown download
  const handleExportMarkdown = async () => {
    try {
      const md = await exportChatHistoryAsMarkdown();
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `askbro-chat-transcript-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotice('Exported Markdown transcript successfully!');
    } catch (err) {
      console.error('[ASKbro HistoryView] Export markdown error:', err);
    }
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return 'Unknown';
    const now = Date.now();
    const diff = now - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-[#0C0D0E] text-[#E0E3E8] font-sans">
      {/* Top Console Navigation Bar */}
      <div className="px-3.5 py-2.5 bg-[#121417] border-b border-[#2A303A] sticky top-0 z-20 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="p-1 rounded-[2px] text-[#9DA5B2] hover:text-[#FFFFFF] hover:bg-[#20242A] border border-transparent hover:border-[#343B45] transition-all"
              title="Return to previous view"
              aria-label="Back"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1.5">
              <History className="w-4 h-4 text-[#D4FF00]" />
              <h2 className="font-mono font-bold text-xs uppercase tracking-wider text-[#FFFFFF]">
                Activity & Audit History
              </h2>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <button
              onClick={handleExportJson}
              className="px-2 py-0.5 rounded-[2px] bg-[#181B1F] hover:bg-[#20242A] text-[#9DA5B2] hover:text-[#FFFFFF] border border-[#2A303A] hover:border-[#343B45] transition-all flex items-center gap-1"
              title="Download JSON Export"
            >
              <Download className="w-2.5 h-2.5" />
              <span>JSON</span>
            </button>

            {activeTab === 'chat' && (
              <button
                onClick={handleExportMarkdown}
                className="px-2 py-0.5 rounded-[2px] bg-[#181B1F] hover:bg-[#20242A] text-[#9DA5B2] hover:text-[#FFFFFF] border border-[#2A303A] hover:border-[#343B45] transition-all flex items-center gap-1"
                title="Download Markdown Transcript"
              >
                <FileText className="w-2.5 h-2.5" />
                <span>MD</span>
              </button>
            )}

            <button
              onClick={() => setShowClearConfirm(true)}
              className="px-2 py-0.5 rounded-[2px] bg-[#1A1212] hover:bg-[#2A1616] text-[#EF4444] border border-[#EF4444]/30 hover:border-[#EF4444]/60 transition-all flex items-center gap-1"
              title="Clear Records"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>CLEAR</span>
            </button>
          </div>
        </div>

        {/* Telemetry Summary Ticker */}
        <div className="p-2 rounded-[2px] bg-[#181B1F] border border-[#22262E] grid grid-cols-3 gap-2 font-mono text-[10px]">
          <div className="flex flex-col">
            <span className="text-[#737C8A] uppercase tracking-wider text-[9px]">CONVERSATIONS</span>
            <span className="text-xs font-bold text-[#D4FF00]">{summary.chatSessionsCount}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[#737C8A] uppercase tracking-wider text-[9px]">MESSAGES</span>
            <span className="text-xs font-bold text-[#FFFFFF]">{summary.totalChatMessages}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[#737C8A] uppercase tracking-wider text-[9px]">AGENT ACTIONS</span>
            <span className="text-xs font-bold text-[#38BDF8]">{summary.agentActionsCount}</span>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#737C8A]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search past conversations, goals, URLs, queries..."
            className="w-full pl-8 pr-7 py-1.5 bg-[#181B1F] border border-[#2A303A] rounded-[2px] text-xs text-[#FFFFFF] placeholder-[#737C8A] focus:outline-none focus:border-[#D4FF00] focus:ring-1 focus:ring-[#D4FF00]/30 font-sans transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737C8A] hover:text-[#FFFFFF] text-xs px-1"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Channel Segmented Switcher */}
        <div className="grid grid-cols-3 gap-1 p-0.5 rounded-[2px] bg-[#0C0D0E] border border-[#2A303A] font-mono text-[10px]">
          <button
            onClick={() => setActiveTab('chat')}
            className={`py-1 rounded-[2px] flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'chat'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] font-semibold shadow-sm'
                : 'text-[#9DA5B2] hover:text-[#FFFFFF]'
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            <span>CHATS ({chatSessions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('agent')}
            className={`py-1 rounded-[2px] flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'agent'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] font-semibold shadow-sm'
                : 'text-[#9DA5B2] hover:text-[#FFFFFF]'
            }`}
          >
            <Activity className="w-3 h-3" />
            <span>AGENT ({auditLogs.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`py-1 rounded-[2px] flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'all'
                ? 'bg-[#20242A] text-[#D4FF00] border border-[#343B45] font-semibold shadow-sm'
                : 'text-[#9DA5B2] hover:text-[#FFFFFF]'
            }`}
          >
            <Layers className="w-3 h-3" />
            <span>TIMELINE</span>
          </button>
        </div>

        {/* Agent Filter Status Tabs (When on agent or all tab) */}
        {(activeTab === 'agent' || activeTab === 'all') && (
          <div className="flex items-center gap-1 font-mono text-[9px] pt-0.5 overflow-x-auto">
            <span className="text-[#737C8A] uppercase mr-1">Status:</span>
            {['all', 'completed', 'approved', 'skipped', 'failed'].map((st) => (
              <button
                key={st}
                onClick={() => setAgentFilterStatus(st)}
                className={`px-1.5 py-0.5 rounded-[2px] uppercase transition-colors ${
                  agentFilterStatus === st
                    ? 'bg-[#D4FF00] text-[#0C0D0E] font-bold'
                    : 'bg-[#181B1F] text-[#9DA5B2] hover:text-[#FFFFFF] border border-[#2A303A]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Temporary Feedback Notification Banner */}
      {feedbackNotice && (
        <div className="mx-3 mt-2 p-2 rounded-[2px] bg-[#121A12] border border-[#D4FF00]/40 text-[#D4FF00] font-mono text-[11px] flex items-center gap-2 animate-fade-in shadow-sm">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{feedbackNotice}</span>
        </div>
      )}

      {/* Clear Confirmation Modal / Banner */}
      {showClearConfirm && (
        <div className="mx-3 mt-2 p-3 rounded-[2px] bg-[#1A1212] border border-[#EF4444]/60 space-y-2 animate-fade-in font-sans">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h4 className="font-mono text-xs font-bold text-[#FFFFFF] uppercase">
                Confirm History Deletion
              </h4>
              <p className="text-[11px] text-[#C2C7D0] leading-relaxed">
                {activeTab === 'chat'
                  ? 'Permanently delete all saved chat conversations from local storage?'
                  : activeTab === 'agent'
                  ? 'Permanently delete all agent action audit logs?'
                  : 'Permanently wipe all conversation and agent history?'}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1 font-mono text-[11px]">
            <button
              onClick={() => setShowClearConfirm(false)}
              className="px-2.5 py-1 rounded-[2px] bg-[#181B1F] text-[#9DA5B2] hover:text-[#FFFFFF] border border-[#2A303A]"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmClear}
              className="px-2.5 py-1 rounded-[2px] bg-[#DC2626] hover:bg-[#EF4444] text-[#FFFFFF] font-bold shadow-sm"
            >
              Delete Permanently
            </button>
          </div>
        </div>
      )}

      {/* Main History Feed Viewport */}
      <div className="flex-1 p-3 overflow-y-auto space-y-2.5 min-h-0">
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-2 text-[#737C8A] font-mono text-xs">
            <RotateCcw className="w-5 h-5 text-[#D4FF00] animate-spin" />
            <span>Scanning storage records...</span>
          </div>
        ) : (
          <>
            {/* 1. CHAT SESSIONS TAB */}
            {(activeTab === 'chat' || activeTab === 'all') && (
              <div className="space-y-2">
                {activeTab === 'all' && chatSessions.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#D4FF00] font-bold uppercase tracking-wider pt-1">
                    <MessageSquare className="w-3 h-3" />
                    <span>Saved Chat Conversations ({filteredChatSessions.length})</span>
                  </div>
                )}

                {filteredChatSessions.length === 0 && activeTab === 'chat' && (
                  <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-2.5 max-w-xs mx-auto font-sans">
                    <div className="w-9 h-9 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#737C8A] flex items-center justify-center">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-mono font-bold text-xs text-[#FFFFFF] uppercase tracking-wider">
                        {searchQuery ? 'No Matching Conversations' : 'No Chat History Yet'}
                      </h3>
                      <p className="text-[11px] text-[#9DA5B2] leading-relaxed">
                        {searchQuery
                          ? `No conversation matched "${searchQuery}". Try different search keywords.`
                          : 'Conversations you have with webpages are automatically recorded here for instant review, export, and resumption.'}
                      </p>
                    </div>
                  </div>
                )}

                {filteredChatSessions.map((session) => {
                  const isExpanded = expandedSessionId === session.id;
                  const isCopied = copiedId === session.id;

                  return (
                    <div
                      key={session.id}
                      className="rounded-[2px] bg-[#181B1F] border border-[#2A303A] hover:border-[#3D4552] transition-all shadow-sm overflow-hidden"
                    >
                      {/* Card Header / Summary */}
                      <div className="p-2.5 flex flex-col gap-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <div className="w-5 h-5 rounded-[2px] bg-[#121417] text-[#D4FF00] border border-[#2A303A] flex items-center justify-center shrink-0 mt-0.5">
                              <Globe className="w-3 h-3" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3
                                className="text-xs font-semibold text-[#FFFFFF] truncate font-sans hover:text-[#D4FF00] transition-colors cursor-pointer"
                                title={session.title}
                                onClick={() => onLoadChatSession(session)}
                              >
                                {session.title || 'Web Conversation'}
                              </h3>
                              <p className="text-[10px] text-[#737C8A] font-mono truncate" title={session.url}>
                                {session.url || 'Internal prompt session'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                            <span className="text-[#737C8A] flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              <span>{formatTimestamp(session.updatedAt)}</span>
                            </span>
                            <span className="px-1.5 py-0.2 rounded-[2px] bg-[#20242A] border border-[#343B45] text-[#D4FF00] font-semibold text-[9px]">
                              {session.messageCount || session.messages.length} msgs
                            </span>
                          </div>
                        </div>

                        {/* Snippet / Preview Text */}
                        <p className="text-[11px] text-[#9DA5B2] line-clamp-2 leading-relaxed bg-[#121417] p-1.5 rounded-[2px] border border-[#22262E] font-sans">
                          &ldquo;{session.previewText}&rdquo;
                        </p>

                        {/* Actions Toolbar */}
                        <div className="flex items-center justify-between pt-1 border-t border-[#22262E] font-mono text-[10px]">
                          <div className="flex items-center gap-1.5">
                            {/* Resume / Load into Chat */}
                            <button
                              type="button"
                              onClick={() => onLoadChatSession(session)}
                              className="px-2 py-1 rounded-[2px] btn-lime font-semibold flex items-center gap-1 shadow-sm"
                              title="Resume or review this conversation in Chat"
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                              <span>Resume Chat</span>
                            </button>

                            {/* View Transcript Accordion */}
                            <button
                              type="button"
                              onClick={() => setExpandedSessionId(isExpanded ? null : session.id)}
                              className="px-2 py-1 rounded-[2px] bg-[#121417] hover:bg-[#20242A] text-[#E0E3E8] border border-[#2A303A] hover:border-[#343B45] transition-colors flex items-center gap-1"
                            >
                              <span>{isExpanded ? 'Hide' : 'Inspect'}</span>
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            {/* Copy Transcript */}
                            <button
                              type="button"
                              onClick={(e) => handleCopyTranscript(session, e)}
                              className="p-1 rounded-[2px] text-[#9DA5B2] hover:text-[#FFFFFF] hover:bg-[#20242A] transition-colors"
                              title="Copy markdown transcript"
                            >
                              {isCopied ? <Check className="w-3 h-3 text-[#D4FF00]" /> : <Copy className="w-3 h-3" />}
                            </button>

                            {/* Delete Chat */}
                            <button
                              type="button"
                              onClick={(e) => handleDeleteChat(session.id, e)}
                              className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#EF4444] hover:bg-[#2A1616] transition-colors"
                              title="Delete conversation"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded In-Line Message Viewer */}
                      {isExpanded && (
                        <div className="p-3 bg-[#121417] border-t border-[#2A303A] space-y-2.5 max-h-72 overflow-y-auto font-sans">
                          <div className="flex items-center justify-between text-[10px] font-mono text-[#737C8A] border-b border-[#22262E] pb-1">
                            <span>TRANSCRIPT PREVIEW</span>
                            <span>{new Date(session.updatedAt).toLocaleString()}</span>
                          </div>

                          {session.messages.map((m, idx) => {
                            const isUser = m.role === 'user';
                            return (
                              <div
                                key={m.id || idx}
                                className={`p-2 rounded-[2px] text-[11px] space-y-1 ${
                                  isUser
                                    ? 'bg-[#181B1F] border border-[#2A303A] text-[#FFFFFF]'
                                    : 'bg-[#15191E] border border-[#343B45] text-[#E0E3E8]'
                                }`}
                              >
                                <div className="flex items-center justify-between font-mono text-[9px] text-[#737C8A]">
                                  <span className="flex items-center gap-1 uppercase font-bold">
                                    {isUser ? (
                                      <>
                                        <span className="text-[#D4FF00]">USER</span>
                                      </>
                                    ) : (
                                      <>
                                        <Bot className="w-2.5 h-2.5 text-[#38BDF8]" />
                                        <span className="text-[#38BDF8]">ASKBRO AI</span>
                                      </>
                                    )}
                                  </span>
                                  {m.grounded && (
                                    <span className="text-[#D4FF00] uppercase font-bold text-[8px] bg-[#1A2505] px-1 rounded-[2px] border border-[#D4FF00]/30">
                                      DOM Grounded
                                    </span>
                                  )}
                                </div>
                                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                              </div>
                            );
                          })}

                          <div className="pt-1 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => onLoadChatSession(session)}
                              className="px-2.5 py-1 rounded-[2px] btn-lime font-mono text-[10px] font-bold flex items-center gap-1 shadow-sm"
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                              <span>Load into Active Chat</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 2. AGENT AUDIT LOGS TAB */}
            {(activeTab === 'agent' || activeTab === 'all') && (
              <div className="space-y-2 pt-1">
                {activeTab === 'all' && auditLogs.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#38BDF8] font-bold uppercase tracking-wider pt-2">
                    <Activity className="w-3 h-3" />
                    <span>Agent Action Audit Trail ({filteredAuditLogs.length})</span>
                  </div>
                )}

                {filteredAuditLogs.length === 0 && activeTab === 'agent' && (
                  <div className="py-12 px-4 flex flex-col items-center justify-center text-center space-y-2.5 max-w-xs mx-auto font-sans">
                    <div className="w-9 h-9 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[#737C8A] flex items-center justify-center">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-mono font-bold text-xs text-[#FFFFFF] uppercase tracking-wider">
                        {searchQuery ? 'No Matching Actions' : 'No Agent Actions Executed Yet'}
                      </h3>
                      <p className="text-[11px] text-[#9DA5B2] leading-relaxed">
                        {searchQuery
                          ? `No actions matched "${searchQuery}".`
                          : 'Autonomous browser actions like button clicks, form fills, and element selections will be securely logged here.'}
                      </p>
                    </div>
                  </div>
                )}

                {filteredAuditLogs.map((entry) => {
                  const isSuccess = entry.status === 'completed' || entry.status === 'approved';
                  const isSkipped = entry.status === 'skipped';
                  const isFailed = entry.status === 'failed' || entry.status === 'stopped';

                  return (
                    <div
                      key={entry.id}
                      className="p-2.5 rounded-[2px] bg-[#181B1F] border border-[#2A303A] text-[11px] flex flex-col gap-1.5 shadow-sm font-sans"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 font-mono">
                          <span className="text-[#D4FF00] font-bold text-xs">#{entry.stepNumber}</span>
                          <span className="px-1.5 py-0.2 rounded-[2px] bg-[#121417] border border-[#343B45] text-[#FFFFFF] font-bold text-[9px] uppercase">
                            {entry.action}
                          </span>
                          {entry.targetId !== null && (
                            <span className="text-[#9DA5B2] text-[10px]">Element #{entry.targetId}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[9px]">
                          <span className="text-[#737C8A]">{formatTimestamp(entry.timestamp || entry.executedAt)}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded-[2px] font-bold uppercase ${
                              isSuccess
                                ? 'bg-[#142000] text-[#D4FF00] border border-[#D4FF00]/40'
                                : isSkipped
                                ? 'bg-[#2A1E0B] text-[#F59E0B] border border-[#F59E0B]/40'
                                : 'bg-[#2A1414] text-[#EF4444] border border-[#EF4444]/40'
                            }`}
                          >
                            {entry.status}
                          </span>
                        </div>
                      </div>

                      {/* Goal / Reason */}
                      <p className="text-[#E0E3E8] leading-relaxed font-sans text-xs">
                        &ldquo;{entry.reason}&rdquo;
                      </p>

                      {/* Typed Value Preview (for type actions) */}
                      {entry.value && (
                        <div className="p-1 rounded-[2px] bg-[#121417] border border-[#22262E] font-mono text-[10px] text-[#9DA5B2] truncate">
                          <span className="text-[#737C8A] uppercase">INPUT:</span> &ldquo;{entry.value}&rdquo;
                        </div>
                      )}

                      {/* Target Page / URL & Quick Actions */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#22262E] text-[10px] font-mono text-[#737C8A]">
                        <span className="truncate max-w-[200px]" title={entry.tabUrl || entry.tabTitle || ''}>
                          {entry.tabTitle || entry.tabUrl || 'Browser page'}
                        </span>

                        <div className="flex items-center gap-1">
                          {entry.goal && onOpenAgentWithGoal && (
                            <button
                              type="button"
                              onClick={() => onOpenAgentWithGoal(entry.goal!)}
                              className="px-1.5 py-0.5 rounded-[2px] bg-[#121417] hover:bg-[#20242A] text-[#9DA5B2] hover:text-[#FFFFFF] border border-[#2A303A] transition-colors"
                              title="Run goal in Agent"
                            >
                              Re-run
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteAudit(entry.id, e)}
                            className="p-1 rounded-[2px] text-[#737C8A] hover:text-[#EF4444] hover:bg-[#2A1616] transition-colors"
                            title="Delete entry"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Industrial Machine Telemetry Footer */}
      <div className="px-3 py-1.5 bg-[#121417] border-t border-[#2A303A] font-mono text-[10px] text-[#737C8A] flex items-center justify-between">
        <span>LOCAL ENCLAVE PERSISTENCE</span>
        <span className="text-[#D4FF00]">STORAGE INTEGRITY: OPTIMAL</span>
      </div>
    </div>
  );
}
