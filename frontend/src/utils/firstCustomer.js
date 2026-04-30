export const PLAN_STORAGE_KEY = 'olivander_plan';
export const DEMO_MODE_STORAGE_KEY = 'olivander_demo_mode';

export const PLAN_KEYS = {
  starter: 'starter',
  plus: 'plus',
};

export const PLAN_CONFIG = {
  [PLAN_KEYS.starter]: {
    key: PLAN_KEYS.starter,
    label: 'Admin Starter',
    price: '$49-$79 / month',
    promise: 'Leads, replies, jobs, and quote follow-ups prepared for approval.',
    includes: [
      'Today dashboard',
      'Smart inbox',
      'Manual jobs',
      'Draft replies',
      'Approval queue',
      'Quote follow-up tracking',
    ],
    locked: ['Money dashboard', 'Invoice reminders', 'Calendar scheduling', 'End-of-day summary'],
  },
  [PLAN_KEYS.plus]: {
    key: PLAN_KEYS.plus,
    label: 'Admin Plus',
    price: '$129-$199 / month',
    promise: 'Daily admin queue with money, scheduling, and richer follow-up help.',
    includes: [
      'Everything in Starter',
      'Money at risk',
      'Invoice reminders',
      'Calendar-aware booking suggestions',
      'Daily planning',
      'Advanced follow-up timing',
    ],
    locked: [],
  },
};

export const JOB_STAGES = [
  { key: 'new_lead', label: 'New lead', starter: true },
  { key: 'info_needed', label: 'Info needed', starter: true },
  { key: 'quote_sent', label: 'Quote sent', starter: true },
  { key: 'waiting', label: 'Waiting', starter: true },
  { key: 'accepted', label: 'Accepted', starter: true },
  { key: 'scheduled', label: 'Scheduled', starter: true },
  { key: 'completed', label: 'Completed', starter: true },
  { key: 'invoiced', label: 'Invoiced', starter: false },
  { key: 'paid', label: 'Paid', starter: false },
  { key: 'lost', label: 'Lost', starter: true },
];

export const FIRST_CUSTOMER_SAMPLE = {
  inbox: [
    {
      id: 'msg-heat-pump',
      customer: 'Sam Taylor',
      email: 'sam.taylor@example.co.nz',
      phone: '021 555 017',
      subject: 'Heat pump service in Frankton',
      category: 'New lead',
      receivedAt: 'Today 8:12 AM',
      jobType: 'Heat pump service',
      address: 'Frankton',
      body: 'Hi, our heat pump is making a rattling noise and we want it checked before the weekend. Are you available this week?',
      interpretation: 'New service enquiry. Missing exact address and preferred time.',
      draft:
        'Hi Sam,\n\nYes, we can help. Can you send through the street address and a couple of times that suit this week? Once I have that I can confirm a slot.\n\nThanks,\nOlivander Electrical',
    },
    {
      id: 'msg-booking',
      customer: 'Mereana King',
      email: 'mereana.king@example.co.nz',
      phone: '027 444 228',
      subject: 'Can we move Thursday?',
      category: 'Booking request',
      receivedAt: 'Today 9:36 AM',
      jobType: 'Switchboard check',
      address: 'Arrowtown',
      body: 'Morning, something has come up on Thursday. Any chance we can move the switchboard check to Friday afternoon?',
      interpretation: 'Reschedule request. Plus can suggest live calendar slots; Starter stores the manual date.',
      draft:
        'Hi Mereana,\n\nNo problem. Friday afternoon should work from our side. I will confirm the exact time shortly.\n\nThanks,\nOlivander Electrical',
      plusOnlyReason: 'Calendar-aware slot checking is included in Admin Plus.',
    },
    {
      id: 'msg-payment',
      customer: 'Lakeside Motel',
      email: 'accounts@lakesidemotel.example.co.nz',
      phone: '03 555 8230',
      subject: 'Invoice question',
      category: 'Payment question',
      receivedAt: 'Yesterday 4:18 PM',
      jobType: 'Emergency lighting repair',
      address: 'Wanaka',
      body: 'Can you resend the invoice for the emergency lighting work? I cannot find it in Xero.',
      interpretation: 'Payment/admin question. Plus can link this to invoice history when Xero is connected.',
      draft:
        'Hi there,\n\nI will resend that invoice through for you. I will also check the details before sending so the right job and amount are attached.\n\nThanks,\nOlivander Electrical',
      plusOnlyReason: 'Invoice history and reminders are included in Admin Plus.',
    },
  ],
  jobs: [
    {
      id: 'job-heat-pump',
      customer: 'Sam Taylor',
      email: 'sam.taylor@example.co.nz',
      phone: '021 555 017',
      address: 'Frankton',
      jobType: 'Heat pump service',
      status: 'new_lead',
      value: 0,
      scheduledFor: '',
      nextAction: 'Get address and preferred time.',
      notes: ['New enquiry from email. Weekend deadline mentioned.'],
      timeline: ['Lead detected from email', 'Draft reply prepared'],
    },
    {
      id: 'job-jones',
      customer: 'Jones Renovations',
      email: 'karen@jonesrenovations.example.co.nz',
      phone: '027 318 192',
      address: 'Queenstown Hill',
      jobType: 'Kitchen rewiring',
      status: 'quote_sent',
      value: 4200,
      quoteSentDaysAgo: 6,
      scheduledFor: '',
      nextAction: 'Follow up quote sent 6 days ago.',
      notes: ['Customer wanted work completed before tenants move in.'],
      timeline: ['Quote sent', 'No customer response recorded'],
    },
    {
      id: 'job-switchboard',
      customer: 'Mereana King',
      email: 'mereana.king@example.co.nz',
      phone: '027 444 228',
      address: 'Arrowtown',
      jobType: 'Switchboard check',
      status: 'scheduled',
      value: 380,
      scheduledFor: 'Today 2:30 PM',
      nextAction: 'Confirm Friday afternoon reschedule.',
      notes: ['Manual booking entered during setup.'],
      timeline: ['Job scheduled', 'Customer asked to reschedule'],
    },
    {
      id: 'job-lakeside',
      customer: 'Lakeside Motel',
      email: 'accounts@lakesidemotel.example.co.nz',
      phone: '03 555 8230',
      address: 'Wanaka',
      jobType: 'Emergency lighting repair',
      status: 'invoiced',
      value: 960,
      invoice: { amount: 960, dueDaysAgo: 8, status: 'overdue' },
      scheduledFor: '',
      nextAction: 'Send first payment reminder.',
      notes: ['Invoice appears unpaid. Verify in Xero before chasing.'],
      timeline: ['Work completed', 'Invoice sent', 'Payment question received'],
    },
  ],
  actions: [
    {
      id: 'action-reply-sam',
      type: 'reply',
      title: 'Reply to Sam about the heat pump service',
      customer: 'Sam Taylor',
      email: 'sam.taylor@example.co.nz',
      sourceMessageId: 'msg-heat-pump',
      jobId: 'job-heat-pump',
      priority: 'high',
      reason: 'New lead arrived this morning and no reply is recorded.',
      detail: 'Ask for address and preferred time so the job can be booked.',
      draft:
        'Hi Sam,\n\nYes, we can help. Can you send through the street address and a couple of times that suit this week? Once I have that I can confirm a slot.\n\nThanks,\nOlivander Electrical',
    },
    {
      id: 'action-quote-jones',
      type: 'quote_follow_up',
      title: 'Follow up Jones Renovations quote',
      customer: 'Jones Renovations',
      email: 'karen@jonesrenovations.example.co.nz',
      jobId: 'job-jones',
      priority: 'medium',
      value: 4200,
      reason: 'Quote sent 6 days ago and no customer response is recorded.',
      detail: 'Short follow-up keeps the job moving without sounding pushy.',
      draft:
        'Hi Karen,\n\nJust checking in on the kitchen rewiring quote I sent through last week. Happy to answer any questions or adjust the timing if needed.\n\nThanks,\nOlivander Electrical',
    },
    {
      id: 'action-invoice-lakeside',
      type: 'invoice_reminder',
      title: 'Chase overdue invoice for Lakeside Motel',
      customer: 'Lakeside Motel',
      email: 'accounts@lakesidemotel.example.co.nz',
      jobId: 'job-lakeside',
      priority: 'high',
      plusOnly: true,
      value: 960,
      reason: 'Invoice is 8 days overdue. Xero status must be checked live before sending.',
      detail: 'Prepare a polite first reminder and hold it for approval.',
      draft:
        'Hi there,\n\nJust a quick reminder that the invoice for the emergency lighting repair is now overdue. Could you let me know when payment is expected?\n\nThanks,\nOlivander Electrical',
      lockedReason: 'Invoice chasing is included in Admin Plus.',
    },
    {
      id: 'action-calendar-gap',
      type: 'calendar_gap',
      title: 'Offer Friday booking slots to Mereana',
      customer: 'Mereana King',
      email: 'mereana.king@example.co.nz',
      jobId: 'job-switchboard',
      priority: 'medium',
      plusOnly: true,
      reason: 'Customer asked to reschedule and Friday afternoon has open time.',
      detail: 'Suggest 1:30 PM or 3:00 PM, then create a pending calendar update after confirmation.',
      draft:
        'Hi Mereana,\n\nFriday afternoon works. I can do either 1:30 PM or 3:00 PM. Which suits you best?\n\nThanks,\nOlivander Electrical',
      lockedReason: 'Calendar-aware scheduling is included in Admin Plus.',
    },
  ],
  activity: [
    { id: 'sample-act-1', type: 'draft', title: 'Detected new lead', description: 'Sam Taylor - heat pump service', createdAt: Date.now() - 1000 * 60 * 35 },
    { id: 'sample-act-2', type: 'pending', title: 'Quote follow-up prepared', description: 'Jones Renovations - quote sent 6 days ago', createdAt: Date.now() - 1000 * 60 * 80 },
    { id: 'sample-act-3', type: 'draft', title: 'Booking request detected', description: 'Mereana King asked to move Thursday', createdAt: Date.now() - 1000 * 60 * 120 },
  ],
};

export function createFirstCustomerSampleWorkspace() {
  return JSON.parse(JSON.stringify(FIRST_CUSTOMER_SAMPLE));
}

export function normalisePlanKey(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw.includes('plus')) return PLAN_KEYS.plus;
  if (raw.includes('starter')) return PLAN_KEYS.starter;
  if (raw === PLAN_KEYS.plus || raw === PLAN_KEYS.starter) return raw;
  return PLAN_KEYS.starter;
}

export function isPlusPlan(plan) {
  return normalisePlanKey(plan) === PLAN_KEYS.plus;
}

export function getStageLabel(stageKey) {
  return JOB_STAGES.find((stage) => stage.key === stageKey)?.label ?? 'New lead';
}

export function buildManualInboxMessage({ body, customer, email }) {
  const text = String(body ?? '').trim();
  const lower = text.toLowerCase();
  let category = 'Needs reply';
  let jobType = 'Customer admin';
  let interpretation = 'Customer message needs a reply.';

  if (lower.includes('quote') || lower.includes('price') || lower.includes('cost')) {
    category = 'Quote question';
    jobType = 'Quote enquiry';
    interpretation = 'Quote or pricing question. Missing exact scope unless supplied.';
  } else if (lower.includes('book') || lower.includes('available') || lower.includes('time') || lower.includes('reschedule')) {
    category = 'Booking request';
    jobType = 'Booking admin';
    interpretation = 'Booking or reschedule request. Needs confirmed time before customer-facing commitment.';
  } else if (lower.includes('invoice') || lower.includes('payment') || lower.includes('paid')) {
    category = 'Payment question';
    jobType = 'Payment admin';
    interpretation = 'Payment or invoice question. Verify invoice details before replying.';
  } else if (lower.includes('urgent') || lower.includes('asap') || lower.includes('not working')) {
    category = 'New lead';
    jobType = 'Urgent repair';
    interpretation = 'Likely new lead with urgency. Missing job details should be confirmed.';
  }

  const safeCustomer = String(customer ?? '').trim() || 'Manual customer';
  return {
    id: `manual-${Date.now()}`,
    customer: safeCustomer,
    email: String(email ?? '').trim() || 'unknown@example.co.nz',
    phone: '',
    subject: `${category} from ${safeCustomer}`,
    category,
    receivedAt: 'Just now',
    jobType,
    address: '',
    body: text,
    interpretation,
    draft:
      `Hi ${safeCustomer.split(' ')[0] || 'there'},\n\nThanks for your message. I can help with that. Can you send through any missing details and the best time to reach you?\n\nThanks,\nOlivander Electrical`,
  };
}
