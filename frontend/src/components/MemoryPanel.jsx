import React from 'react';
import { BUSINESS_PROFILE_ROWS, PREFERENCE_ROWS, MEMORY_KEYS } from '../utils/constants.js';
import { trimToNull } from '../utils/format.js';

export default function MemoryPanel({ profile, isLoading, memoryError }) {
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
