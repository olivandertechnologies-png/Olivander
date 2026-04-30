import React from 'react';
import { ArrowRightIcon } from './icons.jsx';
import { HOME_CHIPS, HOME_HEADLINES } from '../utils/constants.js';
import { formatDisplayName } from '../utils/format.js';

function getHomeHeadlineBucket(hour) {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function pickRandomHomeHeadlineVariant(currentTime) {
  const variants = HOME_HEADLINES[getHomeHeadlineBucket(currentTime.getHours())];
  if (!variants?.length) return HOME_HEADLINES.morning[0];
  return variants[Math.floor(Math.random() * variants.length)] ?? variants[0];
}

function renderHeadline(variant, name) {
  const cleanName = formatDisplayName(name);
  return cleanName ? variant.withName(cleanName) : variant.withoutName;
}

function buildLeadNarrative(summary) {
  if (!summary) return null;
  const { total_active, stale_quotes, unreplied_enquiries, won_this_month, closed_this_month } = summary;
  if (!total_active) return null;

  const parts = [];
  parts.push(`You have ${total_active} open lead${total_active !== 1 ? 's' : ''}.`);

  if (stale_quotes > 0) {
    parts.push(`${stale_quotes} quote${stale_quotes !== 1 ? 's' : ''} pending response — over 5 days old.`);
  }
  if (unreplied_enquiries > 0) {
    parts.push(`${unreplied_enquiries} new ${unreplied_enquiries !== 1 ? 'enquiries have' : 'enquiry has'} not been replied to yet.`);
  }
  if (closed_this_month > 0) {
    parts.push(`Conversion this month: ${won_this_month} of ${closed_this_month} quotes accepted.`);
  }

  return parts.join(' ');
}

export default function HomePanel({
  currentTime,
  headlineVariant,
  greetingName,
  homeInput,
  onHomeInputChange,
  onHomeSubmit,
  onChipClick,
  onStatClick,
  awaitingApprovalCount,
  activeTaskCount,
  resolvedThisWeekCount,
  openLeadCount,
  leadSummary,
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
        <h2 className="display-title">{renderHeadline(headlineVariant, greetingName)}</h2>
        {subtitle ? <p className="greeting-subtitle">{subtitle}</p> : null}
      </div>

      <div className="stats-grid">
        <button type="button" className="stat-card" onClick={() => onStatClick('approvals')}>
          <div className="stat-card__label">Awaiting approval</div>
          <div className="stat-card__value tone-accent">{awaitingApprovalCount}</div>
        </button>
        <button type="button" className="stat-card" onClick={() => onStatClick('tasks')}>
          <div className="stat-card__label">Active tasks</div>
          <div className="stat-card__value">{activeTaskCount}</div>
        </button>
        <button type="button" className="stat-card" onClick={() => onStatClick('activity')}>
          <div className="stat-card__label">Resolved this week</div>
          <div className="stat-card__value tone-success">{resolvedThisWeekCount}</div>
        </button>
        <button type="button" className="stat-card" onClick={() => onStatClick('leads')}>
          <div className="stat-card__label">Open leads</div>
          <div className="stat-card__value">{openLeadCount ?? 0}</div>
        </button>
      </div>

      {buildLeadNarrative(leadSummary) ? (
        <p className="lead-narrative">{buildLeadNarrative(leadSummary)}</p>
      ) : null}

      <section className="instruction-card">
        <form className="instruction-card__row" onSubmit={onHomeSubmit}>
          <input
            type="text"
            className="instruction-card__input"
            value={homeInput}
            onChange={(event) => onHomeInputChange(event.target.value)}
            placeholder="What needs doing?"
          />
          <button type="submit" className="instruction-card__send" aria-label="Send instruction">
            <ArrowRightIcon />
          </button>
        </form>
        <div className="chip-row">
          {HOME_CHIPS.map((chip) => (
            <button key={chip} type="button" className="chip-button" onClick={() => onChipClick(chip)}>
              {chip}
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
