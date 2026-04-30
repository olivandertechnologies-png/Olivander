import React, { useEffect, useRef, useState } from 'react';

import TodayPanel from './TodayPanel.jsx';
import InboxPanel from './InboxPanel.jsx';
import JobsPanel from './JobsPanel.jsx';
import TasksPanel from './TasksPanel.jsx';
import ApprovalsPanel from './ApprovalsPanel.jsx';
import ActivityPanel from './ActivityPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import LeadPipelinePanel from './LeadPipelinePanel.jsx';
import OnboardingWizard from './OnboardingWizard.jsx';
import {
  HouseIcon, TaskListIcon, CheckCircleIcon, LinesIcon, LeadPipelineIcon,
  ArrowLeftIcon, GearIcon, DatabaseIcon, FunnelIcon, SunIcon, LogoutIcon, ShieldIcon, MailIcon,
} from './icons.jsx';

import {
  DEFAULT_BUSINESS_NAME, MEMORY_KEYS, PANEL_TITLES, SETTINGS_SECTIONS_CONFIG,
  DEFAULT_POPUP_CLOSE_MS, PANEL_EXIT_MS, PANEL_ENTER_MS, THEME_SWITCH_MS,
  APPROVAL_REMOVE_MS, PROCESSING_PULSE_MS, PLAN_MOCK_DELAY_MS, INBOX_SYNC_INTERVAL_MS,
  RECENT_EMAILS_MAX, USE_MOCK_AGENT_PLAN,
} from '../utils/constants.js';
import {
  DEMO_MODE_STORAGE_KEY, PLAN_CONFIG, PLAN_KEYS, PLAN_STORAGE_KEY,
  createFirstCustomerSampleWorkspace,
  isPlusPlan, normalisePlanKey,
} from '../utils/firstCustomer.js';
import { getInitialTheme, getStoredSession, persistSession, getStoredProcessedEmailIds, persistProcessedEmailIds, decodeSessionPayload } from '../utils/storage.js';
import { trimToNull, formatDisplayName, toTimestamp, filterActivityItems } from '../utils/format.js';
import { buildBackendUrl, BACKEND_ORIGIN, readResponseDetail } from '../utils/api.js';
import { createEmptyMemoryProfile, normaliseMemoryProfile } from '../utils/memory.js';
import {
  createId, buildTaskFromRequest, normaliseAgentPlan, normaliseIncomingEmail,
  buildTaskFromEmail, normaliseBackendApproval, buildApprovalFromEmail, buildApprovalFromTask,
  createMockAgentPlan,
} from '../utils/task.js';

const SETTINGS_SECTIONS = SETTINGS_SECTIONS_CONFIG.map((item, i) => {
  const icons = [<GearIcon />, <CheckCircleIcon />, <DatabaseIcon />, <FunnelIcon />, <SunIcon />, <ShieldIcon />];
  return { ...item, icon: icons[i] };
});

const INITIAL_SAMPLE_WORKSPACE = createFirstCustomerSampleWorkspace();

export default function DashboardApp() {
  const processedEmailIdsRef = useRef(getStoredProcessedEmailIds());
  const oauthPollRef = useRef(null);
  const profileMenuTimerRef = useRef(null);
  const panelTimersRef = useRef([]);
  const themeSwitchTimerRef = useRef(null);
  const processingTimerRef = useRef(null);
  const approvalTimersRef = useRef({});
  const panelFrameRef = useRef(null);
  const pendingPanelRef = useRef(null);
  const isPanelTransitioningRef = useRef(false);
  const activePanelRef = useRef('home');

  const [theme, setTheme] = useState(getInitialTheme);
  const [isThemeSwitching, setIsThemeSwitching] = useState(false);
  const [sessionToken, setSessionToken] = useState(getStoredSession);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroBusy, setXeroBusy] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState(true); // default true to avoid flash; check on mount
  const [activePanel, setActivePanel] = useState('home');
  const [settingsSection, setSettingsSection] = useState('connections');
  const [plan, setPlan] = useState(() => normalisePlanKey(window.localStorage.getItem(PLAN_STORAGE_KEY)));
  const [demoMode, setDemoMode] = useState(() => window.localStorage.getItem(DEMO_MODE_STORAGE_KEY) !== 'false');
  const [profileMenuState, setProfileMenuState] = useState(null);
  const [homeInput, setHomeInput] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [showTaskComposer, setShowTaskComposer] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isWorkflowProcessing, setIsWorkflowProcessing] = useState(false);
  const [businessContactName, setBusinessContactName] = useState('');
  const [sessionBusinessName, setSessionBusinessName] = useState('');
  const [tasks, setTasks] = useState([]);
  const [taskFilter, setTaskFilter] = useState('all');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [removingTasks, setRemovingTasks] = useState({});
  const [removingApprovals, setRemovingApprovals] = useState({});
  const [activity, setActivity] = useState([]);
  const [activityFilter, setActivityFilter] = useState('all');
  const [recentEmails, setRecentEmails] = useState([]);
  const [recentEmailsError, setRecentEmailsError] = useState('');
  const [workspaceImportState, setWorkspaceImportState] = useState({ busy: false, message: '' });
  const [memoryProfile, setMemoryProfile] = useState(createEmptyMemoryProfile);
  const [isMemoryLoading, setIsMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState('');
  const [openLeadCount, setOpenLeadCount] = useState(0);
  const [firstCustomerInbox, setFirstCustomerInbox] = useState(() => INITIAL_SAMPLE_WORKSPACE.inbox);
  const [firstCustomerJobs, setFirstCustomerJobs] = useState(() => INITIAL_SAMPLE_WORKSPACE.jobs);
  const [firstCustomerActions, setFirstCustomerActions] = useState(() => INITIAL_SAMPLE_WORKSPACE.actions);
  const [firstCustomerActivity, setFirstCustomerActivity] = useState(() => INITIAL_SAMPLE_WORKSPACE.activity);
  const [selectedJobId, setSelectedJobId] = useState(() => INITIAL_SAMPLE_WORKSPACE.jobs[0]?.id ?? null);

  const sortedTasks = [...tasks].sort((l, r) => r.updatedAt - l.updatedAt);
  const visibleTasks = sortedTasks.filter((task) => taskFilter === 'all' ? true : task.status === taskFilter);
  const sortedApprovals = [...approvals].sort((l, r) => r.createdAt - l.createdAt);
  const activeTaskCount = tasks.filter((task) => task.status !== 'done').length;
  const businessName = trimToNull(memoryProfile[MEMORY_KEYS.businessName]) ?? DEFAULT_BUSINESS_NAME;
  const isSettingsPanel = activePanel === 'settings';
  const activePlan = normalisePlanKey(
    normalisePlanKey(plan) === PLAN_KEYS.plus
      ? plan
      : trimToNull(memoryProfile[MEMORY_KEYS.plan]) ?? plan,
  );
  const activePlanConfig = PLAN_CONFIG[activePlan] ?? PLAN_CONFIG[PLAN_KEYS.starter];
  const planIsPlus = isPlusPlan(activePlan);

  const combinedActivity = [
    ...firstCustomerActivity,
    ...activity,
    ...recentEmails.map((email) => ({
      id: `gmail-${email.id}`,
      title: trimToNull(email.senderName ?? email.from_name ?? email.from) ?? 'Inbox message',
      description: trimToNull(email.subject ?? email.snippet ?? email.body) ?? 'Recent Gmail activity',
      createdAt: toTimestamp(email.date),
      timestamp: toTimestamp(email.date),
      type: 'draft',
    })),
  ].sort((l, r) => (r.createdAt ?? r.timestamp ?? 0) - (l.createdAt ?? l.timestamp ?? 0));

  const visibleActivity = filterActivityItems(combinedActivity, activityFilter);
  const visibleFirstCustomerActions = firstCustomerActions.filter((action) => !['approved', 'dismissed', 'queued', 'rejected', 'delayed'].includes(action.status));
  const unlockedFirstCustomerActions = visibleFirstCustomerActions.filter((action) => !action.plusOnly || planIsPlus);
  const firstCustomerJobsToday = firstCustomerJobs.filter((job) => String(job.scheduledFor || '').includes('Today'));
  const firstCustomerQuoteFollowUps = firstCustomerJobs.filter((job) => job.status === 'quote_sent' && Number(job.quoteSentDaysAgo || 0) >= 5);
  const firstCustomerMoneyAtRisk = firstCustomerJobs.reduce((total, job) => {
    if (job.invoice?.status === 'overdue') return total + Number(job.invoice.amount || 0);
    return total;
  }, 0);
  const todayOpenActionCount = sortedApprovals.length + unlockedFirstCustomerActions.length;
  const todayStats = {
    awaitingApproval: sortedApprovals.length,
    newLeads: firstCustomerInbox.filter((message) => message.category === 'New lead').length + openLeadCount,
    quoteFollowUps: firstCustomerQuoteFollowUps.length,
    jobsToday: firstCustomerJobsToday.length,
    moneyAtRisk: firstCustomerMoneyAtRisk,
    calendarGaps: visibleFirstCustomerActions.filter((action) => action.type === 'calendar_gap').length,
  };

  const sessionPayload = decodeSessionPayload(sessionToken);
  const tokenContactName = trimToNull(String(sessionPayload?.contact_name ?? '')) ?? '';
  const tokenFirstName = trimToNull(String(sessionPayload?.first_name ?? '')) ?? '';
  const tokenEmailName = trimToNull(String(sessionPayload?.email ?? '')) ?? '';
  const ownerEmailName = trimToNull(String(memoryProfile[MEMORY_KEYS.ownerEmail] ?? '')) ?? '';
  const memoryBusinessName = trimToNull(memoryProfile[MEMORY_KEYS.businessName]) ?? '';
  const resolvedBusinessName =
    (trimToNull(sessionBusinessName) ?? '') ||
    (memoryBusinessName && memoryBusinessName !== DEFAULT_BUSINESS_NAME ? memoryBusinessName : '');
  const greetingName = [
    tokenContactName, tokenFirstName, trimToNull(businessContactName) ?? '',
    tokenEmailName, ownerEmailName, resolvedBusinessName,
  ].find((candidate) => formatDisplayName(candidate)) ?? '';

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem('olivander_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!tasks.length) { setExpandedTaskId(null); return; }
    if (expandedTaskId === null) return;
    if (tasks.some((task) => task.id === expandedTaskId)) return;
    setExpandedTaskId(tasks[0].id);
  }, [expandedTaskId, tasks]);

  useEffect(
    () => () => {
      panelTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      if (processingTimerRef.current) window.clearTimeout(processingTimerRef.current);
      if (profileMenuTimerRef.current) window.clearTimeout(profileMenuTimerRef.current);
      if (themeSwitchTimerRef.current) window.clearTimeout(themeSwitchTimerRef.current);
      if (oauthPollRef.current) window.clearInterval(oauthPollRef.current);
      Object.values(approvalTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadMemory() {
      if (!sessionToken) { setMemoryProfile(createEmptyMemoryProfile()); setMemoryError(''); setIsMemoryLoading(false); return; }
      setIsMemoryLoading(true); setMemoryError('');
      try {
        const response = await fetchProtected('/api/memory');
        if (response.status === 401) return;
        if (!response.ok) throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
        const payload = await response.json();
        if (!cancelled) setMemoryProfile(normaliseMemoryProfile(payload));
      } catch {
        if (!cancelled) { setMemoryProfile(createEmptyMemoryProfile()); setMemoryError('Could not load — check connection'); }
      } finally {
        if (!cancelled) setIsMemoryLoading(false);
      }
    }
    void loadMemory();
    return () => { cancelled = true; };
  }, [sessionToken]);

  useEffect(() => {
    let cancelled = false;
    async function loadLeadSummary() {
      if (!sessionToken) { setOpenLeadCount(0); return; }
      try {
        const response = await fetchProtected('/api/leads/summary');
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) {
            setOpenLeadCount(data.total_active ?? 0);
          }
        }
      } catch { /* silent */ }
    }
    void loadLeadSummary();
    return () => { cancelled = true; };
  }, [sessionToken]);

  useEffect(() => {
    let cancelled = false;
    async function loadApprovals() {
      if (!sessionToken) { setApprovals([]); return; }
      try {
        const response = await fetchProtected('/api/approvals?status=pending');
        if (response.status === 401 || !response.ok) return;
        const rows = await response.json();
        if (!cancelled && Array.isArray(rows)) setApprovals(rows.map((row) => normaliseBackendApproval(row)));
      } catch { /* silent */ }
    }
    void loadApprovals();
    return () => { cancelled = true; };
  }, [sessionToken]);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspaceState() {
      if (!sessionToken || demoMode) return;
      try {
        const response = await fetchProtected('/api/workspace/state');
        if (response.status === 401 || !response.ok) return;
        const data = await response.json();
        if (cancelled || !data || typeof data !== 'object') return;
        applyWorkspaceState(data, { replaceEmpty: true });
      } catch {
        // Keep the local demo workspace if persistence is unavailable.
      }
    }
    void loadWorkspaceState();
    return () => { cancelled = true; };
  }, [sessionToken, demoMode]);

  useEffect(() => {
    function handleOauthMessage(event) {
      if (event.origin !== BACKEND_ORIGIN) return;
      const payload = event.data ?? {};

      // Google OAuth
      if (payload.source === 'olivander-google-oauth' && payload.provider === 'google') {
        if (oauthPollRef.current) { window.clearInterval(oauthPollRef.current); oauthPollRef.current = null; }
        const nextSession = trimToNull(String(payload.session ?? ''));
        if (nextSession) { persistSession(nextSession); setSessionToken(nextSession); }
        setGoogleConnected(true); setGoogleBusy(false);
        addActivityItem('resolved', 'Google Workspace connected', 'Gmail and Calendar are ready.');
        void syncGoogleConnectionStatus({ silent: true });
      }

      // Xero OAuth — backend sends xeroTokens: { access_token, refresh_token, expiry, tenant_id }
      if (payload.source === 'olivander-xero-oauth') {
        const xeroTokens = payload.xeroTokens;
        if (xeroTokens?.access_token && xeroTokens?.tenant_id) {
          void storeXeroTokens(xeroTokens);
        }
        setXeroBusy(false);
      }
    }
    window.addEventListener('message', handleOauthMessage);
    void syncGoogleConnectionStatus({ silent: true });
    return () => window.removeEventListener('message', handleOauthMessage);
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) { setRecentEmails([]); setRecentEmailsError(''); return undefined; }
    let cancelled = false; let syncing = false;
    async function syncInbox() {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        const [emailsResponse, approvalsResponse] = await Promise.all([
          fetchProtected('/api/emails'),
          fetchProtected('/api/approvals?status=pending'),
        ]);
        if (emailsResponse.status === 401) return;
        if (!emailsResponse.ok) throw new Error(`Failed with status ${emailsResponse.status}`);
        const inbox = await emailsResponse.json();
        if (!cancelled) { setRecentEmailsError(''); reconcileInboxSnapshot(inbox); }
        if (approvalsResponse.ok) {
          const backendRows = await approvalsResponse.json();
          if (!cancelled && Array.isArray(backendRows)) {
            setApprovals((current) => {
              const existingBackendIds = new Set(current.map((a) => a.backendId).filter(Boolean));
              const newRows = backendRows.filter((row) => !existingBackendIds.has(String(row.id ?? '')));
              if (!newRows.length) return current;
              return [...newRows.map((row) => normaliseBackendApproval(row)), ...current];
            });
          }
        }
      } catch {
        if (!cancelled) setRecentEmailsError('Could not load — check connection');
      } finally { syncing = false; }
    }
    void syncInbox();
    const interval = window.setInterval(syncInbox, INBOX_SYNC_INTERVAL_MS);
    function handleFocus() { void syncInbox(); }
    window.addEventListener('focus', handleFocus);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('focus', handleFocus); };
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) { setRecentEmails([]); setRecentEmailsError(''); return undefined; }
    let cancelled = false;
    async function loadRecentEmails() {
      setRecentEmailsError('');
      try {
        const response = await fetchProtected(`/gmail/recent?max_results=${RECENT_EMAILS_MAX}`);
        if (response.status === 401) return;
        if (!response.ok) throw new Error(`Failed with status ${response.status}`);
        const payload = await response.json();
        if (!cancelled) { setRecentEmails(Array.isArray(payload) ? payload : []); setRecentEmailsError(''); }
      } catch {
        if (!cancelled) { setRecentEmails([]); setRecentEmailsError('Could not load — check connection'); }
      }
    }
    void loadRecentEmails();
    return () => { cancelled = true; };
  }, [sessionToken, approvals.length, tasks.length]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function pulseProcessing(duration = PROCESSING_PULSE_MS) {
    if (processingTimerRef.current) window.clearTimeout(processingTimerRef.current);
    setIsWorkflowProcessing(true);
    processingTimerRef.current = window.setTimeout(() => setIsWorkflowProcessing(false), duration);
  }

  function addActivityItem(type, title, description) {
    setActivity((current) => [{ id: createId('activity'), type, title, description, createdAt: Date.now() }, ...current]);
  }

  function addFirstCustomerActivity(type, title, description) {
    setFirstCustomerActivity((current) => [{ id: createId('sample-activity'), type, title, description, createdAt: Date.now() }, ...current]);
  }

  function applySampleWorkspace() {
    const sample = createFirstCustomerSampleWorkspace();
    setFirstCustomerInbox(sample.inbox);
    setFirstCustomerJobs(sample.jobs);
    setFirstCustomerActions(sample.actions);
    setFirstCustomerActivity(sample.activity);
    setSelectedJobId(sample.jobs[0]?.id ?? null);
    setApprovals((current) => current.filter((approval) => !approval.isDemo));
  }

  function applyWorkspaceState(data, { replaceEmpty = false } = {}) {
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data.messages) && (replaceEmpty || data.messages.length)) {
      setFirstCustomerInbox(data.messages);
    }

    if (Array.isArray(data.jobs) && (replaceEmpty || data.jobs.length)) {
      setFirstCustomerJobs(data.jobs);
      setSelectedJobId((current) => current && data.jobs.some((job) => job.id === current) ? current : data.jobs[0]?.id ?? null);
    }

    if (Array.isArray(data.actions) && (replaceEmpty || data.actions.length)) {
      setFirstCustomerActions(data.actions);
      const queuedApprovals = data.actions
        .filter((action) => action.status === 'queued')
        .map((action) => buildDemoApprovalFromAction(action, { id: `approval-${action.id}` }));

      setApprovals((current) => {
        const nonWorkspaceApprovals = current.filter((approval) => !approval.workspaceActionId);
        if (!queuedApprovals.length) return nonWorkspaceApprovals;
        const existingIds = new Set(nonWorkspaceApprovals.map((approval) => approval.id));
        return [
          ...queuedApprovals.filter((approval) => !existingIds.has(approval.id)),
          ...nonWorkspaceApprovals,
        ];
      });
    }
  }

  async function loadRealWorkspaceState() {
    if (!sessionToken) return;
    try {
      const response = await fetchProtected('/api/workspace/state');
      if (response.status === 401 || !response.ok) return;
      const data = await response.json();
      applyWorkspaceState(data, { replaceEmpty: true });
    } catch {
      // Keep whatever is on screen if the persisted workspace is unavailable.
    }
  }

  function handleResetDemoWorkspace() {
    applySampleWorkspace();
    setWorkspaceImportState({ busy: false, message: '' });
  }

  function handleDemoModeChange(nextDemoMode) {
    setDemoMode(nextDemoMode);
    window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, nextDemoMode ? 'true' : 'false');
    setWorkspaceImportState({ busy: false, message: '' });

    if (nextDemoMode) {
      applySampleWorkspace();
      requestPanel('home');
      return;
    }

    setFirstCustomerInbox([]);
    setFirstCustomerJobs([]);
    setFirstCustomerActions([]);
    setFirstCustomerActivity([]);
    setSelectedJobId(null);
    setApprovals((current) => current.filter((approval) => !approval.isDemo));
    void loadRealWorkspaceState();
    requestPanel('home');
  }

  async function handleSyncWorkspaceInbox() {
    if (demoMode) return;
    if (!sessionToken) {
      openSettings('connections');
      return;
    }

    setWorkspaceImportState({ busy: true, message: '' });
    try {
      const response = await fetchProtected('/api/workspace/inbox/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxResults: RECENT_EMAILS_MAX }),
      });
      if (response.status === 401) return;
      if (!response.ok) throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
      const result = await response.json();
      await loadRealWorkspaceState();
      const imported = Number(result.imported || 0);
      const duplicate = Number(result.skipped?.duplicate || 0);
      const nonActionable = Number(result.skipped?.non_actionable || 0);
      const detail = [
        duplicate ? `${duplicate} already imported` : '',
        nonActionable ? `${nonActionable} skipped` : '',
      ].filter(Boolean).join(', ');
      setWorkspaceImportState({
        busy: false,
        message: imported
          ? `Imported ${imported} Gmail message${imported === 1 ? '' : 's'}${detail ? `; ${detail}` : ''}.`
          : `No new actionable Gmail${detail ? `; ${detail}` : ''}.`,
      });
      if (imported) {
        addFirstCustomerActivity('draft', 'Gmail inbox synced', `${imported} message${imported === 1 ? '' : 's'} imported`);
      }
    } catch {
      setWorkspaceImportState({ busy: false, message: 'Could not sync Gmail. Check the connection.' });
    }
  }

  function buildDemoApprovalFromAction(action, overrides = {}) {
    return {
      id: overrides.id ?? createId('approval'),
      taskId: null,
      sourceEmailId: null,
      senderName: action.customer ?? 'Customer',
      senderEmail: action.email ?? 'unknown@example.co.nz',
      subject: overrides.subject ?? action.title,
      createdAt: Date.now(),
      tier: 'Tier 3',
      why: action.reason ?? 'Customer-facing action requires owner approval.',
      agentResponse: overrides.draft ?? action.draft ?? '',
      status: 'review',
      isDemo: true,
      workspaceActionId: action.id ?? null,
      sourceEmail: {
        senderName: action.customer ?? 'Customer',
        senderEmail: action.email ?? 'unknown@example.co.nz',
        subject: overrides.subject ?? action.title,
        body: action.detail ?? '',
        fullBody: action.detail ?? '',
      },
    };
  }

  function queueDemoApproval(action, options = {}) {
    const approval = buildDemoApprovalFromAction(action, options);
    setApprovals((current) => [approval, ...current]);
    if (action.id) {
      setFirstCustomerActions((current) => current.map((item) => (
        item.id === action.id ? { ...item, status: 'queued' } : item
      )));
      void persistWorkspacePatch('actions', action.id, { status: 'queued' });
    }
    addFirstCustomerActivity('pending', 'Approval queued', approval.subject);
    requestPanel('approvals');
  }

  function handlePlanChange(nextPlan) {
    const resolvedPlan = normalisePlanKey(nextPlan);
    setPlan(resolvedPlan);
    window.localStorage.setItem(PLAN_STORAGE_KEY, resolvedPlan);
    void saveMemoryKey(MEMORY_KEYS.plan, resolvedPlan).catch(() => {});
    addFirstCustomerActivity('draft', 'Plan updated', PLAN_CONFIG[resolvedPlan]?.label ?? 'Admin Starter');
  }

  async function persistWorkspaceCreate(kind, payload) {
    if (!sessionToken || demoMode) return null;
    try {
      const response = await fetchProtected(`/api/workspace/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || !response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  async function persistWorkspacePatch(kind, id, payload) {
    if (!sessionToken || demoMode || !isPersistedWorkspaceId(id)) return null;
    try {
      const response = await fetchProtected(`/api/workspace/${kind}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || !response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  function isPersistedWorkspaceId(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));
  }

  function normaliseJobPayload(job) {
    return {
      customer: job.customer,
      email: job.email || null,
      phone: job.phone || null,
      address: job.address || null,
      jobType: job.jobType || 'Manual job',
      status: job.status || 'new_lead',
      value: Number(job.value || 0),
      scheduledFor: job.scheduledFor || null,
      nextAction: job.nextAction || null,
      quoteSentDaysAgo: Number.isFinite(Number(job.quoteSentDaysAgo)) ? Number(job.quoteSentDaysAgo) : null,
      invoice: job.invoice || null,
      notes: Array.isArray(job.notes) ? job.notes : [],
      timeline: Array.isArray(job.timeline) ? job.timeline : [],
    };
  }

  function normaliseMessagePayload(message) {
    return {
      customer: message.customer,
      email: message.email || null,
      phone: message.phone || null,
      subject: message.subject || 'Untitled message',
      source: message.source || 'manual',
      sourceEmailId: message.sourceEmailId || null,
      sourceThreadId: message.sourceThreadId || null,
      category: message.category || 'Needs reply',
      receivedAt: message.receivedAt || null,
      jobType: message.jobType || null,
      address: message.address || null,
      body: message.body || '',
      interpretation: message.interpretation || null,
      draft: message.draft || null,
      plusOnlyReason: message.plusOnlyReason || null,
    };
  }

  function normaliseActionPayload(action) {
    return {
      type: action.type || 'reply',
      title: action.title,
      customer: action.customer || null,
      email: action.email || null,
      sourceMessageId: action.sourceMessageId || null,
      jobId: action.jobId || null,
      priority: action.priority || 'medium',
      reason: action.reason || null,
      detail: action.detail || null,
      draft: action.draft || null,
      status: action.status || 'open',
      plusOnly: Boolean(action.plusOnly),
      lockedReason: action.lockedReason || null,
      value: Number.isFinite(Number(action.value)) ? Number(action.value) : null,
    };
  }

  function buildAuthHeaders(headers = {}) {
    const nextHeaders = new Headers(headers);
    if (sessionToken) nextHeaders.set('Authorization', `Bearer ${sessionToken}`);
    return nextHeaders;
  }

  function clearSessionState() {
    persistSession(null); setSessionToken(null); setGoogleConnected(false);
    setBusinessContactName(''); setSessionBusinessName('');
    processedEmailIdsRef.current = new Set();
    persistProcessedEmailIds(processedEmailIdsRef.current);
  }

  async function fetchProtected(path, options = {}) {
    const response = await fetch(buildBackendUrl(path), {
      ...options, credentials: 'include', headers: buildAuthHeaders(options.headers),
    });
    if (response.status === 401 && sessionToken) { clearSessionState(); requestPanel('home'); }
    return response;
  }

  async function syncGoogleConnectionStatus({ silent = false } = {}) {
    if (!sessionToken) {
      setGoogleConnected(false);
      setXeroConnected(false);
      setBusinessContactName('');
      setSessionBusinessName('');
      return false;
    }
    try {
      const response = await fetch(buildBackendUrl('/api/connections'), { credentials: 'include', headers: buildAuthHeaders() });
      if (response.status === 401) {
        if (sessionToken) clearSessionState();
        setGoogleConnected(false); setXeroConnected(false); setBusinessContactName(''); setSessionBusinessName('');
        return false;
      }
      if (!response.ok) throw new Error(`Failed with status ${response.status}`);
      const payload = await response.json();
      setBusinessContactName(trimToNull(String(payload.contact_name ?? payload.first_name ?? '')) ?? '');
      setSessionBusinessName(trimToNull(String(payload.business_name ?? '')) ?? '');
      setGoogleConnected(Boolean(payload.google));
      setXeroConnected(Boolean(payload.xero));
      if (payload.onboarded === false) setIsOnboarded(false);
      return Boolean(payload.google);
    } catch {
      setGoogleConnected(false); setBusinessContactName(''); setSessionBusinessName('');
      return false;
    }
  }

  async function storeXeroTokens(xeroTokens) {
    try {
      const response = await fetchProtected('/api/connections/xero/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(xeroTokens),
      });
      if (response.ok) {
        setXeroConnected(true);
        addActivityItem('resolved', 'Xero connected', 'Invoice creation is ready.');
      }
    } catch { /* silent */ }
  }

  function requestPanel(nextPanel) {
    if (nextPanel === activePanel || isPanelTransitioningRef.current) { closeProfileMenu(); return; }
    if (profileMenuTimerRef.current) window.clearTimeout(profileMenuTimerRef.current);
    panelTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    panelTimersRef.current = [];
    closeProfileMenu();
    isPanelTransitioningRef.current = true;
    pendingPanelRef.current = nextPanel;
    panelFrameRef.current?.classList.remove('panel-enter', 'panel-exit');
    panelFrameRef.current?.classList.add('panel-exit');

    panelTimersRef.current.push(
      window.setTimeout(() => {
        setActivePanel(pendingPanelRef.current ?? nextPanel);
        panelTimersRef.current.push(
          window.setTimeout(() => {
            const frame = panelFrameRef.current;
            frame?.classList.remove('panel-exit');
            if (frame) { void frame.offsetWidth; frame.classList.add('panel-enter'); }
            panelTimersRef.current.push(
              window.setTimeout(() => {
                panelFrameRef.current?.classList.remove('panel-enter');
                isPanelTransitioningRef.current = false;
                pendingPanelRef.current = null;
              }, PANEL_ENTER_MS),
            );
          }, 16),
        );
      }, PANEL_EXIT_MS),
    );
  }

  function openSettings(section) {
    setSettingsSection(section);
    if (activePanel === 'settings') { closeProfileMenu(); return; }
    requestPanel('settings');
  }

  function handleLogoClick() { setSettingsSection('connections'); requestPanel('home'); }
  function handleSettingsBack() { setSettingsSection('connections'); requestPanel('home'); }

  function openProfileMenu() {
    if (profileMenuTimerRef.current) window.clearTimeout(profileMenuTimerRef.current);
    setProfileMenuState('open');
  }

  function closeProfileMenu() {
    if (!profileMenuState) return;
    if (profileMenuTimerRef.current) window.clearTimeout(profileMenuTimerRef.current);
    setProfileMenuState('closing');
    profileMenuTimerRef.current = window.setTimeout(() => setProfileMenuState(null), DEFAULT_POPUP_CLOSE_MS);
  }

  function toggleProfileMenu() {
    if (profileMenuState === 'open') { closeProfileMenu(); return; }
    openProfileMenu();
  }

  function watchOauthPopup(popupWindow) {
    if (oauthPollRef.current) window.clearInterval(oauthPollRef.current);
    oauthPollRef.current = window.setInterval(() => {
      if (!popupWindow || popupWindow.closed) {
        window.clearInterval(oauthPollRef.current);
        oauthPollRef.current = null;
        setGoogleBusy(false);
        void syncGoogleConnectionStatus({ silent: true });
      }
    }, 700);
  }

  async function handleGoogleConnect() {
    if (googleConnected || googleBusy) return;
    setGoogleBusy(true);
    const popupWindow = window.open('', 'olivander-google-oauth', 'popup=yes,width=560,height=720');
    try {
      if (!popupWindow) throw new Error('Popup blocked');
      popupWindow.document.write(`<!doctype html><html><head><title>Connecting Google...</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f0e8;color:#1c1a14;font:500 16px "DM Sans",system-ui,sans-serif;}</style></head><body>Connecting Google...</body></html>`);
      popupWindow.document.close();
      const response = await fetch(buildBackendUrl('/auth/google'), { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed with status ${response.status}`);
      const payload = await response.json();
      popupWindow.location.replace(payload.url);
      popupWindow.focus();
      watchOauthPopup(popupWindow);
    } catch {
      popupWindow?.close();
      setGoogleBusy(false);
    }
  }

  async function handleGoogleDisconnect() {
    if (!googleConnected || googleBusy) return;
    setGoogleBusy(true);
    try {
      const response = await fetchProtected('/api/connections/google/disconnect', { method: 'POST' });
      if (response.status === 401) return;
      if (!response.ok) throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
      clearSessionState(); setGoogleBusy(false);
      addActivityItem('pending', 'Google Workspace disconnected', 'Stored access was removed.');
      openSettings('connections');
    } catch { setGoogleBusy(false); }
  }

  async function handleXeroConnect() {
    if (xeroConnected || xeroBusy) return;
    setXeroBusy(true);
    const popupWindow = window.open('', 'olivander-xero-oauth', 'popup=yes,width=600,height=720');
    try {
      if (!popupWindow) throw new Error('Popup blocked');
      popupWindow.document.write(`<!doctype html><html><head><title>Connecting Xero...</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f0e8;color:#1c1a14;font:500 16px "DM Sans",system-ui,sans-serif;}</style></head><body>Connecting Xero...</body></html>`);
      popupWindow.document.close();
      const response = await fetchProtected('/auth/xero');
      if (!response.ok) throw new Error(`Failed with status ${response.status}`);
      const payload = await response.json();
      popupWindow.location.replace(payload.url);
      popupWindow.focus();
    } catch {
      popupWindow?.close();
      setXeroBusy(false);
    }
  }

  async function fetchAgentPlan(request, sourceEmail = null) {
    const response = await fetchProtected('/api/agent/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request, source_email: sourceEmail }),
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
    return response.json();
  }

  async function createTaskWithAgentPlan(request, options = {}) {
    const fallbackTask = options.baseTask ?? buildTaskFromRequest(request, options);
    const sourceEmail = options.sourceEmail ?? null;

    if (USE_MOCK_AGENT_PLAN) {
      await new Promise((resolve) => window.setTimeout(resolve, PLAN_MOCK_DELAY_MS));
      return { ...normaliseAgentPlan(fallbackTask, createMockAgentPlan(request, sourceEmail)), planRequestState: 'ready' };
    }

    try {
      const agentPlan = await fetchAgentPlan(request, sourceEmail);
      if (!agentPlan) return { ...normaliseAgentPlan(fallbackTask, createMockAgentPlan(request, sourceEmail)), planRequestState: 'ready' };
      const normalisedTask = normaliseAgentPlan(fallbackTask, agentPlan);
      const hasStructuredPlan = Array.isArray(agentPlan.steps) && agentPlan.steps.length > 0;
      if (!hasStructuredPlan) return { ...normaliseAgentPlan(normalisedTask, createMockAgentPlan(request, sourceEmail)), planRequestState: 'ready' };
      return { ...normalisedTask, planRequestState: 'ready' };
    } catch {
      return { ...normaliseAgentPlan(fallbackTask, createMockAgentPlan(request, sourceEmail)), planRequestState: 'ready' };
    }
  }

  async function submitInstruction(text, origin) {
    const value = text.trim();
    if (!value || isPlanning) return;
    pulseProcessing(); setIsPlanning(true);
    try {
      const baseTask = buildTaskFromRequest(value, { planSteps: [], draftPreview: null, draftContent: null, clarifyingQuestion: null, planRequestState: 'loading' });
      setTasks((current) => [baseTask, ...current]);
      setExpandedTaskId(baseTask.id);
      addActivityItem('draft', 'Task created', baseTask.name);
      if (origin === 'home') requestPanel('tasks');
      const createdTask = await createTaskWithAgentPlan(value, { baseTask });
      setTasks((current) => current.map((task) => (task.id === baseTask.id ? createdTask : task)));
      setExpandedTaskId(createdTask.id);
      if (origin === 'tasks') { setTaskInput(''); setShowTaskComposer(false); } else { setHomeInput(''); }
    } catch { } finally { setIsPlanning(false); }
  }

  function clearApprovalTimer(taskId) {
    const timer = approvalTimersRef.current[taskId];
    if (timer) { window.clearTimeout(timer); delete approvalTimersRef.current[taskId]; }
  }

  function scheduleApproval(email, taskId) {
    clearApprovalTimer(taskId);
    approvalTimersRef.current[taskId] = window.setTimeout(() => {
      setTasks((current) => current.map((task) => task.id === taskId ? { ...task, status: 'waiting', updatedAt: Date.now() } : task));
      setApprovals((current) => {
        if (current.some((approval) => approval.taskId === taskId)) return current;
        return [buildApprovalFromEmail(email, taskId), ...current];
      });
      addActivityItem('pending', 'Approval queued', `Reply to ${email.senderName} is ready.`);
      delete approvalTimersRef.current[taskId];
    }, email.approvalDelayMs);
  }

  async function handleIncomingEmail(email) {
    const normalisedEmail = normaliseIncomingEmail(email);
    if (!normalisedEmail || normalisedEmail.status === 'actioned') return;
    if (processedEmailIdsRef.current.has(normalisedEmail.id)) return;
    processedEmailIdsRef.current.add(normalisedEmail.id);
    persistProcessedEmailIds(processedEmailIdsRef.current);
    pulseProcessing(); setIsPlanning(true);
    try {
      const fallbackTask = buildTaskFromEmail(normalisedEmail);
      const task = await createTaskWithAgentPlan(`Reply to ${normalisedEmail.senderName} about ${normalisedEmail.subject}`, { baseTask: fallbackTask, sourceEmail: fallbackTask.sourceEmail });
      setTasks((current) => [task, ...current]);
      setExpandedTaskId(task.id);
      addActivityItem('draft', 'Inbox task created', normalisedEmail.subject);
      if (normalisedEmail.requiresApproval) scheduleApproval(normalisedEmail, task.id);
    } finally { setIsPlanning(false); }
  }

  function handleFirstCustomerActionApprove(action) {
    if (action.plusOnly && !planIsPlus) { openSettings('plan'); return; }
    queueDemoApproval(action);
  }

  function handleFirstCustomerActionDelay(action, delayOption = { label: 'Tomorrow' }) {
    const delayedUntil = delayOption.label || 'Tomorrow';
    setFirstCustomerActions((current) => current.map((item) => (
      item.id === action.id ? { ...item, status: 'delayed', delayedUntil } : item
    )));
    void persistWorkspacePatch('actions', action.id, { status: 'delayed' });
    addFirstCustomerActivity('pending', 'Action delayed', `${action.title} - ${delayedUntil}`);
  }

  function handleFirstCustomerActionDismiss(action) {
    setFirstCustomerActions((current) => current.map((item) => (
      item.id === action.id ? { ...item, status: 'dismissed' } : item
    )));
    void persistWorkspacePatch('actions', action.id, { status: 'dismissed' });
    addFirstCustomerActivity('rejected', 'Action dismissed', action.title);
  }

  function handleFirstCustomerActionEdit(action) {
    const task = buildTaskFromRequest(action.title, {
      description: action.detail,
      draftPreview: action.draft ? { label: 'Draft', text: action.draft } : null,
      draftContent: action.draft ?? null,
      planSummary: action.reason,
    });
    setTasks((current) => [task, ...current]);
    setExpandedTaskId(task.id);
    addFirstCustomerActivity('draft', 'Draft opened for editing', action.title);
    requestPanel('tasks');
  }

  function handleOpenJob(jobId) {
    if (jobId) setSelectedJobId(jobId);
    requestPanel('jobs');
  }

  async function handleCreateJobFromMessage(message) {
    const jobId = `job-${message.id}`;
    const nextJob = {
      id: jobId,
      customer: message.customer,
      email: message.email,
      phone: message.phone ?? '',
      address: message.address ?? '',
      jobType: message.jobType || 'Customer job',
      status: message.category === 'New lead' ? 'new_lead' : 'info_needed',
      value: 0,
      scheduledFor: '',
      nextAction: message.interpretation,
      notes: [`Created from inbox message: ${message.subject}`],
      timeline: ['Message reviewed', 'Job created'],
    };
    setFirstCustomerJobs((current) => {
      if (current.some((job) => job.id === jobId)) return current;
      return [nextJob, ...current];
    });
    setSelectedJobId(jobId);
    addFirstCustomerActivity('draft', 'Job created', `${message.customer} - ${message.jobType}`);
    requestPanel('jobs');
    const persisted = await persistWorkspaceCreate('jobs', normaliseJobPayload(nextJob));
    if (persisted?.id) {
      setFirstCustomerJobs((current) => current.map((job) => job.id === jobId ? persisted : job));
      setSelectedJobId(persisted.id);
    }
  }

  async function handleQueueReplyFromMessage(message) {
    const action = {
      id: null,
      title: `Reply to ${message.customer}: ${message.subject}`,
      customer: message.customer,
      email: message.email,
      sourceMessageId: message.id,
      type: 'reply',
      priority: message.category === 'New lead' ? 'high' : 'medium',
      reason: message.interpretation,
      detail: message.body,
      draft: message.draft,
      status: 'queued',
    };
    const persisted = await persistWorkspaceCreate('actions', normaliseActionPayload(action));
    queueDemoApproval(persisted ?? action);
  }

  function handleDismissInboxMessage(messageId) {
    setFirstCustomerInbox((current) => current.filter((message) => message.id !== messageId));
    void persistWorkspacePatch('messages', messageId, { status: 'dismissed' });
    addFirstCustomerActivity('rejected', 'Inbox card dismissed', messageId);
  }

  async function handleManualMessage(message) {
    const action = {
      id: `action-${message.id}`,
      type: 'reply',
      title: `Reply to ${message.customer}`,
      customer: message.customer,
      email: message.email,
      sourceMessageId: message.id,
      priority: message.category === 'New lead' ? 'high' : 'medium',
      reason: message.interpretation,
      detail: 'Manual message added to the workspace.',
      draft: message.draft,
      plusOnly: message.category === 'Payment question',
      lockedReason: 'Payment and invoice workflows are included in Admin Plus.',
    };
    setFirstCustomerInbox((current) => [message, ...current]);
    setFirstCustomerActions((current) => [action, ...current]);
    addFirstCustomerActivity('draft', 'Manual message added', message.subject);
    const persistedMessage = await persistWorkspaceCreate('messages', normaliseMessagePayload(message));
    if (!persistedMessage?.id) return;
    const persistedAction = await persistWorkspaceCreate('actions', normaliseActionPayload({
      ...action,
      sourceMessageId: persistedMessage.id,
    }));
    setFirstCustomerInbox((current) => current.map((item) => item.id === message.id ? persistedMessage : item));
    if (persistedAction?.id) {
      setFirstCustomerActions((current) => current.map((item) => item.id === action.id ? persistedAction : item));
    }
  }

  function handleJobStageChange(jobId, status) {
    const nextTimelineItem = `Moved to ${status.replace(/_/g, ' ')}`;
    const currentJob = firstCustomerJobs.find((job) => job.id === jobId);
    const nextTimeline = [...(currentJob?.timeline || []), nextTimelineItem];
    setFirstCustomerJobs((current) => current.map((job) => (
      job.id === jobId
        ? { ...job, status, timeline: nextTimeline }
        : job
    )));
    void persistWorkspacePatch('jobs', jobId, { status, timeline: nextTimeline });
    addFirstCustomerActivity('draft', 'Job status updated', status.replace(/_/g, ' '));
  }

  async function handleAddManualJob(job) {
    const id = createId('job');
    const nextJob = {
      id,
      ...job,
      email: '',
      phone: '',
      status: 'new_lead',
      value: 0,
      scheduledFor: '',
      nextAction: 'Set the next action.',
      notes: ['Manual job created.'],
      timeline: ['Job created manually'],
    };
    setFirstCustomerJobs((current) => [nextJob, ...current]);
    setSelectedJobId(id);
    addFirstCustomerActivity('draft', 'Manual job created', `${job.customer} - ${job.jobType}`);
    const persisted = await persistWorkspaceCreate('jobs', normaliseJobPayload(nextJob));
    if (persisted?.id) {
      setFirstCustomerJobs((current) => current.map((item) => item.id === id ? persisted : item));
      setSelectedJobId(persisted.id);
    }
  }

  function handleAddJobNote(jobId, note) {
    const currentJob = firstCustomerJobs.find((job) => job.id === jobId);
    const nextNotes = [...(currentJob?.notes || []), note];
    const nextTimeline = [...(currentJob?.timeline || []), 'Note added'];
    setFirstCustomerJobs((current) => current.map((job) => (
      job.id === jobId
        ? { ...job, notes: nextNotes, timeline: nextTimeline }
        : job
    )));
    void persistWorkspacePatch('jobs', jobId, { notes: nextNotes, timeline: nextTimeline });
    addFirstCustomerActivity('draft', 'Job note added', note);
  }

  async function handleQueueJobFollowUp(job) {
    if (!demoMode && sessionToken && isPersistedWorkspaceId(job.id)) {
      try {
        const response = await fetchProtected(`/api/workspace/jobs/${job.id}/follow-up`, {
          method: 'POST',
        });
        if (response.status !== 401 && response.ok) {
          const action = await response.json();
          queueDemoApproval(action);
          return;
        }
      } catch {
        // Fall back to a local draft so the owner can still review the action.
      }
    }

    const draft = job.status === 'quote_sent'
      ? `Hi ${job.customer.split(' ')[0] || 'there'},\n\nJust checking in on the quote I sent through. Happy to answer any questions or adjust timing if needed.\n\nThanks,\nOlivander Electrical`
      : `Hi ${job.customer.split(' ')[0] || 'there'},\n\nJust following up on ${job.jobType}. Let me know if anything has changed or if you need anything else from me.\n\nThanks,\nOlivander Electrical`;
    const action = {
      id: null,
      title: `Follow up ${job.customer}`,
      customer: job.customer,
      email: job.email,
      type: 'follow_up',
      jobId: job.id,
      priority: job.status === 'quote_sent' ? 'medium' : 'low',
      reason: job.nextAction || 'Job has a visible next action.',
      detail: job.jobType,
      draft,
      status: 'queued',
    };
    const persisted = await persistWorkspaceCreate('actions', normaliseActionPayload(action));
    queueDemoApproval(persisted ?? action);
  }

  function isEmailAllowedByFilters(email) {
    const patterns = (memoryProfile[MEMORY_KEYS.blockedSenderPatterns] || '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const senderEmail = (email.senderEmail || '').toLowerCase();
    return !patterns.some((pattern) => senderEmail.includes(pattern));
  }

  function reconcileInboxSnapshot(inboxEmails) {
    if (!Array.isArray(inboxEmails)) return;
    const activeEmails = inboxEmails.map((email) => normaliseIncomingEmail(email)).filter(Boolean)
      .filter((email) => email.status !== 'actioned').filter((email) => isEmailAllowedByFilters(email));
    const activeIds = new Set(activeEmails.map((email) => email.id));
    const isFirstLoad = processedEmailIdsRef.current.size === 0;
    if (isFirstLoad) { activeIds.forEach((id) => processedEmailIdsRef.current.add(id)); persistProcessedEmailIds(processedEmailIdsRef.current); return; }
    processedEmailIdsRef.current.forEach((emailId) => { if (!activeIds.has(emailId)) processedEmailIdsRef.current.delete(emailId); });
    persistProcessedEmailIds(processedEmailIdsRef.current);
    activeEmails.forEach((email) => void handleIncomingEmail(email));
  }

  async function persistApprovalToBackend(approval) {
    if (!sessionToken) return;
    try {
      const response = await fetchProtected('/api/approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceEmailId: approval.sourceEmailId, senderName: approval.senderName, senderEmail: approval.senderEmail, subject: approval.subject, agentResponse: approval.agentResponse, tier: approval.tier, why: approval.why }),
      });
      if (!response.ok) return;
      const persisted = await response.json();
      if (persisted?.id) setApprovals((current) => current.map((item) => item.id === approval.id ? { ...item, backendId: persisted.id } : item));
    } catch { /* stays in state without backendId */ }
  }

  async function saveMemoryKey(key, value) {
    if (!sessionToken) return;
    await fetchProtected('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: String(value) }) });
    setMemoryProfile((current) => ({ ...current, [key]: String(value) }));
  }

  async function saveReplyToneEditCount(nextCount) {
    if (!sessionToken) return;
    try {
      await fetchProtected('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: MEMORY_KEYS.replyToneEdits, value: String(nextCount) }) });
    } catch { }
  }

  async function handleApproveApproval(approval) {
    if (removingApprovals[approval.id]) return;
    setRemovingApprovals((current) => ({ ...current, [approval.id]: 'approve' }));
    pulseProcessing(700);
    try {
      if (sessionToken && !approval.isDemo) {
        let response;
        if (approval.backendId) {
          response = await fetchProtected(`/api/actions/${approval.backendId}/approve`, { method: 'POST' });
        } else if (approval.sourceEmailId) {
          response = await fetchProtected(`/api/emails/${approval.sourceEmailId}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', reply: approval.agentResponse }) });
        }
        if (response && response.status !== 401 && !response.ok) throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
      }
      window.setTimeout(() => {
        setApprovals((current) => current.filter((item) => item.id !== approval.id));
        setRemovingApprovals((current) => { const next = { ...current }; delete next[approval.id]; return next; });
      }, APPROVAL_REMOVE_MS);
      setTasks((current) => current.map((task) => task.id === approval.taskId ? { ...task, status: 'done', updatedAt: Date.now() } : task));
      if (approval.workspaceActionId) {
        setFirstCustomerActions((current) => current.map((action) => (
          action.id === approval.workspaceActionId ? { ...action, status: 'approved' } : action
        )));
        void persistWorkspacePatch('actions', approval.workspaceActionId, { status: 'approved' });
      }
      addActivityItem('approved', 'Approved', approval.subject);
    } catch {
      setRemovingApprovals((current) => { const next = { ...current }; delete next[approval.id]; return next; });
    }
  }

  function handleRejectApproval(approval) {
    if (removingApprovals[approval.id]) return;
    setRemovingApprovals((current) => ({ ...current, [approval.id]: 'reject' }));
    if (approval.backendId && sessionToken && !approval.isDemo) {
      void fetchProtected(`/api/actions/${approval.backendId}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject' }) }).catch(() => {});
    }
    window.setTimeout(() => {
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
      setRemovingApprovals((current) => { const next = { ...current }; delete next[approval.id]; return next; });
    }, APPROVAL_REMOVE_MS);
    setTasks((current) => current.map((task) => task.id === approval.taskId ? { ...task, status: 'done', updatedAt: Date.now() } : task));
    if (approval.workspaceActionId) {
      setFirstCustomerActions((current) => current.map((action) => (
        action.id === approval.workspaceActionId ? { ...action, status: 'rejected' } : action
      )));
      void persistWorkspacePatch('actions', approval.workspaceActionId, { status: 'rejected' });
    }
    addActivityItem('rejected', 'Rejected', approval.subject);
  }

  function handleSaveApprovalEdit(approval, nextText) {
    const trimmed = nextText.trim();
    if (!trimmed) return;
    setApprovals((current) => current.map((item) => item.id === approval.id ? { ...item, agentResponse: trimmed, status: 'edited' } : item));
    if (approval.backendId && sessionToken && !approval.isDemo) {
      void fetchProtected(`/api/actions/${approval.backendId}/edit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit', edited_content: trimmed }) }).catch(() => {});
    }
    if (approval.workspaceActionId) {
      setFirstCustomerActions((current) => current.map((action) => (
        action.id === approval.workspaceActionId ? { ...action, draft: trimmed } : action
      )));
      void persistWorkspacePatch('actions', approval.workspaceActionId, { draft: trimmed });
    }
    setMemoryProfile((current) => {
      const currentCount = parseInt(current[MEMORY_KEYS.replyToneEdits] || '0', 10) || 0;
      const nextCount = currentCount + 1;
      void saveReplyToneEditCount(nextCount);
      return { ...current, [MEMORY_KEYS.replyToneEdits]: String(nextCount) };
    });
    addActivityItem('draft', 'Approval updated', approval.subject);
  }

  function handleTaskQuestion(taskId, answer) {
    const answerSummary = answer === 'yes' || answer === 'no' ? `Answered ${answer}.` : `Answered: ${answer}`;
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, questionAnswer: answer, updatedAt: Date.now() } : task));
    addActivityItem('pending', 'Clarification recorded', answerSummary);
  }

  function handleTaskNoteSubmit(taskId, note) {
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, updatedAt: Date.now(), notes: [...task.notes, { id: createId('note'), text: note, createdAt: Date.now() }] } : task));
    addActivityItem('draft', 'Task note added', note);
  }

  function handleTaskDraftSave(taskId, nextText) {
    const trimmed = nextText.trim();
    const taskName = tasks.find((task) => task.id === taskId)?.name ?? 'Draft';
    if (!trimmed) return;
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, draftContent: trimmed, draftPreview: task.draftPreview ? { ...task.draftPreview, text: trimmed } : { label: 'Draft', text: trimmed }, updatedAt: Date.now() } : task));
    let updatedApproval = false;
    setApprovals((current) => current.map((approval) => {
      if (approval.taskId !== taskId) return approval;
      updatedApproval = true;
      return { ...approval, agentResponse: trimmed, status: 'edited' };
    }));
    if (updatedApproval) {
      setMemoryProfile((current) => {
        const currentCount = parseInt(current[MEMORY_KEYS.replyToneEdits] || '0', 10) || 0;
        const nextCount = currentCount + 1;
        void saveReplyToneEditCount(nextCount);
        return { ...current, [MEMORY_KEYS.replyToneEdits]: String(nextCount) };
      });
    }
    addActivityItem('draft', 'Draft updated', taskName);
  }

  function handleTaskDraftApprove(task) {
    const matchingApproval = approvals.find((approval) => approval.taskId === task.id);
    if (matchingApproval) { requestPanel('approvals'); return; }
    const newApproval = buildApprovalFromTask(task);
    setApprovals((current) => {
      if (current.some((item) => item.taskId === task.id)) return current;
      return [newApproval, ...current];
    });
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'waiting', updatedAt: Date.now() } : item));
    addActivityItem('pending', 'Approval queued', task.name);
    void persistApprovalToBackend(newApproval);
    requestPanel('approvals');
  }

  function handleCancelTask(task) {
    if (!task || removingTasks[task.id]) return;
    const matchingApproval = approvals.find((approval) => approval.taskId === task.id);
    if (matchingApproval && removingApprovals[matchingApproval.id]) return;
    clearApprovalTimer(task.id);
    setRemovingTasks((current) => ({ ...current, [task.id]: true }));
    if (matchingApproval) setRemovingApprovals((current) => ({ ...current, [matchingApproval.id]: 'reject' }));
    if (expandedTaskId === task.id) setExpandedTaskId(null);
    addActivityItem('rejected', 'Cancelled', task.name);
    window.setTimeout(() => {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setRemovingTasks((current) => { const next = { ...current }; delete next[task.id]; return next; });
      if (matchingApproval) {
        setApprovals((current) => current.filter((item) => item.id !== matchingApproval.id));
        setRemovingApprovals((current) => { const next = { ...current }; delete next[matchingApproval.id]; return next; });
      }
    }, APPROVAL_REMOVE_MS);
  }

  async function handleLogout() {
    if (googleConnected) { await handleGoogleDisconnect(); return; }
    clearSessionState(); closeProfileMenu(); setSettingsSection('connections'); requestPanel('home');
  }

  function handleThemeToggle() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    if (themeSwitchTimerRef.current) window.clearTimeout(themeSwitchTimerRef.current);
    setIsThemeSwitching(true); setTheme(nextTheme);
    themeSwitchTimerRef.current = window.setTimeout(() => { setIsThemeSwitching(false); themeSwitchTimerRef.current = null; }, THEME_SWITCH_MS);
  }

  async function handleOnboardingComplete(formData) {
    for (const [key, value] of Object.entries(formData)) {
      if (value?.trim()) await saveMemoryKey(key, value.trim());
    }
    try {
      await fetchProtected('/api/business/onboard', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarded: true }) });
    } catch { /* non-blocking */ }
    setIsOnboarded(true);
    void syncGoogleConnectionStatus({ silent: true });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isOnboarded && sessionToken) {
    return (
      <OnboardingWizard
        onComplete={handleOnboardingComplete}
        onSaveMemory={saveMemoryKey}
        onGoogleConnect={handleGoogleConnect}
        onXeroConnect={handleXeroConnect}
        googleConnected={googleConnected}
        xeroConnected={xeroConnected}
        googleBusy={googleBusy}
        xeroBusy={xeroBusy}
        authToken={sessionToken}
      />
    );
  }

  const sidebarItems = [
    { id: 'home', label: 'Today', icon: <HouseIcon />, badge: todayOpenActionCount || null },
    { id: 'inbox', label: 'Inbox', icon: <MailIcon />, badge: firstCustomerInbox.length || null },
    { id: 'jobs', label: 'Jobs', icon: <LeadPipelineIcon />, badge: firstCustomerJobsToday.length || null },
    { id: 'tasks', label: 'Tasks', icon: <TaskListIcon />, badge: activeTaskCount || null },
    { id: 'activity', label: 'Activity', icon: <LinesIcon /> },
  ];
  const visibleSidebarItems = isSettingsPanel
    ? [
        { id: 'settings-back', label: 'Back', icon: <ArrowLeftIcon />, onClick: handleSettingsBack, className: 'sidebar__nav-item--back' },
        ...SETTINGS_SECTIONS.map((item) => ({ ...item, onClick: () => setSettingsSection(item.id), isActive: settingsSection === item.id })),
      ]
    : sidebarItems.map((item) => ({ ...item, onClick: () => requestPanel(item.id), isActive: activePanel === item.id }));
  const currentTitle = isSettingsPanel ? 'Settings' : PANEL_TITLES[activePanel] ?? 'Home';

  return (
    <div className={`app-shell ${isThemeSwitching ? 'is-theme-switching' : ''}`.trim()}>
      {profileMenuState ? (
        <button type="button" className="menu-overlay" aria-label="Close menu" onClick={closeProfileMenu} />
      ) : null}

      <aside className="sidebar">
        <button type="button" className="sidebar__logo-row" onClick={handleLogoClick}>
          <div className="wordmark" aria-label="Olivander">
            <span className="wordmark__o">O</span>
            <span className="wordmark__rest">livander</span>
          </div>
        </button>

        <nav className={`sidebar__nav ${isSettingsPanel ? 'sidebar__nav--settings' : ''}`.trim()} aria-label={isSettingsPanel ? 'Settings sections' : 'Primary'}>
          {visibleSidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar__nav-item ${item.className ?? ''} ${item.isActive ? 'is-active' : ''}`.trim()}
              onClick={item.onClick}
            >
              <span className="sidebar__nav-icon">{item.icon}</span>
              <span className="sidebar__nav-label">{item.label}</span>
              {item.badge ? <span className="sidebar__nav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar__divider" />

        <div className="sidebar__footer">
          {profileMenuState ? (
            <div className={`profile-menu ${profileMenuState === 'open' ? 'is-open' : 'is-closing'}`}>
              <button type="button" className="profile-menu__item" onClick={() => openSettings('connections')}>
                <GearIcon /><span>Settings</span>
              </button>
              <button type="button" className="profile-menu__item profile-menu__item--danger" onClick={() => void handleLogout()}>
                <LogoutIcon /><span>Log out</span>
              </button>
            </div>
          ) : null}

          <button type="button" className="profile-trigger" aria-expanded={profileMenuState === 'open'} onClick={toggleProfileMenu}>
            <span className="profile-trigger__avatar">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="5" r="3" fill="currentColor"/>
                <path d="M2 13c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </span>
            <span className="profile-trigger__copy">
              <span className="profile-trigger__name">{businessName}</span>
              <span className="profile-trigger__plan">{activePlanConfig.label}</span>
            </span>
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="top-bar">
          <div className="top-bar__inner">
            <div className="top-bar__title">{currentTitle}</div>
            <div className="top-bar__status">
              <span className={`workspace-mode-pill ${demoMode ? 'is-demo' : 'is-real'}`.trim()}>
                {demoMode ? 'Demo mode' : 'Real workspace'}
              </span>
            </div>
          </div>
        </header>

        <div className="panel-scroll">
          <div ref={panelFrameRef} className="panel-frame">
            {activePanel === 'home' ? (
              <TodayPanel
                plan={activePlan}
                demoMode={demoMode}
                canUseRealWorkspace={Boolean(sessionToken)}
                actionCards={visibleFirstCustomerActions}
                jobsToday={firstCustomerJobsToday}
                recentActivity={combinedActivity}
                stats={todayStats}
                onActionApprove={handleFirstCustomerActionApprove}
                onActionDelay={handleFirstCustomerActionDelay}
                onActionDismiss={handleFirstCustomerActionDismiss}
                onActionEdit={handleFirstCustomerActionEdit}
                onOpenJob={handleOpenJob}
                onNavigate={requestPanel}
                onUpgrade={() => openSettings('plan')}
                onResetDemo={handleResetDemoWorkspace}
                onDemoModeChange={handleDemoModeChange}
              />
            ) : null}

            {activePanel === 'inbox' ? (
              <InboxPanel
                messages={firstCustomerInbox}
                planIsPlus={planIsPlus}
                demoMode={demoMode}
                googleConnected={googleConnected}
                isSyncingInbox={workspaceImportState.busy}
                inboxSyncMessage={workspaceImportState.message}
                onCreateJob={handleCreateJobFromMessage}
                onQueueReply={handleQueueReplyFromMessage}
                onDismiss={handleDismissInboxMessage}
                onManualMessage={handleManualMessage}
                onSyncInbox={() => void handleSyncWorkspaceInbox()}
                onOpenConnections={() => openSettings('connections')}
                onUpgrade={() => openSettings('plan')}
              />
            ) : null}

            {activePanel === 'jobs' ? (
              <JobsPanel
                jobs={firstCustomerJobs}
                plan={activePlan}
                selectedJobId={selectedJobId}
                onSelectJob={setSelectedJobId}
                onStageChange={handleJobStageChange}
                onAddJob={handleAddManualJob}
                onAddNote={handleAddJobNote}
                onQueueFollowUp={handleQueueJobFollowUp}
                onUpgrade={() => openSettings('plan')}
              />
            ) : null}

            {activePanel === 'tasks' ? (
              <TasksPanel
                taskInput={taskInput}
                onTaskInputChange={setTaskInput}
                onTaskSubmit={(event) => { event.preventDefault(); void submitInstruction(taskInput, 'tasks'); }}
                taskFilter={taskFilter}
                onTaskFilterChange={setTaskFilter}
                showTaskComposer={showTaskComposer}
                onNewTaskClick={() => setShowTaskComposer((current) => !current)}
                visibleTasks={visibleTasks}
                removingTasks={removingTasks}
                expandedTaskId={expandedTaskId}
                onToggleTask={(taskId) => setExpandedTaskId((current) => (current === taskId ? null : taskId))}
                onAnswerQuestion={handleTaskQuestion}
                onNoteSubmit={handleTaskNoteSubmit}
                onApproveDraft={(task) => void handleTaskDraftApprove(task)}
                onCancelTask={handleCancelTask}
                onSaveDraft={handleTaskDraftSave}
              />
            ) : null}

            {activePanel === 'approvals' ? (
              <ApprovalsPanel
                approvals={sortedApprovals}
                removingApprovals={removingApprovals}
                onApprove={(approval) => void handleApproveApproval(approval)}
                onReject={handleRejectApproval}
                onSaveEdit={handleSaveApprovalEdit}
              />
            ) : null}

            {activePanel === 'activity' ? (
              <ActivityPanel
                activityFilter={activityFilter}
                onActivityFilterChange={setActivityFilter}
                activityItems={visibleActivity}
                recentEmailsError={recentEmailsError}
              />
            ) : null}

            {activePanel === 'leads' ? (
              <LeadPipelinePanel
                fetchProtected={fetchProtected}
              />
            ) : null}

            {activePanel === 'settings' ? (
              <SettingsPanel
                activeSection={settingsSection}
                googleConnected={googleConnected}
                googleBusy={googleBusy}
                xeroConnected={xeroConnected}
                xeroBusy={xeroBusy}
                onGoogleToggle={() => googleConnected ? void handleGoogleDisconnect() : void handleGoogleConnect()}
                onXeroConnect={handleXeroConnect}
                onThemeToggle={handleThemeToggle}
                theme={theme}
                profile={memoryProfile}
                isMemoryLoading={isMemoryLoading}
                memoryError={memoryError}
                onSaveMemory={saveMemoryKey}
                plan={activePlan}
                onPlanChange={handlePlanChange}
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
