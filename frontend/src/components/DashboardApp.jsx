import React, { useEffect, useRef, useState } from 'react';

import HomePanel, { pickRandomHomeHeadlineVariant } from './HomePanel.jsx';
import TasksPanel from './TasksPanel.jsx';
import ApprovalsPanel from './ApprovalsPanel.jsx';
import ActivityPanel from './ActivityPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import OnboardingWizard from './OnboardingWizard.jsx';
import {
  HouseIcon, TaskListIcon, CheckCircleIcon, LinesIcon,
  ArrowLeftIcon, GearIcon, DatabaseIcon, FunnelIcon, SunIcon, LogoutIcon,
} from './icons.jsx';

import {
  DEFAULT_BUSINESS_NAME, MEMORY_KEYS, PANEL_TITLES, SETTINGS_SECTIONS_CONFIG,
  DEFAULT_POPUP_CLOSE_MS, PANEL_EXIT_MS, PANEL_ENTER_MS, THEME_SWITCH_MS,
  APPROVAL_REMOVE_MS, PROCESSING_PULSE_MS, PLAN_MOCK_DELAY_MS, INBOX_SYNC_INTERVAL_MS,
  RECENT_EMAILS_MAX, USE_MOCK_AGENT_PLAN,
} from '../utils/constants.js';
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
  const icons = [<GearIcon />, <DatabaseIcon />, <FunnelIcon />, <SunIcon />];
  return { ...item, icon: icons[i] };
});

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
  const [homeHeadlineVariant] = useState(() => pickRandomHomeHeadlineVariant(new Date()));
  const [sessionToken, setSessionToken] = useState(getStoredSession);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroBusy, setXeroBusy] = useState(false);
  const [isOnboarded, setIsOnboarded] = useState(true); // default true to avoid flash; check on mount
  const [activePanel, setActivePanel] = useState('home');
  const [settingsSection, setSettingsSection] = useState('connections');
  const [profileMenuState, setProfileMenuState] = useState(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
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
  const [memoryProfile, setMemoryProfile] = useState(createEmptyMemoryProfile);
  const [isMemoryLoading, setIsMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState('');

  const sortedTasks = [...tasks].sort((l, r) => r.updatedAt - l.updatedAt);
  const visibleTasks = sortedTasks.filter((task) => taskFilter === 'all' ? true : task.status === taskFilter);
  const sortedApprovals = [...approvals].sort((l, r) => r.createdAt - l.createdAt);
  const activeTaskCount = tasks.filter((task) => task.status !== 'done').length;
  const businessName = trimToNull(memoryProfile[MEMORY_KEYS.businessName]) ?? DEFAULT_BUSINESS_NAME;
  const profileMeta = trimToNull(memoryProfile[MEMORY_KEYS.businessType]) ?? 'Workspace';
  const isSettingsPanel = activePanel === 'settings';

  const combinedActivity = [
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
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const resolvedThisWeekCount = activity.filter(
    (item) => (item.type === 'auto' || item.type === 'approved') && item.createdAt >= weekAgo,
  ).length;

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
    const interval = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

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

      // Xero OAuth — encrypted token payload
      if (payload.source === 'olivander-xero-oauth') {
        if (payload.encrypted_token && payload.tenant_id) {
          void storeXeroToken(payload.encrypted_token, payload.tenant_id);
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

  async function storeXeroToken(encryptedToken, tenantId) {
    try {
      const response = await fetchProtected('/api/connections/xero/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypted_token: encryptedToken, tenant_id: tenantId }),
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
      if (sessionToken) {
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
      addActivityItem('approved', 'Approved', approval.subject);
    } catch {
      setRemovingApprovals((current) => { const next = { ...current }; delete next[approval.id]; return next; });
    }
  }

  function handleRejectApproval(approval) {
    if (removingApprovals[approval.id]) return;
    setRemovingApprovals((current) => ({ ...current, [approval.id]: 'reject' }));
    if (approval.backendId && sessionToken) {
      void fetchProtected(`/api/actions/${approval.backendId}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject' }) }).catch(() => {});
    }
    window.setTimeout(() => {
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
      setRemovingApprovals((current) => { const next = { ...current }; delete next[approval.id]; return next; });
    }, APPROVAL_REMOVE_MS);
    setTasks((current) => current.map((task) => task.id === approval.taskId ? { ...task, status: 'done', updatedAt: Date.now() } : task));
    addActivityItem('rejected', 'Rejected', approval.subject);
  }

  function handleSaveApprovalEdit(approval, nextText) {
    const trimmed = nextText.trim();
    if (!trimmed) return;
    setApprovals((current) => current.map((item) => item.id === approval.id ? { ...item, agentResponse: trimmed, status: 'edited' } : item));
    if (approval.backendId && sessionToken) {
      void fetchProtected(`/api/actions/${approval.backendId}/edit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit', edited_content: trimmed }) }).catch(() => {});
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
      />
    );
  }

  const sidebarItems = [
    { id: 'home', label: 'Home', icon: <HouseIcon /> },
    { id: 'tasks', label: 'Tasks', icon: <TaskListIcon />, badge: activeTaskCount || null },
    { id: 'approvals', label: 'Approvals', icon: <CheckCircleIcon />, badge: sortedApprovals.length || null },
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
              {businessName.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'O'}
            </span>
            <span className="profile-trigger__copy">
              <span className="profile-trigger__name">{businessName}</span>
              <span className="profile-trigger__plan">{profileMeta}</span>
            </span>
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="top-bar">
          <div className="top-bar__inner">
            <div className="top-bar__title">{currentTitle}</div>
          </div>
        </header>

        <div className="panel-scroll">
          <div ref={panelFrameRef} className="panel-frame">
            {activePanel === 'home' ? (
              <HomePanel
                currentTime={currentTime}
                headlineVariant={homeHeadlineVariant}
                greetingName={greetingName}
                homeInput={homeInput}
                onHomeInputChange={setHomeInput}
                onHomeSubmit={(event) => { event.preventDefault(); void submitInstruction(homeInput, 'home'); }}
                onChipClick={setHomeInput}
                onStatClick={requestPanel}
                awaitingApprovalCount={sortedApprovals.length}
                activeTaskCount={activeTaskCount}
                resolvedThisWeekCount={resolvedThisWeekCount}
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
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
