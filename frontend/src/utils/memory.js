import { MEMORY_KEYS, DEFAULT_BUSINESS_NAME } from './constants.js';
import { trimToNull } from './format.js';

export function createEmptyMemoryProfile() {
  return {
    [MEMORY_KEYS.businessName]: DEFAULT_BUSINESS_NAME,
    [MEMORY_KEYS.ownerEmail]: '',
    [MEMORY_KEYS.businessType]: '',
    [MEMORY_KEYS.pricingRange]: '',
    [MEMORY_KEYS.paymentTerms]: '',
    [MEMORY_KEYS.gstRegistered]: '',
    [MEMORY_KEYS.replyTone]: '',
    [MEMORY_KEYS.replyToneEdits]: '0',
    [MEMORY_KEYS.reschedulePolicy]: '',
    [MEMORY_KEYS.noShowHandling]: '',
    [MEMORY_KEYS.blockedSenderPatterns]: 'noreply,no-reply,do-not-reply,notifications@,mailer-daemon,newsletter,unsubscribe',
    [MEMORY_KEYS.activeCategories]: 'booking_request,invoice_query,complaint,general_inquiry,new_lead',
  };
}

export function normaliseMemoryProfile(payload) {
  const base = createEmptyMemoryProfile();

  if (!payload || typeof payload !== 'object') return base;

  Object.keys(base).forEach((key) => {
    if (trimToNull(String(payload[key] ?? '')) !== null) {
      base[key] = String(payload[key]).trim();
    }
  });

  if (!trimToNull(base[MEMORY_KEYS.replyTone]) && trimToNull(String(payload.tone ?? ''))) {
    base[MEMORY_KEYS.replyTone] = String(payload.tone).trim();
  }

  if (trimToNull(String(payload.blocked_sender_patterns ?? ''))) {
    base[MEMORY_KEYS.blockedSenderPatterns] = String(payload.blocked_sender_patterns).trim();
  }

  if (trimToNull(String(payload.active_categories ?? ''))) {
    base[MEMORY_KEYS.activeCategories] = String(payload.active_categories).trim();
  }

  return base;
}

export function hasMemoryData(profile) {
  if (!profile || typeof profile !== 'object') return false;
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
