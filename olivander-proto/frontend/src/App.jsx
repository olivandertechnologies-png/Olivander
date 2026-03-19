import React, { useEffect, useMemo, useRef, useState } from 'react';

const THEME_KEY = 'olivander-theme';
const SESSION_KEY = 'olivander_session';
const PROCESSED_EMAIL_IDS_KEY = 'olivander-processed-email-ids';
const NOTIFICATION_TIMEOUT_MS = 5200;
const INBOX_SYNC_INTERVAL_MS = 10000;
const BACKEND_BASE_URL = (
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'http://localhost:8000'
).replace(/\/$/, '');
const BACKEND_ORIGIN = new URL(BACKEND_BASE_URL).origin;

const ACTION_TEMPLATES = {
  'Draft an email': `Draft a warm email to [recipient] about [subject].
Mention [key points] and aim to [outcome].`,
  'Book a meeting': `Book a meeting with [person or team] about [topic].
Try for [timing] for [duration], and mention [anything important].`,
  'Chase invoice': `Follow up with [client] about invoice [number or amount], due [date].
Keep it [warm or firm] and mention [context].`,
  'Summarise inbox': `Summarise my inbox for [period], focusing on [clients, projects, or senders].
Call out [urgent items, follow-ups, or blockers].`,
  'Write a quote': `Write a quote for [client] for [service or scope].
Use a budget of [amount or range], mention [timing], and include [anything important].`,
};

const QUICK_ACTIONS = Object.keys(ACTION_TEMPLATES);

const MEMORY_FIELDS = [
  {
    key: 'business_name',
    label: 'Business name',
    placeholder: 'Olivander Technologies',
  },
  {
    key: 'business_type',
    label: 'Business type',
    placeholder: 'Executive support studio',
  },
  {
    key: 'owner_name',
    label: 'Owner or operator',
    placeholder: 'Michelle Olivander',
  },
  {
    key: 'location',
    label: 'Location',
    placeholder: 'Auckland, New Zealand',
  },
  {
    key: 'services',
    label: 'Services',
    placeholder: 'Inbox management, scheduling, client follow-ups',
    multiline: true,
  },
  {
    key: 'tone',
    label: 'Communication tone',
    placeholder: 'Warm, polished, and concise',
    multiline: true,
  },
  {
    key: 'sign_off',
    label: 'Sign-off',
    placeholder: 'Best, Olivander',
  },
];

function IconBase({ children }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="app-icon"
    >
      {children}
    </svg>
  );
}

function SparkIcon() {
  return (
    <IconBase>
      <path d="M9 2.1 10.2 5l2.9 1.2-2.9 1.2L9 10.3 7.8 7.4 4.9 6.2 7.8 5 9 2.1Z" />
      <path d="m13.2 10.7.55 1.35 1.35.55-1.35.55-.55 1.35-.55-1.35-1.35-.55 1.35-.55.55-1.35Z" />
      <path d="m4.5 10.9.38.95.95.38-.95.38-.38.95-.38-.95-.95-.38.95-.38.38-.95Z" />
    </IconBase>
  );
}

function SunIcon() {
  return (
    <IconBase>
      <circle cx="9" cy="9" r="3" />
      <path d="M9 1.7v2" />
      <path d="M9 14.3v2" />
      <path d="M16.3 9h-2" />
      <path d="M3.7 9h-2" />
      <path d="m14.15 3.85-1.4 1.4" />
      <path d="m5.25 12.75-1.4 1.4" />
      <path d="m14.15 14.15-1.4-1.4" />
      <path d="m5.25 5.25-1.4-1.4" />
    </IconBase>
  );
}

function MoonIcon() {
  return (
    <IconBase>
      <path d="M11.85 2.5a6.55 6.55 0 1 0 3.65 11.95A7.1 7.1 0 0 1 11.85 2.5Z" />
    </IconBase>
  );
}

function MailIcon() {
  return (
    <IconBase>
      <rect x="2.2" y="3.6" width="13.6" height="10.8" rx="2" />
      <path d="m3.2 5 5.1 4 1.4 1.1L15 5" />
    </IconBase>
  );
}

function CheckIcon() {
  return (
    <IconBase>
      <circle cx="9" cy="9" r="6.2" />
      <path d="m6.1 9.1 1.9 1.9 4-4.1" />
    </IconBase>
  );
}

function ClockIcon() {
  return (
    <IconBase>
      <circle cx="9" cy="9" r="6.2" />
      <path d="M9 5.3v4.1l2.7 1.7" />
    </IconBase>
  );
}

function LinkIcon() {
  return (
    <IconBase>
      <path d="M7.15 10.85 5.2 12.8a2.65 2.65 0 1 1-3.75-3.75L3.4 7.1" />
      <path d="m10.85 7.15 1.95-1.95a2.65 2.65 0 0 1 3.75 3.75L14.6 10.9" />
      <path d="M6.2 11.8 11.8 6.2" />
    </IconBase>
  );
}

function ArrowIcon() {
  return (
    <IconBase>
      <path d="M3.2 9h10.1" />
      <path d="m9.6 4.9 4.1 4.1-4.1 4.1" />
    </IconBase>
  );
}

function MessageIcon() {
  return (
    <IconBase>
      <path d="M3.2 4.2h11.6v7.4H8.7L5.1 14v-2.4H3.2Z" />
    </IconBase>
  );
}

function ActivityIcon() {
  return (
    <IconBase>
      <path d="M2.4 9h2.3l1.4-3.1 2.5 6.2 1.7-4.1h5.3" />
    </IconBase>
  );
}

function getInitialTheme() {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
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

    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.map((id) => String(id))) : new Set();
  } catch (error) {
    console.error('Could not read stored email ids.', error);
    return new Set();
  }
}

function getStoredSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = window.localStorage.getItem(SESSION_KEY);
  return value ? value.trim() || null : null;
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

function persistProcessedEmailIds(ids) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PROCESSED_EMAIL_IDS_KEY, JSON.stringify(Array.from(ids)));
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBackendUrl(path) {
  return `${BACKEND_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readResponseDetail(response, fallbackMessage) {
  try {
    const payload = await response.json();

    if (payload?.detail) {
      return String(payload.detail);
    }
  } catch (error) {
    console.error('Could not parse backend error payload.', error);
  }

  return fallbackMessage;
}

function trimToNull(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normaliseTaskTitle(value) {
  const trimmed = value.trim().replace(/\s+/g, ' ');

  if (!trimmed) {
    return 'New task';
  }

  const title = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return title.length > 48 ? `${title.slice(0, 45)}...` : title;
}

function createPlanStep(title, detail, tone = 'queued') {
  return {
    id: createId('step'),
    title,
    detail,
    tone,
  };
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
    return `${Math.floor(diff / 60_000)}m ago`;
  }

  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }

  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function formatDashboardDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatDashboardTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getGreetingForHour(hour) {
  if (hour < 12) {
    return 'Good morning';
  }

  if (hour < 18) {
    return 'Good afternoon';
  }

  return 'Good evening';
}

function getFirstName(name) {
  const firstName = trimToNull(String(name ?? ''));
  return firstName ? firstName.split(/\s+/)[0] : '';
}

function buildAgentDraftPreview(request) {
  const lowerRequest = request.toLowerCase();

  if (
    lowerRequest.includes('invoice') ||
    lowerRequest.includes('payment') ||
    lowerRequest.includes('chase')
  ) {
    return {
      label: 'Writing follow-up',
      text: `Hi [client],

Just following up on the outstanding invoice. If payment is already in motion, feel free to ignore this note. Otherwise, let me know if you need anything reissued from my side.

Best,`,
    };
  }

  if (lowerRequest.includes('quote') || lowerRequest.includes('pricing')) {
    return {
      label: 'Writing quote',
      text: `Hi [client],

Here is a draft quote based on the scope discussed. I have kept the structure clear so it is easy to review, adjust, and send.

Best,`,
    };
  }

  if (
    lowerRequest.includes('meeting') ||
    lowerRequest.includes('calendar') ||
    lowerRequest.includes('invite') ||
    lowerRequest.includes('book')
  ) {
    return {
      label: 'Writing invite note',
      text: `Hi [name],

Happy to get this booked. I am pulling together a couple of times that should work and will send the invite once the timing is confirmed.

Best,`,
    };
  }

  if (
    lowerRequest.includes('email') ||
    lowerRequest.includes('reply') ||
    lowerRequest.includes('follow up') ||
    lowerRequest.includes('follow-up')
  ) {
    return {
      label: 'Writing email',
      text: `Hi [recipient],

Thanks for your note. I am drafting a reply that covers the main points clearly and moves the conversation to the next step.

Best,`,
    };
  }

  if (
    lowerRequest.includes('summary') ||
    lowerRequest.includes('summaris') ||
    lowerRequest.includes('inbox')
  ) {
    return {
      label: 'Drafting summary',
      text: `Summary

- Key update
- Follow-up needed
- Important deadline`,
    };
  }

  return null;
}

function buildTaskFromPrompt(input) {
  const request = input.trim().replace(/\s+/g, ' ');
  const lowerRequest = request.toLowerCase();

  let steps = [
    createPlanStep(
      'Confirm the outcome',
      'Pull the key objective, delivery format, and any dates or names mentioned in the request.',
      'next',
    ),
    createPlanStep(
      'Gather the needed context',
      'Collect the information, previous threads, and business rules required to complete the task cleanly.',
    ),
    createPlanStep(
      'Draft the working output',
      'Prepare the first pass so the task can move forward without losing momentum.',
    ),
    createPlanStep(
      'Check for risk or approval points',
      'Flag anything sensitive, client-facing, or financial before the final action is taken.',
      'review',
    ),
  ];

  if (
    lowerRequest.includes('meeting') ||
    lowerRequest.includes('calendar') ||
    lowerRequest.includes('invite') ||
    lowerRequest.includes('book')
  ) {
    steps = [
      createPlanStep(
        'Identify the participants and timing constraints',
        'Pull the names, preferred windows, and any time-zone or duration requirements from the request.',
        'next',
      ),
      createPlanStep(
        'Check calendar availability',
        'Compare the likely windows and remove anything that would clash with existing commitments.',
      ),
      createPlanStep(
        'Prepare the invite details',
        'Draft the calendar title, agenda, and location or meeting link so the booking is ready to send.',
      ),
      createPlanStep(
        'Send or queue the confirmation',
        'Release the invite or hold it for approval if the wording or timing needs a final check.',
        'review',
      ),
    ];
  } else if (
    lowerRequest.includes('invoice') ||
    lowerRequest.includes('payment') ||
    lowerRequest.includes('quote') ||
    lowerRequest.includes('pricing')
  ) {
    steps = [
      createPlanStep(
        'Verify the commercial details',
        'Check the amount, dates, client context, and any adjustments or fees that could affect the response.',
        'next',
      ),
      createPlanStep(
        'Pull the supporting record',
        'Gather the invoice, quote draft, or payment history needed to back up the next action.',
      ),
      createPlanStep(
        'Draft the response or follow-up',
        'Prepare the message or document with the correct figures, tone, and due-date language.',
      ),
      createPlanStep(
        'Route any sensitive step for review',
        'Pause for approval before sending if the action changes pricing, charges a fee, or affects a client commitment.',
        'review',
      ),
    ];
  } else if (
    lowerRequest.includes('email') ||
    lowerRequest.includes('reply') ||
    lowerRequest.includes('follow up') ||
    lowerRequest.includes('follow-up')
  ) {
    steps = [
      createPlanStep(
        'Review the thread and objective',
        'Identify who the reply is for, what needs to be said, and the result the message should drive.',
        'next',
      ),
      createPlanStep(
        'Draft the message',
        'Write the email in the business tone with the key dates, asks, and next steps in place.',
      ),
      createPlanStep(
        'Check facts and phrasing',
        'Make sure names, commitments, and any sensitive wording are correct before the draft is used.',
      ),
      createPlanStep(
        'Queue for send or approval',
        'Move the draft forward immediately or hold it if the request touches a sensitive scenario.',
        'review',
      ),
    ];
  } else if (
    lowerRequest.includes('summary') ||
    lowerRequest.includes('summaris') ||
    lowerRequest.includes('inbox')
  ) {
    steps = [
      createPlanStep(
        'Collect the source material',
        'Gather the relevant messages, notes, or threads that belong in the summary.',
        'next',
      ),
      createPlanStep(
        'Group the main themes',
        'Pull out actions, blockers, deadlines, and notable context so the summary is useful, not just shorter.',
      ),
      createPlanStep(
        'Draft the summary',
        'Write a concise update with the right tone, priority order, and recommended next actions.',
      ),
      createPlanStep(
        'Flag anything that needs follow-up',
        'Surface any missing information or approval points before the summary is circulated.',
        'review',
      ),
    ];
  }

  return {
    id: createId('task'),
    name: normaliseTaskTitle(request),
    request,
    status: 'working',
    updatedAt: Date.now(),
    steps,
    draftPreview: buildAgentDraftPreview(request),
    reviewFeedback: null,
    clarifyingQuestion: null,
    questionAnswer: null,
    source: 'manual',
    sourceEmailId: null,
    sourceEmail: null,
  };
}

function normaliseAgentPlanSteps(steps, fallbackSteps = []) {
  if (!Array.isArray(steps)) {
    return fallbackSteps;
  }

  const normalisedSteps = steps
    .map((step) => {
      if (!step || typeof step !== 'object') {
        return null;
      }

      const title = trimToNull(String(step.title ?? ''));
      const detail = trimToNull(String(step.detail ?? ''));
      const tone = ['next', 'queued', 'review'].includes(step.tone) ? step.tone : 'queued';

      if (!title || !detail) {
        return null;
      }

      return createPlanStep(title, detail, tone);
    })
    .filter(Boolean);

  return normalisedSteps.length ? normalisedSteps.slice(0, 5) : fallbackSteps;
}

function normaliseAgentDraftPreview(draftPreview, fallbackDraftPreview = null) {
  if (!draftPreview || typeof draftPreview !== 'object') {
    return fallbackDraftPreview;
  }

  const label = trimToNull(String(draftPreview.label ?? ''));
  const text = trimToNull(String(draftPreview.text ?? ''));

  if (!label || !text) {
    return fallbackDraftPreview;
  }

  return {
    label,
    text,
  };
}

function buildTaskFromAgentPlan(input, agentPlan, options = {}) {
  const baseTask = options.baseTask ?? buildTaskFromPrompt(input);
  const hasDraftPreviewOverride = Object.prototype.hasOwnProperty.call(
    options,
    'draftPreview',
  );
  const normalisedDraftPreview = normaliseAgentDraftPreview(agentPlan?.draftPreview, null);

  return {
    ...baseTask,
    name: normaliseTaskTitle(
      trimToNull(agentPlan?.name) ?? trimToNull(options.name) ?? baseTask.name,
    ),
    request: options.request ?? baseTask.request,
    updatedAt: Date.now(),
    steps: normaliseAgentPlanSteps(agentPlan?.steps, baseTask.steps),
    draftPreview: hasDraftPreviewOverride
      ? options.draftPreview
      : agentPlan
        ? normalisedDraftPreview
        : normalisedDraftPreview ?? baseTask.draftPreview,
    clarifyingQuestion: trimToNull(agentPlan?.clarifyingQuestion),
    reviewFeedback: options.reviewFeedback ?? baseTask.reviewFeedback ?? null,
  };
}

function createAgentRun(task) {
  const draftPreview = task.draftPreview ?? null;

  return {
    id: createId('run'),
    taskId: task.id,
    taskName: task.name,
    status: 'Thinking',
    steps: task.steps,
    activeStepIndex: 0,
    completedStepCount: 0,
    draftLabel: draftPreview?.label ?? null,
    draftTarget: draftPreview?.text ?? '',
    draftText: '',
    isComplete: false,
  };
}

function normaliseIncomingEmail(email) {
  if (!email || typeof email !== 'object') {
    return null;
  }

  const reply = email.agentResponse ?? email.suggestedReply ?? '';

  return {
    ...email,
    id: String(email.id ?? createId('email')),
    senderName: email.senderName ?? 'Unknown Sender',
    senderEmail: email.senderEmail ?? 'unknown@example.com',
    subject: email.subject ?? 'Untitled Email',
    body: email.body ?? '',
    agentResponse: reply,
    requiresApproval: email.requiresApproval ?? Boolean(reply),
    approvalDelayMs: email.approvalDelayMs ?? 1600,
    approvalTier: email.approvalTier ?? 'Reply review',
    approvalWhy:
      email.approvalWhy ??
      'A draft reply is ready and should be reviewed before it is sent.',
    status: email.status ?? 'new',
  };
}

function buildTaskFromEmail(email) {
  const task = buildTaskFromPrompt(`Reply to ${email.senderName} about ${email.subject}`);
  const replyPreview = email.agentResponse ?? email.suggestedReply ?? '';

  return {
    ...task,
    name: normaliseTaskTitle(`Reply to ${email.senderName}: ${email.subject}`),
    request: `From: ${email.senderName} <${email.senderEmail}>\nSubject: ${email.subject}\n\n${email.body}`,
    updatedAt: Date.now(),
    source: 'email',
    sourceEmailId: email.id,
    sourceEmail: {
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      subject: email.subject,
      body: email.body,
    },
    draftPreview: replyPreview
      ? {
          label: 'Writing email',
          text: replyPreview,
        }
      : null,
  };
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
    tier: email.approvalTier ?? 'Reply review',
    why:
      email.approvalWhy ??
      'This reply changes a customer-facing commitment and should be reviewed before sending.',
    sourceEmail: {
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      subject: email.subject,
      body: email.body,
    },
    agentResponse: email.agentResponse ?? email.suggestedReply ?? '',
  };
}

function getPlanStepState(task, activeRun, index) {
  if (activeRun?.taskId === task.id) {
    if (activeRun.isComplete || index < activeRun.completedStepCount) {
      return 'done';
    }

    if (index === activeRun.activeStepIndex) {
      return 'active';
    }

    return 'pending';
  }

  if (task.status === 'done') {
    return 'done';
  }

  return 'pending';
}

function getTaskStatusMeta(status) {
  if (status === 'done') {
    return { label: 'Done', tone: 'success' };
  }

  if (status === 'waiting') {
    return { label: 'Waiting', tone: 'warning' };
  }

  return { label: 'Working', tone: 'accent' };
}

function getActivityTone(type) {
  if (type === 'resolved') {
    return 'success';
  }

  if (type === 'draft') {
    return 'accent';
  }

  return 'warning';
}

function createEmptyMemoryDraft() {
  return MEMORY_FIELDS.reduce((draft, field) => {
    draft[field.key] = '';
    return draft;
  }, {});
}

function mapProfileToDraft(profile) {
  return MEMORY_FIELDS.reduce((draft, field) => {
    draft[field.key] = profile?.[field.key] ?? '';
    return draft;
  }, {});
}

function hasMemoryContent(profile) {
  return MEMORY_FIELDS.some((field) => String(profile?.[field.key] ?? '').trim());
}

function ToastStack({ notifications, onDismiss }) {
  if (!notifications.length) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite">
      {notifications.map((notification) => (
        <article
          key={notification.id}
          className={`toast toast--${notification.tone}`}
        >
          <div className="toast__copy">
            <div className="toast__title">{notification.title}</div>
            <div className="toast__description">{notification.description}</div>
          </div>
          <button
            type="button"
            className="toast__dismiss"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(notification.id)}
          >
            ×
          </button>
        </article>
      ))}
    </div>
  );
}

function MetricCard({ label, value, detail, tone, delay }) {
  return (
    <article className="dashboard-card metric-card" style={{ '--delay': delay }}>
      <div className="section-eyebrow">{label}</div>
      <div className={`metric-card__value is-${tone}`}>{value}</div>
      <div className="metric-card__detail">{detail}</div>
    </article>
  );
}

function TaskCard({
  task,
  activeRun,
  linkedApproval,
  isExpanded,
  onToggle,
  onTaskQuestion,
  onCancel,
}) {
  const status = getTaskStatusMeta(task.status);
  const steps = task.steps ?? [];
  const runForTask = activeRun?.taskId === task.id ? activeRun : null;
  const draftPreview = linkedApproval ? null : task.draftPreview;
  const previewText = runForTask
    ? runForTask.draftText || runForTask.draftTarget || draftPreview?.text || ''
    : draftPreview?.text || '';
  const previewLabel = runForTask?.draftLabel || draftPreview?.label || null;
  const isPreviewLive = Boolean(runForTask?.draftTarget && !runForTask.isComplete);
  const canCancel = task.status === 'working' || task.status === 'waiting';

  return (
    <article className={`task-card ${isExpanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        className="task-card__toggle"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <div className="task-card__main">
          <span className={`status-dot is-${status.tone}`} aria-hidden="true" />
          <div>
            <div className="task-card__name">{task.name}</div>
            <div className="task-card__meta-line">
              <span>{formatRelativeTime(task.updatedAt)}</span>
              {task.source === 'email' ? <span>From inbox</span> : <span>Manual request</span>}
            </div>
          </div>
        </div>
        <div className="task-card__top-actions">
          {linkedApproval ? <span className="mini-pill">Needs review</span> : null}
          <span className={`status-pill is-${status.tone}`}>{status.label}</span>
        </div>
      </button>

      {isExpanded ? (
        <div className="task-card__body">
          {steps.length ? (
            <div className="task-card__section">
              <div className="section-eyebrow">Plan</div>
              <div className="step-list">
                {steps.map((step, index) => {
                  const stepState = getPlanStepState(task, runForTask, index);

                  return (
                    <div key={step.id} className={`step-list__item is-${stepState}`}>
                      <span className={`step-list__marker is-${stepState}`} aria-hidden="true" />
                      <div>
                        <div className="step-list__title">{step.title}</div>
                        <div className="step-list__detail">{step.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {previewLabel ? (
            <div className="task-card__section">
              <div className="section-eyebrow">{previewLabel}</div>
              <pre className="code-panel">
                {previewText}
                {isPreviewLive ? <span className="typing-cursor" aria-hidden="true" /> : null}
              </pre>
            </div>
          ) : null}

          {task.sourceEmail ? (
            <div className="task-card__section">
              <div className="section-eyebrow">Original email</div>
              <div className="message-card">
                <div className="message-card__sender">{task.sourceEmail.senderName}</div>
                <div className="message-card__meta">{task.sourceEmail.senderEmail}</div>
                <div className="message-card__subject">{task.sourceEmail.subject}</div>
                <pre className="message-card__body">{task.sourceEmail.body}</pre>
              </div>
            </div>
          ) : null}

          {task.clarifyingQuestion ? (
            <div className="task-card__section">
              <div className="section-eyebrow">Question</div>
              <div className="question-card">
                <div className="question-card__copy">{task.clarifyingQuestion}</div>
                <div className="question-card__actions">
                  <button
                    type="button"
                    className={`secondary-button ${task.questionAnswer === 'yes' ? 'is-selected' : ''}`}
                    onClick={() => onTaskQuestion(task.id, 'yes')}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`secondary-button ${task.questionAnswer === 'no' ? 'is-selected' : ''}`}
                    onClick={() => onTaskQuestion(task.id, 'no')}
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {task.reviewFeedback ? (
            <div className="task-card__section">
              <div className="section-eyebrow">Review feedback</div>
              <div className="info-chip">{task.reviewFeedback}</div>
            </div>
          ) : null}

          <div className="task-card__footer">
            {canCancel ? (
              <button
                type="button"
                className="danger-button"
                onClick={() => onCancel(task.id)}
              >
                Cancel task
              </button>
            ) : (
              <div className="task-card__complete">Completed and kept in today’s record.</div>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ApprovalCard({ approval, onApprovalAction }) {
  const [isEditing, setIsEditing] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setIsEditing(false);
    setFeedback('');
  }, [approval.id]);

  return (
    <article className="approval-card">
      <div className="approval-card__header">
        <div>
          <div className="section-eyebrow">{approval.tier}</div>
          <h3 className="approval-card__title">{approval.subject}</h3>
          <div className="approval-card__meta">
            {approval.senderName} · {approval.senderEmail} · {formatRelativeTime(approval.createdAt)}
          </div>
        </div>
        <span className="mini-pill">Review</span>
      </div>

      {approval.why ? <p className="approval-card__why">{approval.why}</p> : null}

      <div className="approval-card__grid">
        <section className="message-card">
          <div className="section-eyebrow">Original email</div>
          <div className="message-card__sender">{approval.sourceEmail.senderName}</div>
          <div className="message-card__meta">{approval.sourceEmail.senderEmail}</div>
          <div className="message-card__subject">{approval.sourceEmail.subject}</div>
          <pre className="message-card__body">{approval.sourceEmail.body}</pre>
        </section>

        <section className="message-card message-card--reply">
          <div className="section-eyebrow">Draft reply</div>
          <pre className="message-card__body">{approval.agentResponse}</pre>
        </section>
      </div>

      {isEditing ? (
        <div className="approval-card__edit">
          <label className="field">
            <span className="field__label">Feedback for revision</span>
            <textarea
              className="field__input field__input--textarea"
              rows="4"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Add the changes you want made to this drafted response."
            />
          </label>
          <div className="approval-card__actions">
            <button type="button" className="secondary-button" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!feedback.trim()}
              onClick={() => void onApprovalAction(approval.id, 'edit', { feedback })}
            >
              Send back for edit
            </button>
          </div>
        </div>
      ) : (
        <div className="approval-card__actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void onApprovalAction(approval.id, 'approve')}
          >
            Approve
          </button>
          <button type="button" className="secondary-button" onClick={() => setIsEditing(true)}>
            Request changes
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void onApprovalAction(approval.id, 'reject')}
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}

function MemoryCard({
  profile,
  draft,
  isLoading,
  isEditing,
  isSaving,
  message,
  onStartEdit,
  onCancelEdit,
  onFieldChange,
  onSubmit,
}) {
  const isConfigured = hasMemoryContent(profile);
  const visibleRows = MEMORY_FIELDS.filter((field) => String(profile?.[field.key] ?? '').trim());

  return (
    <article className="dashboard-card section-card" id="memory" style={{ '--delay': '340ms' }}>
      <div className="section-header">
        <div>
          <div className="section-eyebrow">Memory</div>
          <h2 className="section-title">Business context</h2>
        </div>
        {isConfigured && !isEditing ? (
          <button type="button" className="secondary-button" onClick={onStartEdit}>
            Edit
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="empty-state">Loading saved context...</div>
      ) : null}

      {!isLoading && (isEditing || !isConfigured) ? (
        <form className="memory-form" onSubmit={onSubmit}>
          <div className="memory-form__grid">
            {MEMORY_FIELDS.map((field) => (
              <label
                key={field.key}
                className={`field ${field.multiline ? 'field--full' : ''}`}
              >
                <span className="field__label">{field.label}</span>
                {field.multiline ? (
                  <textarea
                    className="field__input field__input--textarea"
                    rows="3"
                    value={draft[field.key]}
                    onChange={(event) => onFieldChange(field.key, event.target.value)}
                    placeholder={field.placeholder}
                  />
                ) : (
                  <input
                    className="field__input"
                    type="text"
                    value={draft[field.key]}
                    onChange={(event) => onFieldChange(field.key, event.target.value)}
                    placeholder={field.placeholder}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="memory-form__actions">
            {isConfigured ? (
              <button
                type="button"
                className="secondary-button"
                disabled={isSaving}
                onClick={onCancelEdit}
              >
                Cancel
              </button>
            ) : null}
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save memory'}
            </button>
          </div>
        </form>
      ) : null}

      {!isLoading && !isEditing && isConfigured ? (
        <div className="memory-summary">
          {visibleRows.map((row) => (
            <div key={row.key} className="memory-summary__item">
              <div className="memory-summary__label">{row.label}</div>
              <div className="memory-summary__value">{profile[row.key]}</div>
            </div>
          ))}
        </div>
      ) : null}

      {!isLoading && !isEditing && !isConfigured ? (
        <div className="empty-state">
          Add business details so the dashboard can draft with the right context.
        </div>
      ) : null}

      {message ? <div className="inline-message">{message}</div> : null}
    </article>
  );
}

function App() {
  const notificationTimersRef = useRef({});
  const taskPlanningTimersRef = useRef([]);
  const pendingApprovalTimersRef = useRef({});
  const googleOauthPollRef = useRef(null);
  const processedEmailIdsRef = useRef(getStoredProcessedEmailIds());
  const tasksRef = useRef([]);
  const homeRunRef = useRef(null);
  const composerRef = useRef(null);

  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [theme, setTheme] = useState(getInitialTheme);
  const [sessionToken, setSessionToken] = useState(getStoredSession);
  const [composerText, setComposerText] = useState('');
  const [isTaskPlanning, setIsTaskPlanning] = useState(false);
  const [homeRun, setHomeRun] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskFilter, setTaskFilter] = useState('all');
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [approvals, setApprovals] = useState([]);
  const [activity, setActivity] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [isGoogleBusy, setIsGoogleBusy] = useState(false);
  const [recentEmails, setRecentEmails] = useState([]);
  const [isRecentEmailsLoading, setIsRecentEmailsLoading] = useState(false);
  const [recentEmailsMessage, setRecentEmailsMessage] = useState(
    getStoredSession() ? '' : 'Connect Google to load real inbox activity.',
  );
  const [memoryProfile, setMemoryProfile] = useState({});
  const [memoryDraft, setMemoryDraft] = useState(createEmptyMemoryDraft);
  const [isMemoryLoading, setIsMemoryLoading] = useState(true);
  const [isMemoryEditing, setIsMemoryEditing] = useState(false);
  const [isMemorySaving, setIsMemorySaving] = useState(false);
  const [memoryMessage, setMemoryMessage] = useState('');

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    homeRunRef.current = homeRun;
  }, [homeRun]);

  useEffect(() => {
    if (!tasks.length) {
      setExpandedTaskId(null);
      return;
    }

    if (expandedTaskId && tasks.some((task) => task.id === expandedTaskId)) {
      return;
    }

    setExpandedTaskId(tasks[0].id);
  }, [expandedTaskId, tasks]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
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
    const textarea = composerRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(136, Math.min(textarea.scrollHeight, 260))}px`;
  }, [composerText]);

  useEffect(
    () => () => {
      taskPlanningTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      Object.values(notificationTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      Object.values(pendingApprovalTimersRef.current).forEach((timer) => window.clearTimeout(timer));

      if (googleOauthPollRef.current) {
        window.clearInterval(googleOauthPollRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMemory() {
      if (!sessionToken) {
        setMemoryProfile({});
        setMemoryDraft(createEmptyMemoryDraft());
        setMemoryMessage('Connect Google to unlock saved memory.');
        setIsMemoryLoading(false);
        return;
      }

      try {
        const response = await fetchProtected('/api/memory');

        if (response.status === 401) {
          clearGoogleSession({ notify: true });
          return;
        }

        if (!response.ok) {
          throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
        }

        const data = await response.json();

        if (cancelled) {
          return;
        }

        setMemoryProfile(data ?? {});
        setMemoryDraft(mapProfileToDraft(data ?? {}));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMemoryProfile({});
        setMemoryDraft(createEmptyMemoryDraft());
        setMemoryMessage('Could not load saved memory. You can still set it up now.');
      } finally {
        if (!cancelled) {
          setIsMemoryLoading(false);
        }
      }
    }

    loadMemory();

    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  function clearTaskPlanningTimers() {
    taskPlanningTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    taskPlanningTimersRef.current = [];
  }

  function clearPendingApproval(taskId) {
    const timer = pendingApprovalTimersRef.current[taskId];

    if (timer) {
      window.clearTimeout(timer);
      delete pendingApprovalTimersRef.current[taskId];
    }
  }

  function dismissNotification(notificationId) {
    const timer = notificationTimersRef.current[notificationId];

    if (timer) {
      window.clearTimeout(timer);
      delete notificationTimersRef.current[notificationId];
    }

    setNotifications((current) =>
      current.filter((notification) => notification.id !== notificationId),
    );
  }

  function pushNotification({ title, description, tone = 'accent' }) {
    const notificationId = createId('notification');

    setNotifications((current) =>
      [
        {
          id: notificationId,
          title,
          description,
          tone,
        },
        ...current,
      ].slice(0, 4),
    );

    notificationTimersRef.current[notificationId] = window.setTimeout(() => {
      dismissNotification(notificationId);
    }, NOTIFICATION_TIMEOUT_MS);
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

  function clearGoogleSession(options = {}) {
    const {
      message = 'Connect Google to load real inbox activity.',
      notify = false,
      notificationTitle = 'Google session expired',
      notificationDescription = 'Reconnect Google Workspace to keep syncing Gmail.',
    } = options;

    persistSession(null);
    setSessionToken(null);
    setIsGoogleConnected(false);
    setIsGoogleBusy(false);
    setRecentEmails([]);
    setRecentEmailsMessage(message);
    processedEmailIdsRef.current = new Set();
    persistProcessedEmailIds(processedEmailIdsRef.current);

    if (notify) {
      pushNotification({
        title: notificationTitle,
        description: notificationDescription,
        tone: 'warning',
      });
    }
  }

  function buildAuthHeaders(headers = {}) {
    const nextHeaders = new Headers(headers);

    if (sessionToken) {
      nextHeaders.set('Authorization', `Bearer ${sessionToken}`);
    }

    return nextHeaders;
  }

  async function fetchProtected(path, options = {}) {
    return fetch(buildBackendUrl(path), {
      ...options,
      credentials: 'include',
      headers: buildAuthHeaders(options.headers),
    });
  }

  async function fetchAgentPlan(request, options = {}) {
    if (!sessionToken) {
      throw new Error('Connect Google before planning tasks.');
    }

    const response = await fetchProtected('/api/agent/plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request,
        source_email: options.sourceEmail ?? null,
        review_feedback: options.reviewFeedback ?? null,
      }),
    });

    if (!response.ok) {
      throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
    }

    return response.json();
  }

  async function createTaskWithAgentPlan(request, options = {}) {
    const fallbackTask = options.baseTask ?? buildTaskFromPrompt(request);

    try {
      const agentPlan = await fetchAgentPlan(request, options);
      return buildTaskFromAgentPlan(request, agentPlan, {
        ...options,
        baseTask: fallbackTask,
      });
    } catch (error) {
      console.error('Could not build agent plan.', error);

      if (options.allowFallback) {
        return buildTaskFromAgentPlan(request, null, {
          ...options,
          baseTask: fallbackTask,
        });
      }

      throw error;
    }
  }

  function runTaskSequence(task) {
    const preview = createAgentRun(task);
    const draftChunkSize = 1;
    const draftCharDelayMs = 22;
    const stepDelayMs = 520;
    const draftStartDelayMs = 760;
    const draftSteps = preview.draftTarget
      ? Math.ceil(preview.draftTarget.length / draftChunkSize)
      : 0;
    const draftDurationMs = draftSteps * draftCharDelayMs;
    const finalDelayMs = Math.max(
      preview.steps.length * stepDelayMs + 540,
      draftStartDelayMs + draftDurationMs + 320,
    );

    clearTaskPlanningTimers();
    setHomeRun(preview);

    preview.steps.forEach((step, index) => {
      const timer = window.setTimeout(() => {
        setHomeRun((current) => {
          if (!current || current.taskId !== task.id) {
            return current;
          }

          return {
            ...current,
            completedStepCount: Math.max(current.completedStepCount, index + 1),
            activeStepIndex: Math.min(index + 1, current.steps.length - 1),
            status:
              current.draftTarget && index >= 1
                ? current.draftLabel ?? 'Working'
                : 'Thinking',
          };
        });
      }, (index + 1) * stepDelayMs);

      taskPlanningTimersRef.current.push(timer);
    });

    if (preview.draftTarget) {
      for (
        let offset = draftChunkSize, tick = 0;
        offset <= preview.draftTarget.length + draftChunkSize;
        offset += draftChunkSize, tick += 1
      ) {
        const timer = window.setTimeout(() => {
          setHomeRun((current) => {
            if (!current || current.taskId !== task.id) {
              return current;
            }

            return {
              ...current,
              status: current.draftLabel ?? 'Writing',
              draftText: current.draftTarget.slice(
                0,
                Math.min(offset, current.draftTarget.length),
              ),
            };
          });
        }, draftStartDelayMs + tick * draftCharDelayMs);

        taskPlanningTimersRef.current.push(timer);
      }
    }

    const completionTimer = window.setTimeout(() => {
      setHomeRun((current) => {
        if (!current || current.taskId !== task.id) {
          return current;
        }

        return {
          ...current,
          status: 'Ready',
          completedStepCount: current.steps.length,
          activeStepIndex: current.steps.length - 1,
          draftText: current.draftTarget || current.draftText,
          isComplete: true,
        };
      });

      setIsTaskPlanning(false);
      addActivityItem('pending', 'Task planned', 'Added to the dashboard queue.');
      pushNotification({
        title: 'Task added',
        description: task.name,
        tone: 'success',
      });
    }, finalDelayMs);

    taskPlanningTimersRef.current.push(completionTimer);
  }

  async function syncGoogleConnectionStatus({ announce = false, silent = false } = {}) {
    if (!sessionToken) {
      setIsGoogleConnected(false);
      setIsGoogleBusy(false);
      return false;
    }

    try {
      const response = await fetchProtected('/api/connections');

      if (response.status === 401) {
        clearGoogleSession({ notify: true });
        return false;
      }

      if (!response.ok) {
        throw new Error(`Failed with status ${response.status}`);
      }

      const data = await response.json();
      const nextStatus = Boolean(data.google);

      setIsGoogleConnected((current) => {
        if (announce && current !== nextStatus) {
          addActivityItem(
            nextStatus ? 'resolved' : 'pending',
            `Google Workspace ${nextStatus ? 'connected' : 'disconnected'}`,
            nextStatus ? 'Gmail and Calendar are available.' : 'Google access was removed.',
          );

          pushNotification({
            title: `Google Workspace ${nextStatus ? 'connected' : 'disconnected'}`,
            description: nextStatus
              ? 'Gmail and Calendar are available.'
              : 'Google access was removed.',
            tone: nextStatus ? 'success' : 'warning',
          });
        }

        return nextStatus;
      });

      setIsGoogleBusy(false);
      return nextStatus;
    } catch (error) {
      setIsGoogleBusy(false);

      if (!silent) {
        pushNotification({
          title: 'Google connection unavailable',
          description: 'Could not reach the OAuth service.',
          tone: 'danger',
        });
      }

      return null;
    }
  }

  useEffect(() => {
    function handleOauthMessage(event) {
      if (event.origin !== BACKEND_ORIGIN) {
        return;
      }

      const data = event.data ?? {};

      if (data.source === 'olivander-google-oauth' && data.provider === 'google') {
        if (googleOauthPollRef.current) {
          window.clearInterval(googleOauthPollRef.current);
          googleOauthPollRef.current = null;
        }

        const nextSession = String(data.session ?? '').trim();

        if (nextSession) {
          persistSession(nextSession);
          setSessionToken(nextSession);
          setRecentEmailsMessage('');
        }

        setIsGoogleConnected(true);
        setIsGoogleBusy(false);
        addActivityItem('resolved', 'Google Workspace connected', 'Session stored for Gmail sync.');
        pushNotification({
          title: 'Google Workspace connected',
          description: 'Session saved and ready to sync Gmail.',
          tone: 'success',
        });
      }
    }

    window.addEventListener('message', handleOauthMessage);
    void syncGoogleConnectionStatus({ silent: true });

    return () => {
      window.removeEventListener('message', handleOauthMessage);
    };
  }, [sessionToken]);

  function watchGoogleOauthPopup(popupWindow) {
    if (googleOauthPollRef.current) {
      window.clearInterval(googleOauthPollRef.current);
    }

    googleOauthPollRef.current = window.setInterval(() => {
      if (!popupWindow || popupWindow.closed) {
        window.clearInterval(googleOauthPollRef.current);
        googleOauthPollRef.current = null;
        void syncGoogleConnectionStatus({ announce: true, silent: true });
      }
    }, 700);
  }

  async function handleGoogleConnect() {
    if (isGoogleConnected || isGoogleBusy) {
      return;
    }

    setIsGoogleBusy(true);

    try {
      const response = await fetch(buildBackendUrl('/auth/google'), {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed with status ${response.status}`);
      }

      const data = await response.json();
      const popupWindow = window.open(
        data.url,
        'olivander-google-oauth',
        'popup=yes,width=560,height=720',
      );

      if (!popupWindow) {
        throw new Error('Popup blocked');
      }

      popupWindow.focus();
      watchGoogleOauthPopup(popupWindow);
    } catch (error) {
      setIsGoogleBusy(false);
      pushNotification({
        title: 'Google sign-in failed',
        description:
          error instanceof Error && error.message === 'Popup blocked'
            ? 'Allow pop-ups for this site and try again.'
            : 'Could not start the Google OAuth flow.',
        tone: 'danger',
      });
    }
  }

  async function handleGoogleDisconnect() {
    if (!isGoogleConnected || isGoogleBusy || !sessionToken) {
      return;
    }

    setIsGoogleBusy(true);

    try {
      const response = await fetchProtected('/api/connections/google/disconnect', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
      }

      clearGoogleSession({
        message: 'Connect Google to load real inbox activity.',
      });
      addActivityItem('pending', 'Google Workspace disconnected', 'Stored session was cleared.');
      pushNotification({
        title: 'Google disconnected',
        description: 'Reconnect Google Workspace to resume Gmail sync.',
        tone: 'warning',
      });
    } catch (error) {
      setIsGoogleBusy(false);
      pushNotification({
        title: 'Google disconnect failed',
        description: 'Could not disconnect Google Workspace right now.',
        tone: 'danger',
      });
    }
  }

  function scheduleApprovalForEmail(email, taskId) {
    if (!email.requiresApproval) {
      return;
    }

    clearPendingApproval(taskId);

    pendingApprovalTimersRef.current[taskId] = window.setTimeout(() => {
      delete pendingApprovalTimersRef.current[taskId];

      let shouldCreateApproval = false;

      setTasks((current) =>
        current.map((item) => {
          if (item.id !== taskId) {
            return item;
          }

          if (item.status === 'done') {
            return item;
          }

          shouldCreateApproval = true;
          return {
            ...item,
            status: 'waiting',
            updatedAt: Date.now(),
          };
        }),
      );

      if (!shouldCreateApproval) {
        return;
      }

      const approval = buildApprovalFromEmail(email, taskId);

      setApprovals((current) => {
        if (current.some((item) => item.taskId === taskId)) {
          return current;
        }

        return [approval, ...current];
      });

      addActivityItem('pending', 'Approval queued', `Reply to ${email.senderName} is ready for review.`);
      pushNotification({
        title: 'Approval needed',
        description: `${email.senderName} is ready for review.`,
        tone: 'warning',
      });
    }, email.approvalDelayMs ?? 2200);
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

    const fallbackTask = buildTaskFromEmail(normalisedEmail);
    const createdTask = await createTaskWithAgentPlan(
      `Reply to ${normalisedEmail.senderName} about ${normalisedEmail.subject}`,
      {
        baseTask: fallbackTask,
        request: fallbackTask.request,
        sourceEmail: {
          senderName: normalisedEmail.senderName,
          senderEmail: normalisedEmail.senderEmail,
          subject: normalisedEmail.subject,
          body: normalisedEmail.body,
        },
        draftPreview: fallbackTask.draftPreview,
        allowFallback: true,
      },
    );

    setTasks((current) => [createdTask, ...current]);
    addActivityItem('draft', 'Inbox email triaged', `Task created from ${normalisedEmail.senderName}.`);
    pushNotification({
      title: `New email from ${normalisedEmail.senderName}`,
      description: normalisedEmail.subject,
      tone: 'accent',
    });
    scheduleApprovalForEmail(normalisedEmail, createdTask.id);
  }

  function reconcileInboxSnapshot(inboxEmails) {
    if (!Array.isArray(inboxEmails)) {
      return;
    }

    const activeEmails = inboxEmails
      .map((email) => normaliseIncomingEmail(email))
      .filter(Boolean)
      .filter((email) => email.status !== 'actioned');
    const activeEmailIds = new Set(activeEmails.map((email) => email.id));

    processedEmailIdsRef.current.forEach((emailId) => {
      if (!activeEmailIds.has(emailId)) {
        processedEmailIdsRef.current.delete(emailId);
      }
    });
    persistProcessedEmailIds(processedEmailIdsRef.current);

    const removedEmailTasks = tasksRef.current.filter(
      (task) => task.sourceEmailId && !activeEmailIds.has(task.sourceEmailId),
    );

    if (removedEmailTasks.length) {
      const removedTaskIds = new Set(removedEmailTasks.map((task) => task.id));

      removedEmailTasks.forEach((task) => {
        clearPendingApproval(task.id);
      });

      setTasks((current) => current.filter((task) => !removedTaskIds.has(task.id)));
      setApprovals((current) => current.filter((approval) => !removedTaskIds.has(approval.taskId)));

      if (homeRunRef.current && removedTaskIds.has(homeRunRef.current.taskId)) {
        clearTaskPlanningTimers();
        setIsTaskPlanning(false);
        setHomeRun(null);
      }
    }

    activeEmails.forEach((activeEmail) => {
      void handleIncomingEmail(activeEmail);
    });
  }

  useEffect(() => {
    if (!sessionToken) {
      return undefined;
    }

    let cancelled = false;
    let isSyncing = false;

    async function syncInbox() {
      if (cancelled || isSyncing) {
        return;
      }

      isSyncing = true;

      try {
        const response = await fetchProtected('/api/emails');

        if (response.status === 401) {
          clearGoogleSession({ notify: true });
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed with status ${response.status}`);
        }

        const inboxEmails = await response.json();

        if (!cancelled) {
          reconcileInboxSnapshot(inboxEmails);
        }
      } catch (error) {
        console.error('Could not hydrate inbox emails.', error);
      } finally {
        isSyncing = false;
      }
    }

    function handleVisibilityChange() {
      if (!document.hidden) {
        void syncInbox();
      }
    }

    void syncInbox();

    const intervalId = window.setInterval(syncInbox, INBOX_SYNC_INTERVAL_MS);
    window.addEventListener('focus', syncInbox);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncInbox);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      setRecentEmails([]);
      setIsRecentEmailsLoading(false);
      return undefined;
    }

    let cancelled = false;

    async function loadRecentEmails() {
      setIsRecentEmailsLoading(true);

      try {
        const response = await fetchProtected('/gmail/recent');

        if (response.status === 401) {
          clearGoogleSession({ notify: true });
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed with status ${response.status}`);
        }

        const payload = await response.json();

        if (cancelled) {
          return;
        }

        setRecentEmails(Array.isArray(payload) ? payload : []);
        setRecentEmailsMessage('');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRecentEmails([]);
        setRecentEmailsMessage('Could not load recent Gmail activity right now.');
      } finally {
        if (!cancelled) {
          setIsRecentEmailsLoading(false);
        }
      }
    }

    void loadRecentEmails();

    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  async function handleTaskPromptSubmit(input) {
    const value = input.trim();

    if (!value || isTaskPlanning) {
      return false;
    }

    setIsTaskPlanning(true);

    try {
      const task = await createTaskWithAgentPlan(value);
      setTasks((current) => [task, ...current]);
      runTaskSequence(task);
    } catch (error) {
      clearTaskPlanningTimers();
      setHomeRun(null);
      setIsTaskPlanning(false);
      pushNotification({
        title: 'Planning failed',
        description:
          error instanceof Error ? error.message : 'The task could not be planned right now.',
        tone: 'danger',
      });
      return false;
    }

    return true;
  }

  async function submitComposer() {
    const didSubmit = await handleTaskPromptSubmit(composerText);

    if (didSubmit) {
      setComposerText('');
    }
  }

  function focusComposerWithText(value) {
    setComposerText(value);

    window.requestAnimationFrame(() => {
      const textarea = composerRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      const placeholderStart = value.indexOf('[');
      const placeholderEnd = value.indexOf(']');

      if (placeholderStart !== -1 && placeholderEnd > placeholderStart) {
        textarea.setSelectionRange(placeholderStart + 1, placeholderEnd);
        return;
      }

      textarea.setSelectionRange(value.length, value.length);
    });
  }

  function handleQuickAction(action) {
    focusComposerWithText(ACTION_TEMPLATES[action] ?? action);
  }

  function handleTaskQuestion(taskId, answer) {
    setTasks((current) =>
      current.map((item) =>
        item.id === taskId
          ? {
              ...item,
              updatedAt: Date.now(),
              questionAnswer: answer,
            }
          : item,
      ),
    );

    addActivityItem(
      'draft',
      'Clarification recorded',
      answer === 'yes' ? 'Positive clarification captured.' : 'Negative clarification captured.',
    );
  }

  function handleCancelTask(taskId) {
    const task = tasksRef.current.find((item) => item.id === taskId);

    if (!task || task.status === 'done') {
      return;
    }

    clearPendingApproval(taskId);
    setTasks((current) => current.filter((item) => item.id !== taskId));
    setApprovals((current) => current.filter((item) => item.taskId !== taskId));
    addActivityItem('pending', 'Task cancelled', task.name);
    pushNotification({
      title: 'Task cancelled',
      description: task.name,
      tone: 'danger',
    });
  }

  async function handleApprovalAction(approvalId, action, options = {}) {
    const approval = approvals.find((item) => item.id === approvalId);
    const feedback = String(options.feedback ?? '').trim();

    if (!approval) {
      return false;
    }

    if (action === 'approve') {
      clearPendingApproval(approval.taskId);
      setApprovals((current) => current.filter((item) => item.id !== approvalId));
      setTasks((current) =>
        current.map((item) =>
          item.id === approval.taskId
            ? {
                ...item,
                status: 'done',
                updatedAt: Date.now(),
                reviewFeedback: null,
              }
            : item,
        ),
      );
      setResolvedCount((current) => current + 1);
      addActivityItem('resolved', 'Approval sent', `${approval.senderName} was approved.`);
      pushNotification({
        title: 'Approval sent',
        description: approval.senderName,
        tone: 'success',
      });
      return true;
    }

    if (action === 'edit') {
      if (!feedback) {
        return false;
      }

      const revisionPrompt = `Revise response for ${approval.senderName}`;
      const linkedTask = tasksRef.current.find((item) => item.id === approval.taskId);
      const fallbackRequest =
        linkedTask?.request ??
        `From: ${approval.sourceEmail.senderName} <${approval.sourceEmail.senderEmail}>\nSubject: ${approval.sourceEmail.subject}\n\n${approval.sourceEmail.body}`;
      const fallbackTask = {
        ...(linkedTask ?? buildTaskFromPrompt(revisionPrompt)),
        name: normaliseTaskTitle(revisionPrompt),
        request: fallbackRequest,
        status: 'working',
        updatedAt: Date.now(),
        reviewFeedback: feedback,
        draftPreview: approval.agentResponse
          ? {
              label: 'Revising email',
              text: approval.agentResponse,
            }
          : linkedTask?.draftPreview ?? null,
        source: approval.sourceEmail ? 'email' : linkedTask?.source ?? 'manual',
        sourceEmailId: approval.sourceEmailId ?? linkedTask?.sourceEmailId ?? null,
        sourceEmail: approval.sourceEmail ?? linkedTask?.sourceEmail ?? null,
      };

      setTasks((current) => {
        if (linkedTask) {
          return current.map((item) => (item.id === linkedTask.id ? fallbackTask : item));
        }

        return [fallbackTask, ...current];
      });

      clearPendingApproval(approval.taskId);
      setApprovals((current) => current.filter((item) => item.id !== approvalId));
      setExpandedTaskId(fallbackTask.id);
      addActivityItem('draft', 'Approval sent back for edit', feedback);
      pushNotification({
        title: 'Returned for edits',
        description: approval.senderName,
        tone: 'accent',
      });

      try {
        const plannedTask = await createTaskWithAgentPlan(revisionPrompt, {
          baseTask: fallbackTask,
          request: fallbackRequest,
          sourceEmail: approval.sourceEmail ?? null,
          reviewFeedback: feedback,
          draftPreview: fallbackTask.draftPreview,
        });

        setTasks((current) =>
          current.map((item) => (item.id === fallbackTask.id ? plannedTask : item)),
        );
      } catch (error) {
        console.error('Could not rebuild revision task.', error);
        pushNotification({
          title: 'Revision planning failed',
          description:
            error instanceof Error
              ? error.message
              : 'The revised draft could not be generated right now.',
          tone: 'danger',
        });
      }

      return true;
    }

    clearPendingApproval(approval.taskId);
    setApprovals((current) => current.filter((item) => item.id !== approvalId));
    setTasks((current) =>
      current.map((item) =>
        item.id === approval.taskId
          ? {
              ...item,
              status: 'waiting',
              updatedAt: Date.now(),
              reviewFeedback: null,
            }
          : item,
      ),
    );
    addActivityItem('pending', 'Approval rejected', approval.senderName);
    pushNotification({
      title: 'Approval rejected',
      description: approval.senderName,
      tone: 'danger',
    });

    return true;
  }

  function jumpToSection(id) {
    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  function handleMemoryFieldChange(key, value) {
    setMemoryDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleMemoryStartEdit() {
    setMemoryDraft(mapProfileToDraft(memoryProfile));
    setMemoryMessage('');
    setIsMemoryEditing(true);
  }

  function handleMemoryCancelEdit() {
    setMemoryDraft(mapProfileToDraft(memoryProfile));
    setMemoryMessage('');
    setIsMemoryEditing(false);
  }

  async function handleMemorySubmit(event) {
    event.preventDefault();
    setIsMemorySaving(true);
    setMemoryMessage('');

    try {
      await Promise.all(
        MEMORY_FIELDS.map((field) =>
          fetchProtected('/api/memory', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key: field.key,
              value: memoryDraft[field.key].trim(),
            }),
          }).then((response) => {
            if (response.status === 401) {
              clearGoogleSession({ notify: true });
              throw new Error('Session expired');
            }

            if (!response.ok) {
              throw new Error(`Failed with status ${response.status}`);
            }
          }),
        ),
      );

      const nextProfile = MEMORY_FIELDS.reduce((result, field) => {
        const value = memoryDraft[field.key].trim();

        if (value) {
          result[field.key] = value;
        }

        return result;
      }, {});

      setMemoryProfile(nextProfile);
      setMemoryDraft(mapProfileToDraft(nextProfile));
      setIsMemoryEditing(false);
      setMemoryMessage('Memory saved. New drafts will use this context.');
      addActivityItem('resolved', 'Memory updated', 'Business context was saved.');
      pushNotification({
        title: 'Memory saved',
        description: 'Business context is updated.',
        tone: 'success',
      });
    } catch (error) {
      setMemoryMessage('Could not save memory right now. Please try again.');
    } finally {
      setIsMemorySaving(false);
    }
  }

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks],
  );
  const visibleTasks = useMemo(() => {
    if (taskFilter === 'all') {
      return sortedTasks;
    }

    if (taskFilter === 'active') {
      return sortedTasks.filter((task) => task.status === 'working');
    }

    return sortedTasks.filter((task) => task.status === taskFilter);
  }, [sortedTasks, taskFilter]);
  const sortedApprovals = useMemo(
    () => [...approvals].sort((a, b) => b.createdAt - a.createdAt),
    [approvals],
  );
  const activeTaskCount = tasks.filter((task) => task.status !== 'done').length;
  const doneTaskCount = tasks.filter((task) => task.status === 'done').length;
  const businessName = trimToNull(memoryProfile.business_name) ?? 'Olivander';
  const firstName = getFirstName(memoryProfile.owner_name);
  const approvalsByTaskId = useMemo(
    () => new Map(sortedApprovals.map((approval) => [approval.taskId, approval])),
    [sortedApprovals],
  );

  return (
    <>
      <ToastStack notifications={notifications} onDismiss={dismissNotification} />

      <div className="dashboard-shell">
        <div className="dashboard-aurora dashboard-aurora--one" />
        <div className="dashboard-aurora dashboard-aurora--two" />

        <main className="dashboard">
          <header className="dashboard-header" style={{ '--delay': '0ms' }}>
            <div className="brand-lockup">
              <div className="brand-mark">
                <SparkIcon />
              </div>
              <div>
                <div className="section-eyebrow">Dashboard</div>
                <h1 className="brand-title">{businessName}</h1>
              </div>
            </div>

            <div className="dashboard-header__actions">
              <nav className="top-nav" aria-label="Dashboard sections">
                {[
                  ['command', 'Command'],
                  ['queue', 'Queue'],
                  ['approvals', 'Approvals'],
                  ['memory', 'Memory'],
                  ['activity', 'Activity'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="top-nav__button"
                    onClick={() => jumpToSection(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <button
                type="button"
                className="icon-button"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          </header>

          <section className="hero-layout">
            <article
              className="dashboard-card hero-card"
              id="command"
              style={{ '--delay': '80ms' }}
            >
              <div className="hero-card__meta">
                <span>{formatDashboardDate(currentTime)}</span>
                <span>{formatDashboardTime(currentTime)}</span>
              </div>
              <h2 className="hero-card__title">
                {getGreetingForHour(currentTime.getHours())}
                {firstName ? `, ${firstName}` : ''}.
              </h2>
              <p className="hero-card__copy">
                Queue work, review drafts, and keep the operating context tight from one surface.
              </p>

              <div className="quick-action-row">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="quick-action-chip"
                    disabled={isTaskPlanning}
                    onClick={() => handleQuickAction(action)}
                  >
                    {action}
                  </button>
                ))}
              </div>

              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitComposer();
                }}
              >
                <label className="visually-hidden" htmlFor="dashboard-composer">
                  What should Olivander do next?
                </label>
                <textarea
                  id="dashboard-composer"
                  ref={composerRef}
                  className="composer__input"
                  rows="4"
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void submitComposer();
                    }
                  }}
                  placeholder="What needs doing?"
                />
                <div className="composer__footer">
                  <div className="composer__hint">
                    Press Enter to queue. Shift+Enter adds a line break.
                  </div>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!composerText.trim() || isTaskPlanning}
                  >
                    {isTaskPlanning ? 'Planning...' : 'Queue task'}
                    <ArrowIcon />
                  </button>
                </div>
              </form>
            </article>

            <div className="hero-aside">
              <div className="metric-grid">
                <MetricCard
                  label="Approvals"
                  value={sortedApprovals.length}
                  detail={`${sortedApprovals.length} waiting`}
                  tone="accent"
                  delay="120ms"
                />
                <MetricCard
                  label="Active tasks"
                  value={activeTaskCount}
                  detail={`${tasks.filter((task) => task.status === 'working').length} working`}
                  tone="ink"
                  delay="160ms"
                />
                <MetricCard
                  label="Resolved"
                  value={resolvedCount}
                  detail={`${doneTaskCount} done in queue`}
                  tone="success"
                  delay="200ms"
                />
              </div>

              <article className="dashboard-card connection-card" style={{ '--delay': '240ms' }}>
                <div className="section-header">
                  <div>
                    <div className="section-eyebrow">Connections</div>
                    <h2 className="section-title">Google Workspace</h2>
                  </div>
                  <span className={`status-pill is-${isGoogleConnected ? 'success' : 'warning'}`}>
                    {isGoogleConnected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
                <p className="section-copy">
                  Gmail tokens are now stored through the backend session pipeline, and the dashboard reads live inbox activity from Google after connect.
                </p>
                <div className="connection-card__footer">
                  <div className="connection-card__status">
                    <LinkIcon />
                    <span>
                      {isGoogleConnected
                        ? 'Session is active and ready for Gmail reads'
                        : 'Connect Google to enable Gmail access'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={isGoogleConnected ? 'secondary-button' : 'primary-button'}
                    disabled={isGoogleBusy}
                    onClick={isGoogleConnected ? handleGoogleDisconnect : handleGoogleConnect}
                  >
                    {isGoogleBusy
                      ? isGoogleConnected
                        ? 'Disconnecting...'
                        : 'Connecting...'
                      : isGoogleConnected
                        ? 'Disconnect'
                        : 'Connect Google'}
                  </button>
                </div>
              </article>
            </div>
          </section>

          {homeRun ? (
            <section className="run-section">
              <article className="dashboard-card run-card" style={{ '--delay': '280ms' }}>
                <div className="section-header">
                  <div>
                    <div className="section-eyebrow">Current run</div>
                    <h2 className="section-title">{homeRun.taskName}</h2>
                  </div>
                  <span className={`status-pill is-${homeRun.isComplete ? 'success' : 'accent'}`}>
                    {homeRun.status}
                  </span>
                </div>

                <div className={`run-card__grid ${homeRun.draftLabel ? 'has-draft' : ''}`}>
                  <div className="step-list">
                    {homeRun.steps.map((step, index) => {
                      const stepState = getPlanStepState(
                        { id: homeRun.taskId, status: homeRun.isComplete ? 'done' : 'working' },
                        homeRun,
                        index,
                      );

                      return (
                        <div key={step.id} className={`step-list__item is-${stepState}`}>
                          <span className={`step-list__marker is-${stepState}`} aria-hidden="true" />
                          <div>
                            <div className="step-list__title">{step.title}</div>
                            <div className="step-list__detail">{step.detail}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {homeRun.draftLabel ? (
                    <div>
                      <div className="section-eyebrow">{homeRun.draftLabel}</div>
                      <pre className="code-panel">
                        {homeRun.draftText || homeRun.draftTarget}
                        {!homeRun.isComplete && homeRun.draftTarget ? (
                          <span className="typing-cursor" aria-hidden="true" />
                        ) : null}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </article>
            </section>
          ) : null}

          <section className="content-grid">
            <div className="content-main">
              <article className="dashboard-card section-card" id="queue" style={{ '--delay': '300ms' }}>
                <div className="section-header">
                  <div>
                    <div className="section-eyebrow">Queue</div>
                    <h2 className="section-title">Tasks</h2>
                  </div>
                  <div className="filter-row">
                    {[
                      ['all', 'All'],
                      ['active', 'Working'],
                      ['waiting', 'Waiting'],
                      ['done', 'Done'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`filter-chip ${taskFilter === id ? 'is-active' : ''}`}
                        onClick={() => setTaskFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {visibleTasks.length ? (
                  <div className="task-list">
                    {visibleTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        activeRun={homeRun}
                        linkedApproval={approvalsByTaskId.get(task.id) ?? null}
                        isExpanded={expandedTaskId === task.id}
                        onToggle={() =>
                          setExpandedTaskId((current) => (current === task.id ? null : task.id))
                        }
                        onTaskQuestion={handleTaskQuestion}
                        onCancel={handleCancelTask}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No tasks in this view yet.</div>
                )}
              </article>

              <article
                className="dashboard-card section-card"
                id="approvals"
                style={{ '--delay': '320ms' }}
              >
                <div className="section-header">
                  <div>
                    <div className="section-eyebrow">Approvals</div>
                    <h2 className="section-title">Needs review</h2>
                  </div>
                  <div className="approval-count">
                    {sortedApprovals.length === 1
                      ? '1 draft waiting'
                      : `${sortedApprovals.length} drafts waiting`}
                  </div>
                </div>

                {sortedApprovals.length ? (
                  <div className="approval-list">
                    {sortedApprovals.map((approval) => (
                      <ApprovalCard
                        key={approval.id}
                        approval={approval}
                        onApprovalAction={handleApprovalAction}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No pending approvals right now.</div>
                )}
              </article>
            </div>

            <div className="content-side">
              <MemoryCard
                profile={memoryProfile}
                draft={memoryDraft}
                isLoading={isMemoryLoading}
                isEditing={isMemoryEditing}
                isSaving={isMemorySaving}
                message={memoryMessage}
                onStartEdit={handleMemoryStartEdit}
                onCancelEdit={handleMemoryCancelEdit}
                onFieldChange={handleMemoryFieldChange}
                onSubmit={handleMemorySubmit}
              />

              <article
                className="dashboard-card section-card"
                id="activity"
                style={{ '--delay': '360ms' }}
              >
                <div className="section-header">
                  <div>
                    <div className="section-eyebrow">Recent Activity</div>
                    <h2 className="section-title">Inbox activity</h2>
                  </div>
                  <ActivityIcon />
                </div>

                {isRecentEmailsLoading ? (
                  <div className="empty-state">Loading recent Gmail activity...</div>
                ) : recentEmails.length ? (
                  <div className="activity-list">
                    {recentEmails.slice(0, 8).map((email) => (
                      <div key={email.id} className="activity-list__item">
                        <div className="activity-marker is-accent">
                          <MailIcon />
                        </div>
                        <div className="activity-list__copy">
                          <div className="activity-list__row">
                            <div className="activity-list__title">{email.subject || 'Untitled Email'}</div>
                            <div className="activity-list__time">
                              {email.date ? String(email.date) : 'Recent'}
                            </div>
                          </div>
                          <div className="activity-list__description">
                            <strong>{email.senderName || email.from_name || 'Unknown Sender'}</strong>
                            {' · '}
                            {email.snippet || email.body || 'No preview available.'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    {recentEmailsMessage || 'No recent Gmail activity was returned.'}
                  </div>
                )}
              </article>

              <article className="dashboard-card section-card pulse-card" style={{ '--delay': '380ms' }}>
                <div className="section-header">
                  <div>
                    <div className="section-eyebrow">Inbox pulse</div>
                    <h2 className="section-title">Live intake</h2>
                  </div>
                  <MessageIcon />
                </div>
                <p className="section-copy">
                  The queue polls the backend every 10 seconds with the stored `business_id`, and expired Google sessions are cleared automatically.
                </p>
                <div className="pulse-card__row">
                  <div className="pulse-dot" />
                  <span>{sessionToken ? 'Watching for new work' : 'Awaiting Google connection'}</span>
                </div>
              </article>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

export default App;
