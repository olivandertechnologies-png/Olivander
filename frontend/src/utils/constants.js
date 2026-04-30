export const THEME_KEY = 'olivander_theme';
export const SESSION_KEY = 'olivander_session';
export const PROCESSED_EMAIL_IDS_KEY = 'olivander_processed_email_ids';

export const PANEL_TITLES = {
  home: 'Today',
  inbox: 'Inbox',
  jobs: 'Jobs',
  tasks: 'Tasks',
  approvals: 'Approval Centre',
  activity: 'Activity',
  settings: 'Settings',
};

export const DEFAULT_BUSINESS_NAME = 'Olivander';
export const TASK_FILTERS = ['all', 'working', 'waiting', 'done'];
export const ACTIVITY_FILTERS = ['all', 'approved', 'auto', 'rejected'];

export const HOME_CHIPS = [
  'Draft an email',
  'Book a meeting',
  'Chase invoice',
  'Summarise inbox',
  'Write a quote',
];

export const HOME_HEADLINES = {
  morning: [
    { withName: (name) => `Good morning, ${name}.`, withoutName: 'Good morning.' },
    { withName: (name) => `A clear start, ${name}.`, withoutName: 'A clear start.' },
    { withName: (name) => `Let's make today lighter, ${name}.`, withoutName: "Let's make today lighter." },
  ],
  afternoon: [
    { withName: (name) => `Keep things moving, ${name}.`, withoutName: 'Keep things moving.' },
    { withName: (name) => `The day is still yours, ${name}.`, withoutName: 'The day is still yours.' },
    { withName: (name) => `Let's clear the deck, ${name}.`, withoutName: "Let's clear the deck." },
  ],
  evening: [
    { withName: (name) => `Let's close the loop, ${name}.`, withoutName: "Let's close the loop." },
    { withName: (name) => `A calm finish, ${name}.`, withoutName: 'A calm finish.' },
    { withName: (name) => `One last sweep, ${name}.`, withoutName: 'One last sweep.' },
  ],
};

export const MEMORY_KEYS = {
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
  blockedSenderPatterns: 'blocked_sender_patterns',
  activeCategories: 'active_categories',
  plan: 'plan',
};

export const BUSINESS_PROFILE_ROWS = [
  { key: 'business_type', label: 'Business type' },
  { key: 'pricing_range', label: 'Pricing range' },
  { key: 'payment_terms', label: 'Payment terms' },
  { key: 'gst_registered', label: 'GST registered' },
];

export const PREFERENCE_ROWS = [
  { key: 'reply_tone', label: 'Reply tone' },
  { key: 'reschedule_policy', label: 'Reschedule policy' },
  { key: 'no_show_handling', label: 'No-show handling' },
];

export const CATEGORY_OPTIONS = [
  { value: 'booking_request', label: 'Booking requests' },
  { value: 'invoice_query', label: 'Invoice queries' },
  { value: 'complaint', label: 'Complaints' },
  { value: 'general_inquiry', label: 'General inquiries' },
  { value: 'new_lead', label: 'New leads' },
];

export const SETTINGS_SECTIONS_CONFIG = [
  { id: 'connections', label: 'Connections' },
  { id: 'plan', label: 'Plan' },
  { id: 'memory', label: 'Memory' },
  { id: 'filters', label: 'Filters' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy', label: 'Privacy' },
];

export const DEFAULT_POPUP_CLOSE_MS = 120;
export const PANEL_EXIT_MS = 100;
export const PANEL_ENTER_MS = 150;
export const THEME_SWITCH_MS = 320;
export const APPROVAL_REMOVE_MS = 200;
export const PROCESSING_PULSE_MS = 1200;
export const PLAN_MOCK_DELAY_MS = 1200;
export const INBOX_SYNC_INTERVAL_MS = 10000;
export const RECENT_EMAILS_MAX = 12;
export const USE_MOCK_AGENT_PLAN = false;

export const MOCK_PLAN = [
  { description: 'Classify the request and identify intent', tier: 1 },
  { description: 'Draft a reply based on business context', tier: 3 },
  { description: 'Queue for your approval before sending', tier: 3 },
];
