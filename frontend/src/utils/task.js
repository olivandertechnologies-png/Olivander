import { DEFAULT_BUSINESS_NAME, MOCK_PLAN } from './constants.js';
import { trimToNull, decodeHtmlEntities } from './format.js';

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normaliseTaskTitle(value) {
  const trimmed = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'New task';
  const title = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return title.length > 46 ? `${title.slice(0, 43)}...` : title;
}

export function buildTaskDescription(request, sourceEmail = null) {
  if (sourceEmail) return sourceEmail.body || sourceEmail.subject || 'Drafting a response from the inbox.';
  return String(request ?? '').trim().replace(/\s+/g, ' ');
}

export function normaliseTaskCopy(value) {
  return String(value ?? '').toLowerCase().replace(/\.\.\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isDuplicateTaskDescription(description, title) {
  const normalisedDescription = normaliseTaskCopy(description);
  const normalisedTitle = normaliseTaskCopy(title);
  if (!normalisedDescription || !normalisedTitle) return false;
  return (
    normalisedDescription === normalisedTitle ||
    normalisedDescription.startsWith(normalisedTitle) ||
    normalisedTitle.startsWith(normalisedDescription)
  );
}

export function isPlaceholderDraftContent(value) {
  const draftContent = trimToNull(String(value ?? ''));
  return Boolean(draftContent && draftContent.includes('[') && draftContent.includes(']'));
}

export function buildClarifyingQuestion(request) {
  const lower = request.toLowerCase();
  if (lower.includes('meeting') || lower.includes('book')) {
    return 'Should I prioritise the earliest available slot if everyone is free?';
  }
  if (lower.includes('invoice') || lower.includes('quote')) {
    return 'Do you want me to keep the wording firm rather than warm?';
  }
  return null;
}

export function createPlanStep(title, detail, tone = 'queued') {
  return {
    title: String(title ?? '').trim(),
    detail: String(detail ?? '').trim(),
    tone: ['next', 'queued', 'review'].includes(tone) ? tone : 'queued',
  };
}

export function tierToTone(tier) {
  if (tier === 1) return 'next';
  if (tier === 3) return 'review';
  return 'queued';
}

export function toneToTier(tone) {
  if (tone === 'next') return 1;
  if (tone === 'review') return 3;
  return 2;
}

export function getDisplayPlanSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => {
    if (!step || typeof step !== 'object') return null;
    const description = trimToNull(String(step.description ?? step.detail ?? step.title ?? '')) ?? null;
    if (!description) return null;
    const tierValue = Number(step.tier);
    const tier = Number.isFinite(tierValue) ? tierValue : toneToTier(step.tone);
    return { description, tier: tier === 1 || tier === 2 || tier === 3 ? tier : 2 };
  }).filter(Boolean);
}

export function requestNeedsDraftPreview(request, sourceEmail = null) {
  const lower = String(request ?? '').toLowerCase();
  return Boolean(sourceEmail) || [
    'email', 'reply', 'follow up', 'follow-up', 'summary', 'summaris', 'quote', 'proposal',
    'invoice', 'meeting note',
  ].some((keyword) => lower.includes(keyword));
}

export function buildTaskPlanSteps(request, sourceEmail = null) {
  const lower = String(request ?? '').toLowerCase();

  if (lower.includes('meeting') || lower.includes('calendar') || lower.includes('book')) {
    return [
      createPlanStep('Confirm the brief', 'Pull the people, timing, and constraints from the request.', 'next'),
      createPlanStep('Check availability', 'Review the likely windows and remove obvious conflicts.'),
      createPlanStep('Prepare the details', 'Draft the invite, agenda, and any note that needs to go with it.'),
      createPlanStep('Queue the release', 'Send it forward or pause if the wording needs a final check.', 'review'),
    ];
  }

  if (lower.includes('invoice') || lower.includes('payment') || lower.includes('quote') || lower.includes('pricing')) {
    return [
      createPlanStep('Verify the numbers', 'Check the figures, dates, and any commercial context.', 'next'),
      createPlanStep('Pull the record', 'Gather the invoice, quote, or payment history behind the request.'),
      createPlanStep('Draft the response', 'Write the follow-up with the right tone and specifics.'),
      createPlanStep('Hold for release', 'Pause if it changes pricing, payment timing, or a client commitment.', 'review'),
    ];
  }

  if (sourceEmail || lower.includes('email') || lower.includes('reply') || lower.includes('follow up') || lower.includes('follow-up')) {
    return [
      createPlanStep('Review the context', 'Work out what needs to be said and the outcome the message should drive.', 'next'),
      createPlanStep('Shape the response', 'Write the reply with the key details in the right tone.'),
      createPlanStep('Check the details', 'Confirm names, commitments, and phrasing before it goes out.'),
      createPlanStep('Queue the next action', 'Send it on or hold it if it needs approval first.', 'review'),
    ];
  }

  if (lower.includes('summary') || lower.includes('summaris') || lower.includes('inbox')) {
    return [
      createPlanStep('Collect the source material', 'Gather the threads, notes, and context that belong in the summary.', 'next'),
      createPlanStep('Group the key points', 'Pull out actions, blockers, deadlines, and anything important.'),
      createPlanStep('Draft the summary', 'Write the update in a clear order with the next actions visible.'),
      createPlanStep('Flag follow-up', 'Surface anything that still needs input or approval.', 'review'),
    ];
  }

  return [
    createPlanStep('Confirm the outcome', 'Pull the objective, format, and any dates or names from the request.', 'next'),
    createPlanStep('Gather the context', 'Collect the information and business details needed to complete it.'),
    createPlanStep('Prepare the work', 'Draft the next output so the task can move forward cleanly.'),
    createPlanStep('Check for release points', 'Flag anything sensitive, financial, or client-facing before it goes out.', 'review'),
  ];
}

export function buildTaskDraftPreview(request, sourceEmail = null) {
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
        `Best,\n${DEFAULT_BUSINESS_NAME}`,
    };
  }

  if (lower.includes('summary') || lower.includes('summaris') || lower.includes('inbox')) {
    return {
      label: 'Draft summary',
      text: 'Summary\n\n- Priority update\n- Follow-up needed\n- Important deadline',
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

  if (lower.includes('meeting') || lower.includes('calendar') || lower.includes('book')) {
    return {
      label: 'Draft note',
      text:
        `Hi ${recipient},\n\n` +
        'I have pulled together a couple of options for the meeting and will confirm the best slot next.\n\n' +
        `Best,\n${DEFAULT_BUSINESS_NAME}`,
    };
  }

  return requestNeedsDraftPreview(request, sourceEmail)
    ? { label: 'Draft', text: 'Working draft\n\nThis is being prepared now.' }
    : null;
}

export function normalisePlanSteps(steps, fallbackSteps = []) {
  if (!Array.isArray(steps)) return fallbackSteps;
  const safeSteps = steps.map((step, index) => {
    if (!step || typeof step !== 'object') return null;
    const detail = trimToNull(String(step.detail ?? step.description ?? '')) ?? trimToNull(String(step.title ?? ''));
    const title = trimToNull(String(step.title ?? '')) ?? trimToNull(String(step.description ?? '')) ?? `Step ${index + 1}`;
    const tone = trimToNull(String(step.tone ?? '')) ?? tierToTone(Number.isFinite(Number(step.tier)) ? Number(step.tier) : 2);
    if (!title || !detail) return null;
    return createPlanStep(title, detail, tone);
  }).filter(Boolean);
  return safeSteps.length ? safeSteps.slice(0, 5) : fallbackSteps;
}

export function normaliseDraftPreview(draftPreview, fallbackPreview = null) {
  if (!draftPreview || typeof draftPreview !== 'object') return fallbackPreview;
  const label = trimToNull(String(draftPreview.label ?? ''));
  const text = trimToNull(String(draftPreview.text ?? ''));
  if (!label || !text) return fallbackPreview;
  return { label, text };
}

export function buildTaskFromRequest(request, overrides = {}) {
  const sourceEmail = overrides.sourceEmail ?? null;
  const planSteps = overrides.planSteps ?? buildTaskPlanSteps(request, sourceEmail);
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
    clarifyingQuestion: overrides.clarifyingQuestion ?? buildClarifyingQuestion(request),
    questionAnswer: overrides.questionAnswer ?? null,
    notes: overrides.notes ?? [],
    planSteps,
    draftPreview,
    draftContent,
    planSummary: overrides.planSummary ?? null,
    planRequestState: overrides.planRequestState ?? (planSteps.length || draftContent ? 'ready' : 'loading'),
  };
}

export function normaliseAgentPlan(task, agentPlan) {
  if (!agentPlan || typeof agentPlan !== 'object') return task;
  const draftPreview = normaliseDraftPreview(agentPlan.draftPreview, task.draftPreview ?? null);
  return {
    ...task,
    name: normaliseTaskTitle(trimToNull(agentPlan.name) ?? task.name),
    planSteps: normalisePlanSteps(agentPlan.steps, task.planSteps ?? []),
    draftPreview,
    draftContent: draftPreview?.text ?? task.draftContent ?? null,
    planSummary: trimToNull(String(agentPlan.planSummary ?? '')) ?? task.planSummary,
    clarifyingQuestion: trimToNull(agentPlan.clarifyingQuestion) ?? task.clarifyingQuestion,
    planRequestState: 'ready',
  };
}

export function normaliseIncomingEmail(email) {
  if (!email || typeof email !== 'object') return null;
  const agentResponse = trimToNull(String(email.agentResponse ?? email.suggestedReply ?? '')) ?? '';
  const rawBody = trimToNull(String(email.body ?? email.snippet ?? '')) ?? '';
  const rawFullBody = trimToNull(String(email.full_body ?? email.fullBody ?? rawBody)) ?? rawBody;
  const rawSubject = trimToNull(String(email.subject ?? '')) ?? 'Untitled message';

  return {
    id: String(email.id ?? createId('email')),
    senderName: trimToNull(String(email.senderName ?? email.from_name ?? '')) ?? 'Unknown sender',
    senderEmail: trimToNull(String(email.senderEmail ?? email.from ?? '')) ?? 'unknown@example.com',
    subject: decodeHtmlEntities(rawSubject),
    body: decodeHtmlEntities(rawBody),
    fullBody: decodeHtmlEntities(rawFullBody),
    date: email.date ?? null,
    agentResponse,
    requiresApproval: email.requiresApproval ?? Boolean(agentResponse),
    approvalTier: trimToNull(String(email.approvalTier ?? '')) ?? 'Tier 3',
    approvalWhy:
      trimToNull(String(email.approvalWhy ?? '')) ??
      'This message changes a customer-facing action and should be reviewed before it goes out.',
    approvalDelayMs: typeof email.approvalDelayMs === 'number' ? email.approvalDelayMs : 1500,
    status: trimToNull(String(email.status ?? '')) ?? 'new',
  };
}

export function buildTaskFromEmail(email) {
  return buildTaskFromRequest(`Reply to ${email.senderName} about ${email.subject}`, {
    name: normaliseTaskTitle(`Reply to ${email.senderName}: ${email.subject}`),
    description: buildTaskDescription('', { subject: email.subject, body: email.body }),
    source: 'email',
    sourceEmailId: email.id,
    sourceEmail: {
      id: email.id,
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      subject: email.subject,
      body: email.body,
      fullBody: email.fullBody ?? email.body ?? '',
    },
  });
}

export function normaliseBackendApproval(row) {
  return {
    id: String(row.id ?? createId('approval')),
    backendId: String(row.id ?? ''),
    type: row.type ?? 'email_reply',
    taskId: null,
    sourceEmailId: row.sourceEmailId ?? null,
    senderName: row.senderName ?? 'Unknown sender',
    senderEmail: row.senderEmail ?? 'unknown@example.com',
    subject: row.subject ?? 'Untitled',
    createdAt: row.createdAt ?? Date.now(),
    tier: row.tier ?? 'Tier 3',
    why: row.why ?? '',
    agentResponse: row.agentResponse ?? '',
    status: row.status ?? 'review',
    sourceEmail: null,
  };
}

export function buildApprovalFromEmail(email, taskId) {
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
      fullBody: email.fullBody ?? email.body ?? '',
    },
  };
}

export function buildApprovalFromTask(task) {
  const sourceEmail = task.sourceEmail ?? {};
  const draftContent = trimToNull(task.draftContent ?? task.draftPreview?.text ?? '') ?? '';
  return {
    id: createId('approval'),
    taskId: task.id,
    sourceEmailId: task.sourceEmailId ?? null,
    senderName: sourceEmail.senderName ?? 'Unknown sender',
    senderEmail: sourceEmail.senderEmail ?? 'unknown@example.com',
    subject: sourceEmail.subject ?? task.name,
    createdAt: Date.now(),
    tier: 'Tier 3',
    why: 'This message changes a customer-facing action and should be reviewed before it goes out.',
    agentResponse: draftContent,
    status: 'review',
    sourceEmail: {
      senderName: sourceEmail.senderName ?? 'Unknown sender',
      senderEmail: sourceEmail.senderEmail ?? 'unknown@example.com',
      subject: sourceEmail.subject ?? task.name,
      body: sourceEmail.body ?? '',
      fullBody: sourceEmail.fullBody ?? sourceEmail.body ?? '',
    },
  };
}

export function createMockDraftPreview(request, sourceEmail = null) {
  const fallbackText =
    'Hi [name], thanks for reaching out. Happy to help with that — I will get back to you shortly with more detail.\n\nBest,\nOlivander Test Account';
  const draftPreview = buildTaskDraftPreview(request, sourceEmail);
  if (!draftPreview) return { label: 'Draft', text: fallbackText };
  return { label: draftPreview.label, text: trimToNull(draftPreview.text) ?? fallbackText };
}

export function createMockAgentPlan(request, sourceEmail = null) {
  return {
    steps: MOCK_PLAN,
    draftPreview: requestNeedsDraftPreview(request, sourceEmail)
      ? createMockDraftPreview(request, sourceEmail)
      : null,
    clarifyingQuestion: buildClarifyingQuestion(request),
  };
}
