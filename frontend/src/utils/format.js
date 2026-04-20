export function trimToNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function decodeHtmlEntities(value) {
  if (typeof value !== 'string' || !value) return value || '';
  if (typeof document === 'undefined') return value;
  const el = document.createElement('textarea');
  el.innerHTML = value;
  return el.value;
}

export function formatRelativeTime(value) {
  if (!value) return 'Just now';
  const diff = Date.now() - value;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} mins ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hrs ago`;
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function formatActivityTimestamp(value) {
  if (!value) return 'Just now';
  return new Date(value).toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDisplayName(value) {
  const cleanValue = trimToNull(String(value ?? ''));
  if (!cleanValue) return '';
  const source = cleanValue.includes('@') ? cleanValue.split('@')[0] : cleanValue;
  const firstSegment = source.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ')[0];
  if (!firstSegment) return '';
  return firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1);
}

export function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function getActivityAppearance(type) {
  if (type === 'approved' || type === 'auto' || type === 'resolved') return { tone: 'success', icon: 'check' };
  if (type === 'rejected') return { tone: 'danger', icon: 'reject' };
  if (type === 'draft') return { tone: 'accent', icon: 'mail' };
  return { tone: 'accent', icon: 'clock' };
}

export function filterActivityItems(items, filter) {
  if (filter === 'all') return items;
  return items.filter((item) => item.type === filter);
}

export function formatTaskAnswer(answer) {
  if (!answer) return '';
  if (answer === 'yes' || answer === 'no') return answer.charAt(0).toUpperCase() + answer.slice(1);
  return answer;
}

export function isBinaryTaskAnswer(answer) {
  const normalised = trimToNull(String(answer ?? ''))?.toLowerCase();
  return normalised === 'yes' || normalised === 'no';
}
