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
