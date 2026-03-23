import React, { useEffect, useRef, useState } from 'react';
import OlivanderWand, { useWandState } from './components/OlivanderWand';

const THEME_KEY = 'olivander_theme';
const SESSION_KEY = 'olivander_session';
const PROCESSED_EMAIL_IDS_KEY = 'olivander_processed_email_ids';
const DEFAULT_BACKEND_BASE_URL =
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';
const BACKEND_BASE_URL = (
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  DEFAULT_BACKEND_BASE_URL
).replace(/\/$/, '');
const BACKEND_ORIGIN = new URL(BACKEND_BASE_URL).origin;
const PANEL_TITLES = {
  home: 'Home',
  tasks: 'Tasks',
  approvals: 'Approvals',
  activity: 'Activity',
  settings: 'Settings',
};
const TASK_FILTERS = ['all', 'working', 'waiting', 'done'];
const ACTIVITY_FILTERS = ['all', 'approved', 'auto', 'rejected'];
const HOME_CHIPS = [
  'Draft an email',
  'Book a meeting',
  'Chase invoice',
  'Summarise inbox',
  'Write a quote',
];
const DEFAULT_POPUP_CLOSE_MS = 120;
const PANEL_EXIT_MS = 140;
const PANEL_ENTER_MS = 180;
const THEME_SWITCH_MS = 320;
const APPROVAL_REMOVE_MS = 200;
const PROCESSING_PULSE_MS = 1200;
const PLAN_MOCK_DELAY_MS = 1200;
const TASKS_AUTO_NAV_DELAY_MS = 800;
const INBOX_SYNC_INTERVAL_MS = 10000;
const RECENT_EMAILS_MAX = 12;
const APPROVAL_FLASH_MS = 300;
const SUCCESS_FLASH_MS = 3000;
const ERROR_FLASH_MS = 5000;
const USE_MOCK_AGENT_PLAN = false;
const MOCK_PLAN = [
  { description: 'Classify the request and identify intent', tier: 1 },
  { description: 'Draft a reply based on business context', tier: 3 },
  { description: 'Queue for your approval before sending', tier: 3 },
];
const MEMORY_KEYS = {
  businessName: 'business_name',
  ownerEmail: 'owner_email',
  businessType: 'business_type',
  pricingRange: 'pricing_range',
  paymentTerms: 'payment_terms',
  gstRegistered: 'gst_registered',
  replyTone: 'reply_tone',
  replyToneEdits: 'reply_tone_edits',
  reschedulePolicy: 'reschedule_policy',
  noShowHandling: 'no_show_handling',
};
const BUSINESS_PROFILE_ROWS = [
  { key: MEMORY_KEYS.businessType, label: 'Business type' },
  { key: MEMORY_KEYS.pricingRange, label: 'Pricing range' },
  { key: MEMORY_KEYS.paymentTerms, label: 'Payment terms' },
  { key: MEMORY_KEYS.gstRegistered, label: 'GST registered' },
];
const PREFERENCE_ROWS = [
  { key: MEMORY_KEYS.replyTone, label: 'Reply tone' },
  { key: MEMORY_KEYS.reschedulePolicy, label: 'Reschedule policy' },
  { key: MEMORY_KEYS.noShowHandling, label: 'No-show handling' },
];
const SETTINGS_SECTIONS = [
  { id: 'connections', label: 'Connections', icon: <LinkIcon /> },
  { id: 'memory', label: 'Memory', icon: <DatabaseIcon /> },
  { id: 'appearance', label: 'Appearance', icon: <SunIcon /> },
];

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBackendUrl(path) {
  return `${BACKEND_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function trimToNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getInitialTheme() {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

function getStoredSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(SESSION_KEY);
  return stored ? stored.trim() || null : null;
}

function decodeSessionPayload(sessionToken) {
  if (!sessionToken) {
    return null;
  }

  try {
    const [, payload = ''] = String(sessionToken).split('.');
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');

    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return JSON.parse(window.atob(padded));
    }

    return JSON.parse(globalThis.atob(padded));
  } catch {
    return null;
  }
}

function persistSession(sessionValue) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!sessionValue) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_KEY, sessionValue);
}

function getStoredProcessedEmailIds() {
  if (typeof window === 'undefined') {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(PROCESSED_EMAIL_IDS_KEY);

    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map((value) => String(value))) : new Set();
  } catch {
    return new Set();
  }
}

function persistProcessedEmailIds(ids) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PROCESSED_EMAIL_IDS_KEY, JSON.stringify(Array.from(ids)));
}

function formatRelativeTime(value) {
  if (!value) {
    return 'Just now';
  }

  const diff = Date.now() - value;

  if (diff < 60_000) {
    return 'Just now';
  }

  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} mins ago`;
  }

  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} hrs ago`;
  }

  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function formatActivityTimestamp(value) {
  if (!value) {
    return 'Just now';
  }

  return new Date(value).toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function getGreetingForHour(hour, name = '') {
  const cleanName = trimToNull(String(name ?? ''));

  if (hour < 12) {
    return cleanName ? `Good morning, ${cleanName}.` : 'Good morning.';
  }

  if (hour < 18) {
    return cleanName ? `Good afternoon, ${cleanName}.` : 'Good afternoon.';
  }

  return cleanName ? `Good evening, ${cleanName}.` : 'Good evening.';
}

function normaliseTaskTitle(value) {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!trimmed) {
    return 'New task';
  }

  const title = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return title.length > 46 ? `${title.slice(0, 43)}...` : title;
}

function buildTaskDescription(request, sourceEmail = null) {
  if (sourceEmail) {
    return sourceEmail.body || sourceEmail.subject || 'Drafting a response from the inbox.';
  }

  return String(request ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normaliseTaskCopy(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\.\.\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isDuplicateTaskDescription(description, title) {
  const normalisedDescription = normaliseTaskCopy(description);
  const normalisedTitle = normaliseTaskCopy(title);

  if (!normalisedDescription || !normalisedTitle) {
    return false;
  }

  return (
    normalisedDescription === normalisedTitle ||
    normalisedDescription.startsWith(normalisedTitle) ||
    normalisedTitle.startsWith(normalisedDescription)
  );
}

function isPlaceholderDraftContent(value) {
  const draftContent = trimToNull(String(value ?? ''));
  return Boolean(draftContent && draftContent.includes('[') && draftContent.includes(']'));
}

function buildClarifyingQuestion(request) {
  const lower = request.toLowerCase();

  if (lower.includes('meeting') || lower.includes('book')) {
    return 'Should I prioritise the earliest available slot if everyone is free?';
  }

  if (lower.includes('invoice') || lower.includes('quote')) {
    return 'Do you want me to keep the wording firm rather than warm?';
  }

  return null;
}

function createPlanStep(title, detail, tone = 'queued') {
  return {
    title: String(title ?? '').trim(),
    detail: String(detail ?? '').trim(),
    tone: ['next', 'queued', 'review'].includes(tone) ? tone : 'queued',
  };
}

function tierToTone(tier) {
  if (tier === 1) {
    return 'next';
  }

  if (tier === 3) {
    return 'review';
  }

  return 'queued';
}

function toneToTier(tone) {
  if (tone === 'next') {
    return 1;
  }

  if (tone === 'review') {
    return 3;
  }

  return 2;
}

function createMockDraftPreview(request, sourceEmail = null) {
  const fallbackText =
    'Hi [name], thanks for reaching out. Happy to help with that — I will get back to you shortly with more detail.\n\nBest,\nOlivander Test Account';
  const draftPreview = buildTaskDraftPreview(request, sourceEmail);

  if (!draftPreview) {
    return {
      label: 'Draft',
      text: fallbackText,
    };
  }

  return {
    label: draftPreview.label,
    text: trimToNull(draftPreview.text) ?? fallbackText,
  };
}

function createMockAgentPlan(request, sourceEmail = null) {
  return {
    steps: MOCK_PLAN,
    draftPreview: requestNeedsDraftPreview(request, sourceEmail)
      ? createMockDraftPreview(request, sourceEmail)
      : null,
    clarifyingQuestion: buildClarifyingQuestion(request),
  };
}

function getDisplayPlanSteps(steps) {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step) => {
      if (!step || typeof step !== 'object') {
        return null;
      }

      const description =
        trimToNull(String(step.description ?? step.detail ?? step.title ?? '')) ?? null;

      if (!description) {
        return null;
      }

      const tierValue = Number(step.tier);
      const tier = Number.isFinite(tierValue) ? tierValue : toneToTier(step.tone);

      return {
        description,
        tier: tier === 1 || tier === 2 || tier === 3 ? tier : 2,
      };
    })
    .filter(Boolean);
}

function requestNeedsDraftPreview(request, sourceEmail = null) {
  const lower = String(request ?? '').toLowerCase();

  return Boolean(sourceEmail) || [
    'email',
    'reply',
    'follow up',
    'follow-up',
    'summary',
    'summaris',
    'quote',
    'proposal',
    'invoice',
    'meeting note',
  ].some((keyword) => lower.includes(keyword));
}

function buildTaskPlanSteps(request, sourceEmail = null) {
  const lower = String(request ?? '').toLowerCase();

  if (
    lower.includes('meeting') ||
    lower.includes('calendar') ||
    lower.includes('book')
  ) {
    return [
      createPlanStep(
        'Confirm the brief',
        'Pull the people, timing, and constraints from the request.',
        'next',
      ),
      createPlanStep(
        'Check availability',
        'Review the likely windows and remove obvious conflicts.',
      ),
      createPlanStep(
        'Prepare the details',
        'Draft the invite, agenda, and any note that needs to go with it.',
      ),
      createPlanStep(
        'Queue the release',
        'Send it forward or pause if the wording needs a final check.',
        'review',
      ),
    ];
  }

  if (
    lower.includes('invoice') ||
    lower.includes('payment') ||
    lower.includes('quote') ||
    lower.includes('pricing')
  ) {
    return [
      createPlanStep(
        'Verify the numbers',
        'Check the figures, dates, and any commercial context.',
        'next',
      ),
      createPlanStep(
        'Pull the record',
        'Gather the invoice, quote, or payment history behind the request.',
      ),
      createPlanStep(
        'Draft the response',
        'Write the follow-up with the right tone and specifics.',
      ),
      createPlanStep(
        'Hold for release',
        'Pause if it changes pricing, payment timing, or a client commitment.',
        'review',
      ),
    ];
  }

  if (
    sourceEmail ||
    lower.includes('email') ||
    lower.includes('reply') ||
    lower.includes('follow up') ||
    lower.includes('follow-up')
  ) {
    return [
      createPlanStep(
        'Review the context',
        'Work out what needs to be said and the outcome the message should drive.',
        'next',
      ),
      createPlanStep(
        'Shape the response',
        'Write the reply with the key details in the right tone.',
      ),
      createPlanStep(
        'Check the details',
        'Confirm names, commitments, and phrasing before it goes out.',
      ),
      createPlanStep(
        'Queue the next action',
        'Send it on or hold it if it needs approval first.',
        'review',
      ),
    ];
  }

  if (lower.includes('summary') || lower.includes('summaris') || lower.includes('inbox')) {
    return [
      createPlanStep(
        'Collect the source material',
        'Gather the threads, notes, and context that belong in the summary.',
        'next',
      ),
      createPlanStep(
        'Group the key points',
        'Pull out actions, blockers, deadlines, and anything important.',
      ),
      createPlanStep(
        'Draft the summary',
        'Write the update in a clear order with the next actions visible.',
      ),
      createPlanStep(
        'Flag follow-up',
        'Surface anything that still needs input or approval.',
        'review',
      ),
    ];
  }

  return [
    createPlanStep(
      'Confirm the outcome',
      'Pull the objective, format, and any dates or names from the request.',
      'next',
    ),
    createPlanStep(
      'Gather the context',
      'Collect the information and business details needed to complete it.',
    ),
    createPlanStep(
      'Prepare the work',
      'Draft the next output so the task can move forward cleanly.',
    ),
    createPlanStep(
      'Check for release points',
      'Flag anything sensitive, financial, or client-facing before it goes out.',
      'review',
    ),
  ];
}

function buildTaskDraftPreview(request, sourceEmail = null) {
  const lower = String(request ?? '').toLowerCase();
  const recipient =
    trimToNull(sourceEmail?.senderName) ??
    (sourceEmail ? 'there' : lower.includes('meeting') ? 'everyone' : '[recipient]');

  if (
    sourceEmail ||
    lower.includes('email') ||
    lower.includes('reply') ||
    lower.includes('follow up') ||
    lower.includes('follow-up')
  ) {
    return {
      label: 'Draft reply',
      text:
        `Hi ${recipient},\n\n` +
        'Thanks for your message. I am pulling the details together now and will make sure the next step is clear and easy to action.\n\n' +
        'Best,\nOlivander Technologies',
    };
  }

  if (lower.includes('summary') || lower.includes('summaris') || lower.includes('inbox')) {
    return {
      label: 'Draft summary',
      text:
        'Summary\n\n' +
        '- Priority update\n' +
        '- Follow-up needed\n' +
        '- Important deadline',
    };
  }

  if (lower.includes('quote') || lower.includes('proposal')) {
    return {
      label: 'Draft quote',
      text:
        'Hi [Client name],\n\n' +
        "Thanks for reaching out. Here's a quick outline based on what you've described:\n\n" +
        "Scope: [I'll fill this in once I know more about the project]\n" +
        'Estimate: [To be confirmed — happy to discuss]\n' +
        'Timing: [We can discuss a start date that works for you]\n\n' +
        "Let me know if you'd like to jump on a call to go through the details.",
    };
  }

  if (
    lower.includes('meeting') ||
    lower.includes('calendar') ||
    lower.includes('book')
  ) {
    return {
      label: 'Draft note',
      text:
        `Hi ${recipient},\n\n` +
        'I have pulled together a couple of options for the meeting and will confirm the best slot next.\n\n' +
        'Best,\nOlivander Technologies',
    };
  }

  return requestNeedsDraftPreview(request, sourceEmail)
    ? {
        label: 'Draft',
        text: 'Working draft\n\nThis is being prepared now.',
      }
    : null;
}

function normalisePlanSteps(steps, fallbackSteps = []) {
  if (!Array.isArray(steps)) {
    return fallbackSteps;
  }

  const safeSteps = steps
    .map((step, index) => {
      if (!step || typeof step !== 'object') {
        return null;
      }

      const detail =
        trimToNull(String(step.detail ?? step.description ?? '')) ??
        trimToNull(String(step.title ?? ''));
      const title =
        trimToNull(String(step.title ?? '')) ??
        trimToNull(String(step.description ?? '')) ??
        `Step ${index + 1}`;
      const tone =
        trimToNull(String(step.tone ?? '')) ??
        tierToTone(Number.isFinite(Number(step.tier)) ? Number(step.tier) : 2);

      if (!title || !detail) {
        return null;
      }

      return createPlanStep(title, detail, tone);
    })
    .filter(Boolean);

  return safeSteps.length ? safeSteps.slice(0, 5) : fallbackSteps;
}

function normaliseDraftPreview(draftPreview, fallbackPreview = null) {
  if (!draftPreview || typeof draftPreview !== 'object') {
    return fallbackPreview;
  }

  const label = trimToNull(String(draftPreview.label ?? ''));
  const text = trimToNull(String(draftPreview.text ?? ''));

  if (!label || !text) {
    return fallbackPreview;
  }

  return { label, text };
}

function buildTaskFromRequest(request, overrides = {}) {
  const sourceEmail = overrides.sourceEmail ?? null;
  const planSteps =
    overrides.planSteps ?? buildTaskPlanSteps(request, sourceEmail);
  const draftPreview =
    overrides.draftPreview === undefined
      ? buildTaskDraftPreview(request, sourceEmail)
      : overrides.draftPreview;
  const draftContent =
    overrides.draftContent === undefined ? draftPreview?.text ?? null : overrides.draftContent;

  return {
    id: overrides.id ?? createId('task'),
    name: overrides.name ?? normaliseTaskTitle(request),
    request,
    description: overrides.description ?? buildTaskDescription(request, sourceEmail),
    status: overrides.status ?? 'working',
    updatedAt: overrides.updatedAt ?? Date.now(),
    createdAt: overrides.createdAt ?? Date.now(),
    source: overrides.source ?? (sourceEmail ? 'email' : 'manual'),
    sourceEmailId: overrides.sourceEmailId ?? sourceEmail?.id ?? null,
    sourceEmail,
    clarifyingQuestion:
      overrides.clarifyingQuestion ?? buildClarifyingQuestion(request),
    questionAnswer: overrides.questionAnswer ?? null,
    notes: overrides.notes ?? [],
    planSteps,
    draftPreview,
    draftContent,
    planSummary: overrides.planSummary ?? null,
    planRequestState:
      overrides.planRequestState ?? (planSteps.length || draftContent ? 'ready' : 'loading'),
  };
}

function normaliseAgentPlan(task, agentPlan) {
  if (!agentPlan || typeof agentPlan !== 'object') {
    return task;
  }

  const draftPreview = normaliseDraftPreview(agentPlan.draftPreview, task.draftPreview ?? null);

  return {
    ...task,
    name: normaliseTaskTitle(trimToNull(agentPlan.name) ?? task.name),
    planSteps: normalisePlanSteps(agentPlan.steps, task.planSteps ?? []),
    draftPreview,
    draftContent: draftPreview?.text ?? task.draftContent ?? null,
    planSummary: trimToNull(String(agentPlan.planSummary ?? '')) ?? task.planSummary,
    clarifyingQuestion:
      trimToNull(agentPlan.clarifyingQuestion) ?? task.clarifyingQuestion,
    planRequestState: 'ready',
  };
}

function normaliseIncomingEmail(email) {
  if (!email || typeof email !== 'object') {
    return null;
  }

  const agentResponse =
    trimToNull(String(email.agentResponse ?? email.suggestedReply ?? '')) ?? '';

  return {
    id: String(email.id ?? createId('email')),
    senderName:
      trimToNull(String(email.senderName ?? email.from_name ?? '')) ?? 'Unknown sender',
    senderEmail:
      trimToNull(String(email.senderEmail ?? email.from ?? '')) ?? 'unknown@example.com',
    subject: trimToNull(String(email.subject ?? '')) ?? 'Untitled message',
    body: trimToNull(String(email.body ?? email.snippet ?? '')) ?? '',
    date: email.date ?? null,
    agentResponse,
    requiresApproval: email.requiresApproval ?? Boolean(agentResponse),
    approvalTier: trimToNull(String(email.approvalTier ?? '')) ?? 'Tier 3',
    approvalWhy:
      trimToNull(String(email.approvalWhy ?? '')) ??
      'This message changes a customer-facing action and should be reviewed before it goes out.',
    approvalDelayMs:
      typeof email.approvalDelayMs === 'number' ? email.approvalDelayMs : 1500,
    status: trimToNull(String(email.status ?? '')) ?? 'new',
  };
}

function buildTaskFromEmail(email) {
  return buildTaskFromRequest(`Reply to ${email.senderName} about ${email.subject}`, {
    name: normaliseTaskTitle(`Reply to ${email.senderName}: ${email.subject}`),
    description: buildTaskDescription('', {
      subject: email.subject,
      body: email.body,
    }),
    source: 'email',
    sourceEmailId: email.id,
    sourceEmail: {
      id: email.id,
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      subject: email.subject,
      body: email.body,
    },
  });
}

function buildApprovalFromEmail(email, taskId) {
  return {
    id: createId('approval'),
    taskId,
    sourceEmailId: email.id,
    senderName: email.senderName,
    senderEmail: email.senderEmail,
    subject: email.subject,
    createdAt: Date.now(),
    tier: email.approvalTier,
    why: email.approvalWhy,
    agentResponse: email.agentResponse,
    status: 'review',
    sourceEmail: {
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      subject: email.subject,
      body: email.body,
    },
  };
}

function createEmptyMemoryProfile() {
  return {
    [MEMORY_KEYS.businessName]: 'Olivander Technologies',
    [MEMORY_KEYS.ownerEmail]: '',
    [MEMORY_KEYS.businessType]: '',
    [MEMORY_KEYS.pricingRange]: '',
    [MEMORY_KEYS.paymentTerms]: '',
    [MEMORY_KEYS.gstRegistered]: '',
    [MEMORY_KEYS.replyTone]: '',
    [MEMORY_KEYS.replyToneEdits]: '0',
    [MEMORY_KEYS.reschedulePolicy]: '',
    [MEMORY_KEYS.noShowHandling]: '',
  };
}

function normaliseMemoryProfile(payload) {
  const base = createEmptyMemoryProfile();

  if (!payload || typeof payload !== 'object') {
    return base;
  }

  Object.keys(base).forEach((key) => {
    if (trimToNull(String(payload[key] ?? '')) !== null) {
      base[key] = String(payload[key]).trim();
    }
  });

  if (!trimToNull(base[MEMORY_KEYS.replyTone]) && trimToNull(String(payload.tone ?? ''))) {
    base[MEMORY_KEYS.replyTone] = String(payload.tone).trim();
  }

  return base;
}

function hasMemoryData(profile) {
  if (!profile || typeof profile !== 'object') {
    return false;
  }

  return [
    MEMORY_KEYS.businessType,
    MEMORY_KEYS.pricingRange,
    MEMORY_KEYS.paymentTerms,
    MEMORY_KEYS.gstRegistered,
    MEMORY_KEYS.replyTone,
    MEMORY_KEYS.reschedulePolicy,
    MEMORY_KEYS.noShowHandling,
  ].some((key) => trimToNull(profile[key]) !== null);
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getActivityAppearance(type) {
  if (type === 'approved' || type === 'auto' || type === 'resolved') {
    return { tone: 'success', icon: 'check' };
  }

  if (type === 'rejected') {
    return { tone: 'danger', icon: 'reject' };
  }

  if (type === 'draft') {
    return { tone: 'accent', icon: 'mail' };
  }

  return { tone: 'accent', icon: 'clock' };
}

function filterActivityItems(items, filter) {
  if (filter === 'all') {
    return items;
  }

  return items.filter((item) => item.type === filter);
}

async function readResponseDetail(response, fallbackMessage) {
  try {
    const payload = await response.json();

    if (payload?.detail) {
      return String(payload.detail);
    }
  } catch {
  }

  return fallbackMessage;
}

function IconBase({ children, className = '' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ui-icon ${className}`.trim()}
    >
      {children}
    </svg>
  );
}

function HouseIcon() {
  return (
    <IconBase>
      <path d="M2.4 7.1 8 2.8l5.6 4.3" />
      <path d="M3.8 6.2v7h8.4v-7" />
    </IconBase>
  );
}

function TaskListIcon() {
  return (
    <IconBase>
      <path d="M4.9 4.4h8" />
      <path d="M4.9 8h8" />
      <path d="M4.9 11.6h8" />
      <path d="M2.8 4.4h.1" />
      <path d="M2.8 8h.1" />
      <path d="M2.8 11.6h.1" />
    </IconBase>
  );
}

function CheckCircleIcon() {
  return (
    <IconBase>
      <circle cx="8" cy="8" r="5.8" />
      <path d="m5.7 8.1 1.5 1.5 3.2-3.3" />
    </IconBase>
  );
}

function LinesIcon() {
  return (
    <IconBase>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h9" />
      <path d="M2.5 11.5h7" />
    </IconBase>
  );
}

function ArrowRightIcon() {
  return (
    <IconBase>
      <path d="M3 8h9.2" />
      <path d="m9 4.9 3.2 3.1L9 11.1" />
    </IconBase>
  );
}

function ArrowLeftIcon() {
  return (
    <IconBase>
      <path d="M13 8H3.8" />
      <path d="M7 4.9 3.8 8 7 11.1" />
    </IconBase>
  );
}

function LinkIcon() {
  return (
    <IconBase>
      <path d="M6.1 10 4.7 11.4a2.6 2.6 0 0 1-3.7-3.7L3 5.7" />
      <path d="m9.9 6 1.4-1.4A2.6 2.6 0 1 1 15 8.3l-2 2" />
      <path d="m5.5 10.5 5-5" />
    </IconBase>
  );
}

function PlusIcon() {
  return (
    <IconBase>
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </IconBase>
  );
}

function ChevronIcon({ className = '' }) {
  return (
    <IconBase className={className}>
      <path d="m6 4.6 3.8 3.4L6 11.4" />
    </IconBase>
  );
}

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, display: 'block' }}
      className="ui-icon"
      aria-hidden="true"
    >
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <IconBase>
      <ellipse cx="8" cy="4.2" rx="4.6" ry="1.8" />
      <path d="M3.4 4.2v4.1c0 1 2 1.8 4.6 1.8s4.6-.8 4.6-1.8V4.2" />
      <path d="M3.4 8.3v3.5c0 1 2 1.8 4.6 1.8s4.6-.8 4.6-1.8V8.3" />
    </IconBase>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="ui-icon"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <circle
        cx="12"
        cy="12"
        r="3.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 3V5.25M12 18.75V21M21 12H18.75M5.25 12H3M18.36 5.64l-1.59 1.59M7.23 16.77l-1.59 1.59M18.36 18.36l-1.59-1.59M7.23 7.23 5.64 5.64"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="ui-icon"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <IconBase>
      <path d="M6.1 3.2H3.7a1.2 1.2 0 0 0-1.2 1.2v7.2a1.2 1.2 0 0 0 1.2 1.2h2.4" />
      <path d="M9.1 5.2 12 8l-2.9 2.8" />
      <path d="M5 8h7" />
    </IconBase>
  );
}

function MailIcon() {
  return (
    <IconBase>
      <rect x="2.2" y="3.3" width="11.6" height="9.4" rx="1.6" />
      <path d="m2.9 4.4 5.1 4 5.1-4" />
    </IconBase>
  );
}

function ClockIcon() {
  return (
    <IconBase>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M8 5.2v3.1l2 1.4" />
    </IconBase>
  );
}

function RejectIcon() {
  return (
    <IconBase>
      <circle cx="8" cy="8" r="5.7" />
      <path d="m6.1 6.1 3.8 3.8" />
      <path d="m9.9 6.1-3.8 3.8" />
    </IconBase>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="connection-logo">
      <path
        fill="#4285f4"
        d="M24 14.3c0-.78-.07-1.52-.2-2.24H14v4.24h5.6a4.78 4.78 0 0 1-2.08 3.14v2.6h3.36c1.96-1.8 3.12-4.47 3.12-7.77Z"
      />
      <path
        fill="#34a853"
        d="M14 24.5c2.8 0 5.15-.93 6.87-2.53l-3.36-2.6c-.93.63-2.12 1-3.5 1-2.7 0-4.98-1.82-5.8-4.27H4.74v2.69A10.38 10.38 0 0 0 14 24.5Z"
      />
      <path
        fill="#fbbc04"
        d="M8.2 16.15A6.22 6.22 0 0 1 7.88 14c0-.75.12-1.48.33-2.15V9.16H4.74A10.42 10.42 0 0 0 3.5 14c0 1.67.4 3.24 1.24 4.84l3.46-2.69Z"
      />
      <path
        fill="#ea4335"
        d="M14 7.58c1.52 0 2.89.52 3.96 1.54l2.97-2.97C19.15 4.49 16.8 3.5 14 3.5a10.38 10.38 0 0 0-9.26 5.66l3.47 2.69c.8-2.45 3.08-4.27 5.79-4.27Z"
      />
    </svg>
  );
}

function XeroIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="connection-logo">
      <circle cx="14" cy="14" r="13" fill="#13b5ea" />
      <path
        d="m10.3 10.1 3.55 3.57 3.6-3.57h1.7l-4.45 4.45 4.45 4.45h-1.7l-3.6-3.57-3.55 3.57H8.6l4.43-4.45-4.43-4.45h1.7Z"
        fill="#fff"
      />
    </svg>
  );
}

function ActivityGlyph({ icon }) {
  if (icon === 'check') {
    return <CheckCircleIcon />;
  }

  if (icon === 'mail') {
    return <MailIcon />;
  }

  if (icon === 'reject') {
    return <RejectIcon />;
  }

  return <ClockIcon />;
}

function ActivityList({ items, emptyText, showTimestamp = false }) {
  if (!items.length) {
    return <div className="empty-card">{emptyText}</div>;
  }

  return (
    <div className="activity-list">
      {items.map((item, index) => {
        const appearance = getActivityAppearance(item.type);

        return (
          <article
            key={item.id}
            className={`activity-item ${index === items.length - 1 ? 'is-last' : ''}`}
          >
            <div className={`activity-item__icon tone-${appearance.tone}`}>
              <ActivityGlyph icon={appearance.icon} />
            </div>
            <div className="activity-item__content">
              <div className="activity-item__row">
                <div className="activity-item__name">{item.title}</div>
                {showTimestamp ? (
                  <div className="activity-item__time">
                    {formatActivityTimestamp(item.createdAt ?? item.timestamp)}
                  </div>
                ) : null}
              </div>
              <div className="activity-item__description">{item.description}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function formatTaskAnswer(answer) {
  if (!answer) {
    return '';
  }

  if (answer === 'yes' || answer === 'no') {
    return answer.charAt(0).toUpperCase() + answer.slice(1);
  }

  return answer;
}

function isBinaryTaskAnswer(answer) {
  const normalised = trimToNull(String(answer ?? ''))?.toLowerCase();
  return normalised === 'yes' || normalised === 'no';
}

function TaskCard({
  task,
  isExpanded,
  isCancelling,
  onToggle,
  onAnswerQuestion,
  onNoteSubmit,
  onApproveDraft,
  onCancelTask,
  onSaveDraft,
}) {
  const [note, setNote] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [draftText, setDraftText] = useState(task.draftContent ?? task.draftPreview?.text ?? '');
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [isResolvingQuestion, setIsResolvingQuestion] = useState(false);
  const resolveTimerRef = useRef(null);
  const statusMeta =
    task.status === 'done'
      ? { label: 'Done', tone: 'success' }
      : task.status === 'waiting'
        ? { label: 'Waiting', tone: 'warning' }
        : { label: 'Working', tone: 'accent' };

  useEffect(
    () => () => {
      if (resolveTimerRef.current) {
        window.clearTimeout(resolveTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (resolveTimerRef.current) {
      window.clearTimeout(resolveTimerRef.current);
      resolveTimerRef.current = null;
    }

    setIsResolvingQuestion(false);

    if (task.questionAnswer) {
      setCustomAnswer('');
    }
  }, [task.id, task.questionAnswer]);

  useEffect(() => {
    setDraftText(task.draftContent ?? task.draftPreview?.text ?? '');
    setIsEditingDraft(false);
  }, [task.draftContent, task.draftPreview?.text, task.id]);

  function submitNote(event) {
    event.preventDefault();

    if (!note.trim()) {
      return;
    }

    onNoteSubmit(task.id, note.trim());
    setNote('');
  }

  function resolveQuestion(answer) {
    if (isResolvingQuestion || task.questionAnswer) {
      return;
    }

    setIsResolvingQuestion(true);
    resolveTimerRef.current = window.setTimeout(() => {
      onAnswerQuestion(task.id, answer);
      resolveTimerRef.current = null;
    }, 220);
  }

  function submitCustomAnswer(event) {
    event.preventDefault();
    event.stopPropagation();

    const answer = customAnswer.trim();

    if (!answer) {
      return;
    }

    resolveQuestion(answer);
  }

  const showClarifyingQuestion =
    Boolean(task.clarifyingQuestion) && (!task.questionAnswer || isResolvingQuestion);
  const showAnsweredState =
    Boolean(task.questionAnswer) && !isBinaryTaskAnswer(task.questionAnswer);
  const taskPlanSteps = getDisplayPlanSteps(task.planSteps);
  const draftContent = trimToNull(task.draftContent ?? task.draftPreview?.text ?? '');
  const showDraft = Boolean(draftContent) && !isPlaceholderDraftContent(draftContent);
  const isPlanLoading = task.planRequestState === 'loading' || !taskPlanSteps.length;
  const showDescription =
    Boolean(trimToNull(task.description)) &&
    !isDuplicateTaskDescription(task.description, task.name);
  const canCancelTask = task.status !== 'done' && !isCancelling;
  const firstVisibleSection =
    isPlanLoading || taskPlanSteps.length
      ? 'plan'
      : showDraft
        ? 'draft'
        : showClarifyingQuestion
          ? 'question'
          : null;

  return (
    <article
      className={`task-card ${isExpanded ? 'is-expanded' : ''} ${isCancelling ? 'is-removing' : ''}`}
    >
      <button
        type="button"
        className="task-card__summary"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <span className={`task-card__dot tone-${statusMeta.tone}`} />
        <div className="task-card__heading">
          <div className="task-card__name">{task.name}</div>
          <div className="task-card__timestamp">{formatRelativeTime(task.updatedAt)}</div>
        </div>
        <span className={`task-card__pill tone-${statusMeta.tone}`}>{statusMeta.label}</span>
        <ChevronIcon className={`task-card__chevron ${isExpanded ? 'is-open' : ''}`} />
      </button>

      <div className={`task-card__body-shell ${isExpanded ? 'is-open' : ''}`}>
        <div className="task-card__body" onClick={(event) => event.stopPropagation()}>
          {showDescription ? <div className="task-description">{task.description}</div> : null}

          {isPlanLoading ? (
            <div className="task-plan task-plan--loading">
              <div
                className={`task-section-label ${firstVisibleSection === 'plan' ? 'is-first' : ''}`}
              >
                Plan
              </div>
              <div className="task-loading">
                <div className="plan-spinner" />
                <span>Building the plan…</span>
              </div>
            </div>
          ) : null}

          {taskPlanSteps.length ? (
            <div className="task-plan">
              <div
                className={`task-section-label ${firstVisibleSection === 'plan' ? 'is-first' : ''}`}
              >
                Plan
              </div>
              {taskPlanSteps.map((step, index) => (
                <div key={`${task.id}-step-${index}`} className="task-step-row">
                  <span className="step-num">{index + 1}</span>
                  <span className="step-desc">{step.description}</span>
                  <span className={`tier-pill tier-${step.tier}`}>
                    {step.tier === 1 ? 'Auto' : step.tier === 2 ? 'Queued' : 'Review'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {showDraft ? (
            <div className="task-draft">
              <div
                className={`task-section-label ${firstVisibleSection === 'draft' ? 'is-first' : ''}`}
              >
                Draft
              </div>
              {isEditingDraft ? (
                <textarea
                  className="approval-card__textarea"
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  rows={8}
                />
              ) : (
                <div className="draft-body">{draftContent}</div>
              )}
              <div className="draft-actions">
                {isEditingDraft ? (
                  <>
                    <button
                      type="button"
                      className="btn-approve"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSaveDraft(task.id, draftText);
                        setIsEditingDraft(false);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn-edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDraftText(task.draftContent ?? task.draftPreview?.text ?? '');
                        setIsEditingDraft(false);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-approve"
                      onClick={(event) => {
                        event.stopPropagation();
                        onApproveDraft(task);
                      }}
                    >
                      Approve &amp; send
                    </button>
                    <button
                      type="button"
                      className="btn-edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsEditingDraft(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-reject"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelTask(task);
                      }}
                    >
                      Cancel task
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {showClarifyingQuestion ? (
            <div className={`task-clarify ${isResolvingQuestion ? 'is-resolving' : ''}`}>
              <div
                className={`task-section-label ${firstVisibleSection === 'question' ? 'is-first' : ''}`}
              >
                Question
              </div>
              <div className="clarify-row">
                <span className="clarify-text">{task.clarifyingQuestion}</span>
                <div className="clarify-btns">
                  <button
                    type="button"
                    className={`btn-yes ${
                      task.questionAnswer === 'yes' ? 'is-selected' : ''
                    }`}
                    disabled={isResolvingQuestion}
                    onClick={(event) => {
                      event.stopPropagation();
                      resolveQuestion('yes');
                    }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`btn-no ${
                      task.questionAnswer === 'no' ? 'is-selected' : ''
                    }`}
                    disabled={isResolvingQuestion}
                    onClick={(event) => {
                      event.stopPropagation();
                      resolveQuestion('no');
                    }}
                  >
                    No
                  </button>
                </div>
              </div>
              <form
                className="note-row"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.stopPropagation();
                  if (customAnswer.trim()) {
                    submitCustomAnswer(event);
                    return;
                  }

                  submitNote(event);
                }}
              >
                <input
                  type="text"
                  value={customAnswer || note}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setCustomAnswer(nextValue);
                    setNote(nextValue);
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="note-input"
                  placeholder="Or type a note..."
                  disabled={isResolvingQuestion}
                />
                <button
                  type="submit"
                  className="btn-send"
                  onClick={(event) => event.stopPropagation()}
                  disabled={isResolvingQuestion}
                >
                  Send
                </button>
              </form>
            </div>
          ) : null}

          {showAnsweredState ? (
            <div className="task-answer">{formatTaskAnswer(task.questionAnswer)}</div>
          ) : null}

          {canCancelTask && (!showDraft || isEditingDraft) ? (
            <div className="task-card__footer-actions">
              <button
                type="button"
                className="btn-reject"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelTask(task);
                }}
              >
                Cancel task
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ApprovalCard({
  approval,
  isRemoving,
  onApprove,
  onReject,
  onSaveEdit,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(approval.agentResponse);

  useEffect(() => {
    setIsEditing(false);
    setDraftText(approval.agentResponse);
  }, [approval.agentResponse, approval.id]);

  return (
    <article className={`approval-card ${isRemoving ? 'is-removing' : ''}`}>
      <div className="approval-card__inner">
        <div className="approval-card__header">
          <div className="approval-card__sender">
            <div className="approval-card__sender-name">{approval.senderName}</div>
            <div className="approval-card__sender-email">{approval.senderEmail}</div>
          </div>
          <span
            className={`approval-card__badge ${
              approval.status === 'edited' ? 'is-edited' : 'is-review'
            }`}
          >
            {approval.status === 'edited' ? 'Edited' : 'Ready'}
          </span>
        </div>

        <div className="approval-card__subject">{approval.subject}</div>
        <div className="approval-card__meta">
          {formatRelativeTime(approval.createdAt)} · {approval.tier}
        </div>

        {approval.why ? <div className="approval-card__why-text">{approval.why}</div> : null}

        <div className="approval-card__response-label">Draft</div>
        {isEditing ? (
          <textarea
            className="approval-card__textarea"
            rows="7"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
        ) : (
          <div className="approval-card__response">{approval.agentResponse}</div>
        )}

        <div className="approval-card__actions">
          <button
            type="button"
            className="approval-action approval-action--approve"
            onClick={() => onApprove(approval)}
          >
            Approve
          </button>
          <button
            type="button"
            className="approval-action approval-action--edit"
            onClick={() => {
              if (isEditing) {
                onSaveEdit(approval, draftText);
                setIsEditing(false);
                return;
              }

              setIsEditing(true);
            }}
          >
            {isEditing ? 'Save' : 'Edit'}
          </button>
          <button
            type="button"
            className="approval-action approval-action--reject"
            onClick={() => onReject(approval)}
          >
            Reject
          </button>
        </div>
      </div>
    </article>
  );
}

function PlanStepRows({ steps }) {
  return steps.map((step, index) => (
    <div
      key={`${step.description}-${index}`}
      className={`plan-step-row ${index < steps.length - 1 ? 'is-bordered' : ''}`}
    >
      <span className="plan-step-row__index">{index + 1}</span>
      <span className="plan-step-row__description">{step.description}</span>
      <span className={`tier-pill tier-${step.tier}`}>
        {step.tier === 1 ? 'Auto' : step.tier === 2 ? 'Queued' : 'Review'}
      </span>
    </div>
  ));
}

function AgentRunPanel({ planState, planSteps, onCancel, onApproveAll }) {
  if (!planState) {
    return null;
  }

  return (
    <div className="plan-box">
      {planState === 'loading' ? (
        <div className="plan-box__loading">
          <div className="plan-spinner" />
          Working out a plan...
        </div>
      ) : null}

      {planState === 'ready' ? (
        <>
          <div className="plan-box__header">
            <span className="plan-box__label">Proposed plan</span>
            <div className="plan-box__actions">
              <button className="plan-cancel" onClick={onCancel}>
                Cancel
              </button>
              <button className="plan-approve-all" onClick={onApproveAll}>
                Approve all
              </button>
            </div>
          </div>

          <div className="plan-box__steps">
            <PlanStepRows steps={planSteps} />
          </div>
        </>
      ) : null}

      {planState === 'error' ? (
        <div className="plan-box__error">
          <span className="plan-box__error-text">
            Could not generate a plan — check your connection.
          </span>
          <button className="plan-cancel" onClick={onCancel}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HomePanel({
  currentTime,
  greetingName,
  homeInput,
  onHomeInputChange,
  onHomeSubmit,
  onChipClick,
  onStatClick,
  awaitingApprovalCount,
  activeTaskCount,
  resolvedThisWeekCount,
  planState,
  planSteps,
  onDismissPlan,
  onApprovePlan,
}) {
  const subtitle =
    awaitingApprovalCount > 0
      ? `${awaitingApprovalCount} awaiting approval`
      : activeTaskCount > 0
        ? `${activeTaskCount} active`
        : '';

  return (
    <section className="panel-scroll__inner home-panel">
      <div className="greeting-block">
        <h2 className="display-title">{getGreetingForHour(currentTime.getHours(), greetingName)}</h2>
        {subtitle ? <p className="greeting-subtitle">{subtitle}</p> : null}
      </div>

      <div className="stats-grid">
        <button
          type="button"
          className="stat-card"
          onClick={() => onStatClick('approvals')}
        >
          <div className="stat-card__label">Awaiting approval</div>
          <div className="stat-card__value tone-accent">{awaitingApprovalCount}</div>
        </button>

        <button
          type="button"
          className="stat-card"
          onClick={() => onStatClick('tasks')}
        >
          <div className="stat-card__label">Active tasks</div>
          <div className="stat-card__value">{activeTaskCount}</div>
        </button>

        <button
          type="button"
          className="stat-card"
          onClick={() => onStatClick('activity')}
        >
          <div className="stat-card__label">Resolved this week</div>
          <div className="stat-card__value tone-success">{resolvedThisWeekCount}</div>
        </button>
      </div>

      <section className="instruction-card">
        <form className="instruction-card__row" onSubmit={onHomeSubmit}>
          <input
            type="text"
            className="instruction-card__input"
            value={homeInput}
            onChange={(event) => onHomeInputChange(event.target.value)}
            placeholder="What needs doing?"
          />
          <button
            type="submit"
            className="instruction-card__send"
            aria-label="Send instruction"
          >
            <ArrowRightIcon />
          </button>
        </form>

        <div className="chip-row">
          {HOME_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className="chip-button"
              onClick={() => onChipClick(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      {planState ? (
        <AgentRunPanel
          planState={planState}
          planSteps={planSteps}
          onCancel={onDismissPlan}
          onApproveAll={onApprovePlan}
        />
      ) : null}
    </section>
  );
}

function TasksPanel({
  taskInput,
  onTaskInputChange,
  onTaskSubmit,
  taskFilter,
  onTaskFilterChange,
  showTaskComposer,
  onNewTaskClick,
  visibleTasks,
  removingTasks,
  expandedTaskId,
  onToggleTask,
  onAnswerQuestion,
  onNoteSubmit,
  onApproveDraft,
  onCancelTask,
  onSaveDraft,
}) {
  return (
    <section className="panel-scroll__inner tasks-panel">
      <div className="panel-heading panel-heading--row">
        <h2 className="section-title">Tasks</h2>
        <button
          type="button"
          className="primary-button"
          aria-label="New task"
          onClick={onNewTaskClick}
        >
          <PlusIcon />
        </button>
      </div>

      {showTaskComposer ? (
        <form className="task-composer" onSubmit={onTaskSubmit}>
          <input
            type="text"
            className="task-composer__input"
            value={taskInput}
            onChange={(event) => onTaskInputChange(event.target.value)}
            placeholder="New task"
          />
          <button type="submit" className="task-composer__send">
            Add
          </button>
        </form>
      ) : null}

      <div className="filter-row">
        {TASK_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`filter-chip ${taskFilter === filter ? 'is-active' : ''}`}
            onClick={() => onTaskFilterChange(filter)}
          >
            {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      {visibleTasks.length ? (
        <div className="task-list">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isExpanded={expandedTaskId === task.id}
              isCancelling={Boolean(removingTasks[task.id])}
              onToggle={() => onToggleTask(task.id)}
              onAnswerQuestion={onAnswerQuestion}
              onNoteSubmit={onNoteSubmit}
              onApproveDraft={onApproveDraft}
              onCancelTask={onCancelTask}
              onSaveDraft={onSaveDraft}
            />
          ))}
        </div>
      ) : (
        <div className="empty-card">No tasks</div>
      )}
    </section>
  );
}

function ApprovalsPanel({
  approvals,
  removingApprovals,
  onApprove,
  onReject,
  onSaveEdit,
}) {
  return (
    <section className="panel-scroll__inner approvals-panel">
      {approvals.length ? (
        approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            isRemoving={Boolean(removingApprovals[approval.id])}
            onApprove={onApprove}
            onReject={onReject}
            onSaveEdit={onSaveEdit}
          />
        ))
      ) : (
        <div className="empty-card empty-card--center">No approvals</div>
      )}
    </section>
  );
}

function ActivityPanel({
  activityFilter,
  onActivityFilterChange,
  activityItems,
  recentEmailsError,
}) {
  return (
    <section className="panel-scroll__inner activity-panel">
      <div className="panel-heading">
        <h2 className="section-title">Activity</h2>
      </div>

      <div className="filter-row filter-row--spacious">
        {ACTIVITY_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`filter-chip ${activityFilter === filter ? 'is-active' : ''}`}
            onClick={() => onActivityFilterChange(filter)}
          >
            {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      <ActivityList
        items={activityItems}
        emptyText="No activity"
        showTimestamp
      />
      {recentEmailsError ? <div className="inline-error">{recentEmailsError}</div> : null}
    </section>
  );
}

function SettingsPanel({
  activeSection,
  googleConnected,
  googleBusy,
  onGoogleToggle,
  onThemeToggle,
  theme,
  profile,
  isMemoryLoading,
  memoryError,
}) {
  const showMemoryEmptyState = !isMemoryLoading && !hasMemoryData(profile);
  const nextThemeLabel = theme === 'dark' ? 'Switch to light' : 'Switch to dark';
  const nextThemeIcon = theme === 'dark' ? <MoonIcon /> : <SunIcon />;

  return (
    <section className="panel-scroll__inner settings-panel">
      {activeSection === 'connections' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Connections</div>

          <div className="connection-row">
            <div className="connection-row__left">
              <GoogleIcon />
              <div>
                <div className="connection-row__name">Google Workspace</div>
                <div className="connection-row__meta">Gmail · Calendar</div>
              </div>
            </div>
            <button
              type="button"
              className={`connection-button ${
                googleConnected ? 'is-connected' : 'is-primary'
              }`}
              disabled={googleBusy}
              onClick={onGoogleToggle}
            >
              {googleBusy
                ? googleConnected
                  ? 'Connected'
                  : 'Connecting...'
                : googleConnected
                  ? 'Connected'
                  : 'Connect Google'}
            </button>
          </div>

          <div className="connection-row">
            <div className="connection-row__left">
              <XeroIcon />
              <div>
                <div className="connection-row__name">Xero</div>
                <div className="connection-row__meta">Invoicing · Payments</div>
              </div>
            </div>
            <button
              type="button"
              className="connection-button is-primary is-disabled"
              disabled
              title="Coming soon"
            >
              Connect Xero
            </button>
          </div>
        </section>
      ) : null}

      {activeSection === 'appearance' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Appearance</div>
          <div className="settings-option-row">
            <div>
              <div className="tier-row__name">Theme</div>
            </div>
            <button
              type="button"
              className="connection-button is-primary"
              onClick={onThemeToggle}
            >
              {nextThemeIcon}
              <span>{nextThemeLabel}</span>
            </button>
          </div>
        </section>
      ) : null}

      {activeSection === 'memory' ? (
        <section className="settings-section settings-section--memory">
          <div className="settings-section__heading">Memory</div>
          {memoryError ? <div className="inline-error">{memoryError}</div> : null}
          {showMemoryEmptyState ? (
            <div className="settings-empty-state">Nothing saved yet.</div>
          ) : (
            <MemoryPanel
              profile={profile}
              isLoading={isMemoryLoading}
              memoryError=""
            />
          )}
        </section>
      ) : null}
    </section>
  );
}

function MemoryPanel({ profile, isLoading, memoryError }) {
  return (
    <div className="memory-panel">
      {memoryError ? <div className="inline-error">{memoryError}</div> : null}
      <section className="settings-section">
        <div className="settings-section__heading">Profile</div>
        {BUSINESS_PROFILE_ROWS.map((row) => (
          <div key={row.key} className="memory-row">
            <div className="memory-row__label">{row.label}</div>
            <div className="memory-row__value">
              {isLoading ? 'Loading...' : trimToNull(profile[row.key]) ?? '—'}
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <div className="settings-section__heading">Preferences</div>
        {PREFERENCE_ROWS.map((row) => {
          const label =
            row.key === MEMORY_KEYS.replyTone
              ? `Reply tone (${parseInt(profile[MEMORY_KEYS.replyToneEdits] || '0', 10) || 0} edits)`
              : row.label;

          return (
            <div key={row.key} className="memory-preference">
              <div className="memory-preference__label">{label}</div>
              <div className="memory-preference__description">
                {isLoading ? 'Loading...' : trimToNull(profile[row.key]) ?? '—'}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function DashboardApp() {
  const { flick, flashWandState, setWandState } = useWandState();
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
  const [activePanel, setActivePanel] = useState('home');
  const [settingsSection, setSettingsSection] = useState('connections');
  const [profileMenuState, setProfileMenuState] = useState(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [homeInput, setHomeInput] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [showTaskComposer, setShowTaskComposer] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isWorkflowProcessing, setIsWorkflowProcessing] = useState(false);
  const [planState, setPlanState] = useState(null);
  const [homePlanSteps, setHomePlanSteps] = useState([]);
  const [homeRunTask, setHomeRunTask] = useState(null);
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

  const sortedTasks = [...tasks].sort((left, right) => right.updatedAt - left.updatedAt);
  const visibleTasks = sortedTasks.filter((task) =>
    taskFilter === 'all' ? true : task.status === taskFilter,
  );
  const sortedApprovals = [...approvals].sort((left, right) => right.createdAt - left.createdAt);
  const activeTaskCount = tasks.filter((task) => task.status !== 'done').length;
  const businessName =
    trimToNull(memoryProfile[MEMORY_KEYS.businessName]) ?? 'Olivander Technologies';
  const profileMeta = trimToNull(memoryProfile[MEMORY_KEYS.businessType]) ?? 'Workspace';
  const isSettingsPanel = activePanel === 'settings';

  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  const combinedActivity = [
    ...activity,
    ...recentEmails.map((email) => ({
      id: `gmail-${email.id}`,
      title: trimToNull(email.senderName ?? email.from_name ?? email.from) ?? 'Inbox message',
      description:
        trimToNull(email.subject ?? email.snippet ?? email.body) ?? 'Recent Gmail activity',
      createdAt: toTimestamp(email.date),
      timestamp: toTimestamp(email.date),
      type: 'draft',
    })),
  ].sort(
    (left, right) =>
      (right.createdAt ?? right.timestamp ?? 0) - (left.createdAt ?? left.timestamp ?? 0),
  );

  const visibleActivity = filterActivityItems(combinedActivity, activityFilter);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const resolvedThisWeekCount = activity.filter(
    (item) =>
      (item.type === 'auto' || item.type === 'approved') && item.createdAt >= weekAgo,
  ).length;
  const sessionPayload = decodeSessionPayload(sessionToken);
  const tokenContactName = trimToNull(String(sessionPayload?.contact_name ?? '')) ?? '';
  const tokenEmailName =
    trimToNull(String(sessionPayload?.email ?? '').split('@')[0] ?? '') ?? '';
  const memoryBusinessName = trimToNull(memoryProfile[MEMORY_KEYS.businessName]) ?? '';
  const resolvedBusinessName =
    (trimToNull(sessionBusinessName) ?? '') ||
    (memoryBusinessName && memoryBusinessName !== 'Olivander Technologies'
      ? memoryBusinessName
      : '');
  const greetingName =
    tokenContactName ||
    (trimToNull(businessContactName) ?? '') ||
    resolvedBusinessName ||
    tokenEmailName;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!tasks.length) {
      setExpandedTaskId(null);
      return;
    }

    if (expandedTaskId === null) {
      return;
    }

    if (tasks.some((task) => task.id === expandedTaskId)) {
      return;
    }

    setExpandedTaskId(tasks[0].id);
  }, [expandedTaskId, tasks]);

  useEffect(() => {
    const nextBaseState = isPlanning
      ? 'thinking'
      : isWorkflowProcessing
        ? 'processing'
        : googleConnected || activeTaskCount || sortedApprovals.length
          ? 'active'
          : 'inactive';

    setWandState(nextBaseState);
  }, [
    activeTaskCount,
    googleConnected,
    isPlanning,
    isWorkflowProcessing,
    sortedApprovals.length,
    setWandState,
  ]);

  useEffect(
    () => () => {
      panelTimersRef.current.forEach((timer) => window.clearTimeout(timer));

      if (processingTimerRef.current) {
        window.clearTimeout(processingTimerRef.current);
      }

      if (profileMenuTimerRef.current) {
        window.clearTimeout(profileMenuTimerRef.current);
      }

      if (themeSwitchTimerRef.current) {
        window.clearTimeout(themeSwitchTimerRef.current);
      }

      if (oauthPollRef.current) {
        window.clearInterval(oauthPollRef.current);
      }

      Object.values(approvalTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMemory() {
      if (!sessionToken) {
        setMemoryProfile(createEmptyMemoryProfile());
        setMemoryError('');
        setIsMemoryLoading(false);
        return;
      }

      setIsMemoryLoading(true);
      setMemoryError('');

      try {
        const response = await fetchProtected('/api/memory');

        if (response.status === 401) {
          return;
        }

        if (!response.ok) {
          throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
        }

        const payload = await response.json();

        if (!cancelled) {
          setMemoryProfile(normaliseMemoryProfile(payload));
        }
      } catch (error) {
        if (!cancelled) {
          setMemoryProfile(createEmptyMemoryProfile());
          setMemoryError('Could not load — check connection');
        }
      } finally {
        if (!cancelled) {
          setIsMemoryLoading(false);
        }
      }
    }

    void loadMemory();

    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  useEffect(() => {
    function handleOauthMessage(event) {
      if (event.origin !== BACKEND_ORIGIN) {
        return;
      }

      const payload = event.data ?? {};

      if (payload.source !== 'olivander-google-oauth' || payload.provider !== 'google') {
        return;
      }

      if (oauthPollRef.current) {
        window.clearInterval(oauthPollRef.current);
        oauthPollRef.current = null;
      }

      const nextSession = trimToNull(String(payload.session ?? ''));

      if (nextSession) {
        persistSession(nextSession);
        setSessionToken(nextSession);
      }

      setGoogleConnected(true);
      setGoogleBusy(false);
      addActivityItem('resolved', 'Google Workspace connected', 'Gmail and Calendar are ready.');
      flashWandState('success', SUCCESS_FLASH_MS);
    }

    window.addEventListener('message', handleOauthMessage);
    void syncGoogleConnectionStatus({ silent: true });

    return () => {
      window.removeEventListener('message', handleOauthMessage);
    };
  }, [flashWandState, sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      setRecentEmails([]);
      setRecentEmailsError('');
      return undefined;
    }

    let cancelled = false;
    let syncing = false;

    async function syncInbox() {
      if (cancelled || syncing) {
        return;
      }

      syncing = true;

      try {
        const response = await fetchProtected('/api/emails');

        if (response.status === 401) {
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed with status ${response.status}`);
        }

        const inbox = await response.json();

        if (!cancelled) {
          setRecentEmailsError('');
          reconcileInboxSnapshot(inbox);
        }
      } catch {
        if (!cancelled) {
          setRecentEmailsError('Could not load — check connection');
        }
      } finally {
        syncing = false;
      }
    }

    void syncInbox();

    const interval = window.setInterval(syncInbox, INBOX_SYNC_INTERVAL_MS);

    function handleFocus() {
      void syncInbox();
    }

    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      setRecentEmails([]);
      setRecentEmailsError('');
      return undefined;
    }

    let cancelled = false;

    async function loadRecentEmails() {
      setRecentEmailsError('');

      try {
        const response = await fetchProtected(`/gmail/recent?max_results=${RECENT_EMAILS_MAX}`);

        if (response.status === 401) {
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed with status ${response.status}`);
        }

        const payload = await response.json();

        if (!cancelled) {
          setRecentEmails(Array.isArray(payload) ? payload : []);
          setRecentEmailsError('');
        }
      } catch (error) {
        if (!cancelled) {
          setRecentEmails([]);
          setRecentEmailsError('Could not load — check connection');
        }
      }
    }

    void loadRecentEmails();

    return () => {
      cancelled = true;
    };
  }, [sessionToken, approvals.length, tasks.length]);

  function pulseProcessing(duration = PROCESSING_PULSE_MS) {
    if (processingTimerRef.current) {
      window.clearTimeout(processingTimerRef.current);
    }

    setIsWorkflowProcessing(true);
    processingTimerRef.current = window.setTimeout(() => {
      setIsWorkflowProcessing(false);
    }, duration);
  }

  function addActivityItem(type, title, description) {
    setActivity((current) => [
      {
        id: createId('activity'),
        type,
        title,
        description,
        createdAt: Date.now(),
      },
      ...current,
    ]);
  }

  function buildAuthHeaders(headers = {}) {
    const nextHeaders = new Headers(headers);

    if (sessionToken) {
      nextHeaders.set('Authorization', `Bearer ${sessionToken}`);
    }

    return nextHeaders;
  }

  function clearSessionState() {
    persistSession(null);
    setSessionToken(null);
    setGoogleConnected(false);
    setBusinessContactName('');
    setSessionBusinessName('');
    processedEmailIdsRef.current = new Set();
    persistProcessedEmailIds(processedEmailIdsRef.current);
  }

  async function fetchProtected(path, options = {}) {
    try {
      const response = await fetch(buildBackendUrl(path), {
        ...options,
        credentials: 'include',
        headers: buildAuthHeaders(options.headers),
      });

      if (response.status === 401 && sessionToken) {
        clearSessionState();
        requestPanel('home');
      }

      return response;
    } catch (error) {
      throw error;
    }
  }

  async function syncGoogleConnectionStatus({ silent = false } = {}) {
    try {
      const response = await fetch(buildBackendUrl('/api/connections'), {
        credentials: 'include',
        headers: buildAuthHeaders(),
      });

      if (response.status === 401) {
        if (sessionToken) {
          clearSessionState();
        }
        setGoogleConnected(false);
        setBusinessContactName('');
        setSessionBusinessName('');
        return false;
      }

      if (!response.ok) {
        throw new Error(`Failed with status ${response.status}`);
      }

      const payload = await response.json();
      const isConnected = Boolean(payload.google);
      setBusinessContactName(
        trimToNull(String(payload.contact_name ?? payload.first_name ?? '')) ?? '',
      );
      setSessionBusinessName(trimToNull(String(payload.business_name ?? '')) ?? '');
      setGoogleConnected(isConnected);
      return isConnected;
    } catch (error) {
      setGoogleConnected(false);
      setBusinessContactName('');
      setSessionBusinessName('');

      if (!silent) {
        flashWandState('error', ERROR_FLASH_MS);
      }

      return false;
    }
  }

  function requestPanel(nextPanel) {
    if (nextPanel === activePanel || isPanelTransitioningRef.current) {
      closeProfileMenu();
      return;
    }

    if (profileMenuTimerRef.current) {
      window.clearTimeout(profileMenuTimerRef.current);
    }

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

            if (frame) {
              void frame.offsetWidth;
              frame.classList.add('panel-enter');
            }

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

    if (activePanel === 'settings') {
      closeProfileMenu();
      return;
    }

    requestPanel('settings');
  }

  function handleLogoClick() {
    setSettingsSection('connections');
    requestPanel('home');
  }

  function handleSettingsBack() {
    setSettingsSection('connections');
    requestPanel('home');
  }

  function openProfileMenu() {
    if (profileMenuTimerRef.current) {
      window.clearTimeout(profileMenuTimerRef.current);
    }

    setProfileMenuState('open');
  }

  function closeProfileMenu() {
    if (!profileMenuState) {
      return;
    }

    if (profileMenuTimerRef.current) {
      window.clearTimeout(profileMenuTimerRef.current);
    }

    setProfileMenuState('closing');
    profileMenuTimerRef.current = window.setTimeout(() => {
      setProfileMenuState(null);
    }, DEFAULT_POPUP_CLOSE_MS);
  }

  function toggleProfileMenu() {
    if (profileMenuState === 'open') {
      closeProfileMenu();
      return;
    }

    openProfileMenu();
  }

  function watchOauthPopup(popupWindow) {
    if (oauthPollRef.current) {
      window.clearInterval(oauthPollRef.current);
    }

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
    if (googleConnected || googleBusy) {
      return;
    }

    setGoogleBusy(true);

    try {
      const response = await fetch(buildBackendUrl('/auth/google'), {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed with status ${response.status}`);
      }

      const payload = await response.json();
      const popupWindow = window.open(
        payload.url,
        'olivander-google-oauth',
        'popup=yes,width=560,height=720',
      );

      if (!popupWindow) {
        throw new Error('Popup blocked');
      }

      popupWindow.focus();
      watchOauthPopup(popupWindow);
    } catch (error) {
      setGoogleBusy(false);
      flashWandState('error', ERROR_FLASH_MS);
    }
  }

  async function handleGoogleDisconnect() {
    if (!googleConnected || googleBusy) {
      return;
    }

    setGoogleBusy(true);

    try {
      const response = await fetchProtected('/api/connections/google/disconnect', {
        method: 'POST',
      });

      if (response.status === 401) {
        return;
      }

      if (!response.ok) {
        throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
      }

      clearSessionState();
      setGoogleBusy(false);
      addActivityItem('pending', 'Google Workspace disconnected', 'Stored access was removed.');
      openSettings('connections');
    } catch (error) {
      setGoogleBusy(false);
      flashWandState('error', ERROR_FLASH_MS);
    }
  }

  async function fetchAgentPlan(request, sourceEmail = null) {
    const response = await fetchProtected('/api/agent/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request,
        source_email: sourceEmail,
      }),
    });

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
    }

    return response.json();
  }

  async function createTaskWithAgentPlan(request, options = {}) {
    const fallbackTask = options.baseTask ?? buildTaskFromRequest(request, options);
    const sourceEmail = options.sourceEmail ?? null;

    if (USE_MOCK_AGENT_PLAN) {
      await new Promise((resolve) => window.setTimeout(resolve, PLAN_MOCK_DELAY_MS));

      return {
        ...normaliseAgentPlan(fallbackTask, createMockAgentPlan(request, sourceEmail)),
        planRequestState: 'ready',
      };
    }

    try {
      const agentPlan = await fetchAgentPlan(request, sourceEmail);
      if (!agentPlan) {
        return {
          ...normaliseAgentPlan(fallbackTask, createMockAgentPlan(request, sourceEmail)),
          planRequestState: 'ready',
        };
      }

      const normalisedTask = normaliseAgentPlan(fallbackTask, agentPlan);
      const hasStructuredPlan = Array.isArray(agentPlan.steps) && agentPlan.steps.length > 0;

      if (!hasStructuredPlan) {
        return {
          ...normaliseAgentPlan(normalisedTask, createMockAgentPlan(request, sourceEmail)),
          planRequestState: 'ready',
        };
      }

      return {
        ...normalisedTask,
        planRequestState: 'ready',
      };
    } catch {
      return {
        ...normaliseAgentPlan(fallbackTask, createMockAgentPlan(request, sourceEmail)),
        planRequestState: 'ready',
      };
    }
  }

  async function submitInstruction(text, origin) {
    const value = text.trim();

    if (!value || isPlanning) {
      return;
    }

    flick();
    pulseProcessing();
    setIsPlanning(true);

    try {
      const baseTask = buildTaskFromRequest(value, {
        planSteps: [],
        draftPreview: null,
        draftContent: null,
        clarifyingQuestion: null,
        planRequestState: 'loading',
      });
      if (origin === 'home') {
        setPlanState('loading');
        setHomePlanSteps([]);
        setHomeRunTask(null);
      }

      setTasks((current) => [baseTask, ...current]);
      setExpandedTaskId(baseTask.id);
      addActivityItem('draft', 'Task created', baseTask.name);

      if (origin === 'home') {
        panelTimersRef.current.push(
          window.setTimeout(() => {
            setPlanState(null);
            setHomePlanSteps([]);
            setHomeRunTask(null);
            requestPanel('tasks');
          }, TASKS_AUTO_NAV_DELAY_MS),
        );
      }

      const createdTask = await createTaskWithAgentPlan(value, { baseTask });
      setTasks((current) =>
        current.map((task) => (task.id === baseTask.id ? createdTask : task)),
      );
      setExpandedTaskId(createdTask.id);

      if (origin === 'home' && activePanelRef.current === 'home') {
        setHomeRunTask(createdTask);
        setHomePlanSteps(getDisplayPlanSteps(createdTask.planSteps));
        setPlanState('ready');
      }

      if (origin === 'tasks') {
        setTaskInput('');
        setShowTaskComposer(false);
      } else {
        setHomeInput('');
      }
    } catch {
      if (origin === 'home') {
        setPlanState('error');
        setHomeRunTask(null);
        setHomePlanSteps([]);
      }
      flashWandState('error', ERROR_FLASH_MS);
    } finally {
      setIsPlanning(false);
    }
  }

  function clearApprovalTimer(taskId) {
    const timer = approvalTimersRef.current[taskId];

    if (timer) {
      window.clearTimeout(timer);
      delete approvalTimersRef.current[taskId];
    }
  }

  function scheduleApproval(email, taskId) {
    clearApprovalTimer(taskId);

    approvalTimersRef.current[taskId] = window.setTimeout(() => {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: 'waiting',
                updatedAt: Date.now(),
              }
            : task,
        ),
      );

      setApprovals((current) => {
        if (current.some((approval) => approval.taskId === taskId)) {
          return current;
        }

        return [buildApprovalFromEmail(email, taskId), ...current];
      });

      addActivityItem('pending', 'Approval queued', `Reply to ${email.senderName} is ready.`);
      delete approvalTimersRef.current[taskId];
    }, email.approvalDelayMs);
  }

  async function handleIncomingEmail(email) {
    const normalisedEmail = normaliseIncomingEmail(email);

    if (!normalisedEmail || normalisedEmail.status === 'actioned') {
      return;
    }

    if (processedEmailIdsRef.current.has(normalisedEmail.id)) {
      return;
    }

    processedEmailIdsRef.current.add(normalisedEmail.id);
    persistProcessedEmailIds(processedEmailIdsRef.current);

    flick();
    pulseProcessing();
    setIsPlanning(true);

    try {
      const fallbackTask = buildTaskFromEmail(normalisedEmail);
      const task = await createTaskWithAgentPlan(
        `Reply to ${normalisedEmail.senderName} about ${normalisedEmail.subject}`,
        {
          baseTask: fallbackTask,
          sourceEmail: fallbackTask.sourceEmail,
        },
      );

      setTasks((current) => [task, ...current]);
      setExpandedTaskId(task.id);
      addActivityItem('draft', 'Inbox task created', normalisedEmail.subject);

      if (normalisedEmail.requiresApproval) {
        scheduleApproval(normalisedEmail, task.id);
      }
    } finally {
      setIsPlanning(false);
    }
  }

  function reconcileInboxSnapshot(inboxEmails) {
    if (!Array.isArray(inboxEmails)) {
      return;
    }

    const activeEmails = inboxEmails
      .map((email) => normaliseIncomingEmail(email))
      .filter(Boolean)
      .filter((email) => email.status !== 'actioned');
    const activeIds = new Set(activeEmails.map((email) => email.id));

    processedEmailIdsRef.current.forEach((emailId) => {
      if (!activeIds.has(emailId)) {
        processedEmailIdsRef.current.delete(emailId);
      }
    });

    persistProcessedEmailIds(processedEmailIdsRef.current);

    activeEmails.forEach((email) => {
      void handleIncomingEmail(email);
    });
  }

  async function saveReplyToneEditCount(nextCount) {
    if (!sessionToken) {
      return;
    }

    try {
      await fetchProtected('/api/memory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: MEMORY_KEYS.replyToneEdits,
          value: String(nextCount),
        }),
      });
    } catch {
    }
  }

  async function handleApproveApproval(approval) {
    if (removingApprovals[approval.id]) {
      return;
    }

    setRemovingApprovals((current) => ({
      ...current,
      [approval.id]: 'approve',
    }));
    pulseProcessing(700);

    try {
      if (approval.sourceEmailId && sessionToken) {
        const response = await fetchProtected(`/api/emails/${approval.sourceEmailId}/action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'send',
            reply: approval.agentResponse,
          }),
        });

        if (response.status !== 401 && !response.ok) {
          throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
        }
      }

      window.setTimeout(() => {
        setApprovals((current) => current.filter((item) => item.id !== approval.id));
        setRemovingApprovals((current) => {
          const next = { ...current };
          delete next[approval.id];
          return next;
        });
      }, APPROVAL_REMOVE_MS);

      setTasks((current) =>
        current.map((task) =>
          task.id === approval.taskId
            ? {
                ...task,
                status: 'done',
                updatedAt: Date.now(),
              }
            : task,
        ),
      );
      addActivityItem('approved', 'Approved', approval.subject);
      flashWandState('success', APPROVAL_FLASH_MS);
    } catch {
      setRemovingApprovals((current) => {
        const next = { ...current };
        delete next[approval.id];
        return next;
      });
      flashWandState('error', ERROR_FLASH_MS);
    }
  }

  function handleRejectApproval(approval) {
    if (removingApprovals[approval.id]) {
      return;
    }

    setRemovingApprovals((current) => ({
      ...current,
      [approval.id]: 'reject',
    }));

    window.setTimeout(() => {
      setApprovals((current) => current.filter((item) => item.id !== approval.id));
      setRemovingApprovals((current) => {
        const next = { ...current };
        delete next[approval.id];
        return next;
      });
    }, APPROVAL_REMOVE_MS);

    setTasks((current) =>
      current.map((task) =>
        task.id === approval.taskId
          ? {
              ...task,
              status: 'done',
              updatedAt: Date.now(),
            }
          : task,
      ),
    );

    addActivityItem('rejected', 'Rejected', approval.subject);
    flashWandState('error', APPROVAL_FLASH_MS);
  }

  function handleSaveApprovalEdit(approval, nextText) {
    const trimmed = nextText.trim();

    if (!trimmed) {
      return;
    }

    setApprovals((current) =>
      current.map((item) =>
        item.id === approval.id
          ? {
              ...item,
              agentResponse: trimmed,
              status: 'edited',
            }
          : item,
      ),
    );

    setMemoryProfile((current) => {
      const currentCount = parseInt(current[MEMORY_KEYS.replyToneEdits] || '0', 10) || 0;
      const nextCount = currentCount + 1;
      void saveReplyToneEditCount(nextCount);

      return {
        ...current,
        [MEMORY_KEYS.replyToneEdits]: String(nextCount),
      };
    });

    addActivityItem('draft', 'Approval updated', approval.subject);
  }

  function handleTaskQuestion(taskId, answer) {
    const answerSummary =
      answer === 'yes' || answer === 'no' ? `Answered ${answer}.` : `Answered: ${answer}`;

    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              questionAnswer: answer,
              updatedAt: Date.now(),
            }
          : task,
      ),
    );

    addActivityItem('pending', 'Clarification recorded', answerSummary);
  }

  function handleTaskNoteSubmit(taskId, note) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              updatedAt: Date.now(),
              notes: [...task.notes, { id: createId('note'), text: note, createdAt: Date.now() }],
            }
          : task,
      ),
    );

    addActivityItem('draft', 'Task note added', note);
  }

  function handleTaskDraftSave(taskId, nextText) {
    const trimmed = nextText.trim();
    const taskName = tasks.find((task) => task.id === taskId)?.name ?? 'Draft';

    if (!trimmed) {
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              draftContent: trimmed,
              draftPreview: task.draftPreview
                ? { ...task.draftPreview, text: trimmed }
                : { label: 'Draft', text: trimmed },
              updatedAt: Date.now(),
            }
          : task,
      ),
    );

    let updatedApproval = false;
    setApprovals((current) =>
      current.map((approval) => {
        if (approval.taskId !== taskId) {
          return approval;
        }

        updatedApproval = true;
        return {
          ...approval,
          agentResponse: trimmed,
          status: 'edited',
        };
      }),
    );

    if (updatedApproval) {
      setMemoryProfile((current) => {
        const currentCount = parseInt(current[MEMORY_KEYS.replyToneEdits] || '0', 10) || 0;
        const nextCount = currentCount + 1;
        void saveReplyToneEditCount(nextCount);

        return {
          ...current,
          [MEMORY_KEYS.replyToneEdits]: String(nextCount),
        };
      });
    }

    addActivityItem('draft', 'Draft updated', taskName);
  }

  async function handleTaskDraftApprove(task) {
    const matchingApproval = approvals.find((approval) => approval.taskId === task.id);

    if (matchingApproval) {
      await handleApproveApproval(matchingApproval);
      return;
    }

    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: 'done',
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
    addActivityItem('approved', 'Approved', task.name);
    flashWandState('success', APPROVAL_FLASH_MS);
  }

  function handleCancelTask(task) {
    if (!task || removingTasks[task.id]) {
      return;
    }

    const matchingApproval = approvals.find((approval) => approval.taskId === task.id);

    if (matchingApproval && removingApprovals[matchingApproval.id]) {
      return;
    }

    clearApprovalTimer(task.id);
    setRemovingTasks((current) => ({
      ...current,
      [task.id]: true,
    }));

    if (matchingApproval) {
      setRemovingApprovals((current) => ({
        ...current,
        [matchingApproval.id]: 'reject',
      }));
    }

    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
    }

    addActivityItem('rejected', 'Cancelled', task.name);
    flashWandState('error', APPROVAL_FLASH_MS);

    window.setTimeout(() => {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setRemovingTasks((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });

      if (matchingApproval) {
        setApprovals((current) => current.filter((item) => item.id !== matchingApproval.id));
        setRemovingApprovals((current) => {
          const next = { ...current };
          delete next[matchingApproval.id];
          return next;
        });
      }

      if (homeRunTask?.id === task.id) {
        setPlanState(null);
        setHomePlanSteps([]);
        setHomeRunTask(null);
      }
    }, APPROVAL_REMOVE_MS);
  }

  function handleApproveHomePlan(task) {
    if (!task) {
      return;
    }

    setExpandedTaskId(task.id);
    setPlanState(null);
    setHomePlanSteps([]);
    setHomeRunTask(null);
    addActivityItem('approved', 'Plan approved', task.name);
    flashWandState('success', APPROVAL_FLASH_MS);
    requestPanel('tasks');
  }

  function dismissHomePlan() {
    setPlanState(null);
    setHomePlanSteps([]);
    setHomeRunTask(null);
  }

  async function handleLogout() {
    if (googleConnected) {
      await handleGoogleDisconnect();
      return;
    }

    clearSessionState();
    closeProfileMenu();
    setSettingsSection('connections');
    requestPanel('home');
  }

  function handleThemeToggle() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    if (themeSwitchTimerRef.current) {
      window.clearTimeout(themeSwitchTimerRef.current);
    }

    setIsThemeSwitching(true);
    setTheme(nextTheme);

    themeSwitchTimerRef.current = window.setTimeout(() => {
      setIsThemeSwitching(false);
      themeSwitchTimerRef.current = null;
    }, THEME_SWITCH_MS);
  }

  const sidebarItems = [
    { id: 'home', label: 'Home', icon: <HouseIcon /> },
    { id: 'tasks', label: 'Tasks', icon: <TaskListIcon />, badge: activeTaskCount || null },
    {
      id: 'approvals',
      label: 'Approvals',
      icon: <CheckCircleIcon />,
      badge: sortedApprovals.length || null,
    },
    { id: 'activity', label: 'Activity', icon: <LinesIcon /> },
  ];
  const visibleSidebarItems = isSettingsPanel
    ? [
        {
          id: 'settings-back',
          label: 'Back',
          icon: <ArrowLeftIcon />,
          onClick: handleSettingsBack,
          className: 'sidebar__nav-item--back',
        },
        ...SETTINGS_SECTIONS.map((item) => ({
          ...item,
          onClick: () => setSettingsSection(item.id),
          isActive: settingsSection === item.id,
        })),
      ]
    : sidebarItems.map((item) => ({
        ...item,
        onClick: () => requestPanel(item.id),
        isActive: activePanel === item.id,
      }));
  const currentTitle = isSettingsPanel ? 'Settings' : PANEL_TITLES[activePanel] ?? 'Home';

  return (
    <div className={`app-shell ${isThemeSwitching ? 'is-theme-switching' : ''}`.trim()}>
      {profileMenuState ? (
        <button
          type="button"
          className="menu-overlay"
          aria-label="Close menu"
          onClick={closeProfileMenu}
        />
      ) : null}

      <aside className="sidebar">
        <button type="button" className="sidebar__logo-row" onClick={handleLogoClick}>
          <OlivanderWand />
          <div className="wordmark" aria-label="Olivander">
            <span className="wordmark__o">O</span>
            <span className="wordmark__rest">livander</span>
          </div>
        </button>

        <nav
          className={`sidebar__nav ${isSettingsPanel ? 'sidebar__nav--settings' : ''}`.trim()}
          aria-label={isSettingsPanel ? 'Settings sections' : 'Primary'}
        >
          {visibleSidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar__nav-item ${item.className ?? ''} ${
                item.isActive ? 'is-active' : ''
              }`.trim()}
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
              <button
                type="button"
                className="profile-menu__item"
                onClick={() => openSettings('connections')}
              >
                <GearIcon />
                <span>Settings</span>
              </button>
              <button
                type="button"
                className="profile-menu__item profile-menu__item--danger"
                onClick={() => void handleLogout()}
              >
                <LogoutIcon />
                <span>Log out</span>
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className="profile-trigger"
            aria-expanded={profileMenuState === 'open'}
            onClick={toggleProfileMenu}
          >
            <span className="profile-trigger__avatar">
              {businessName
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part.charAt(0).toUpperCase())
                .join('') || 'OT'}
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
                greetingName={greetingName}
                homeInput={homeInput}
                onHomeInputChange={setHomeInput}
                onHomeSubmit={(event) => {
                  event.preventDefault();
                  void submitInstruction(homeInput, 'home');
                }}
                onChipClick={setHomeInput}
                onStatClick={requestPanel}
                awaitingApprovalCount={sortedApprovals.length}
                activeTaskCount={activeTaskCount}
                resolvedThisWeekCount={resolvedThisWeekCount}
                planState={planState}
                planSteps={homePlanSteps}
                onDismissPlan={dismissHomePlan}
                onApprovePlan={() => handleApproveHomePlan(homeRunTask)}
              />
            ) : null}

            {activePanel === 'tasks' ? (
              <TasksPanel
                taskInput={taskInput}
                onTaskInputChange={setTaskInput}
                onTaskSubmit={(event) => {
                  event.preventDefault();
                  void submitInstruction(taskInput, 'tasks');
                }}
                taskFilter={taskFilter}
                onTaskFilterChange={setTaskFilter}
                showTaskComposer={showTaskComposer}
                onNewTaskClick={() => setShowTaskComposer((current) => !current)}
                visibleTasks={visibleTasks}
                removingTasks={removingTasks}
                expandedTaskId={expandedTaskId}
                onToggleTask={(taskId) =>
                  setExpandedTaskId((current) => (current === taskId ? null : taskId))
                }
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
                onGoogleToggle={() =>
                  googleConnected
                    ? void handleGoogleDisconnect()
                    : void handleGoogleConnect()
                }
                onThemeToggle={handleThemeToggle}
                theme={theme}
                profile={memoryProfile}
                isMemoryLoading={isMemoryLoading}
                memoryError={memoryError}
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  return <DashboardApp />;
}

export default App;
