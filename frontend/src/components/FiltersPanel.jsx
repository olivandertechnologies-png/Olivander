import React, { useEffect, useState } from 'react';
import { MEMORY_KEYS, CATEGORY_OPTIONS } from '../utils/constants.js';

export default function FiltersPanel({ profile, onSave }) {
  const [blockedPatterns, setBlockedPatterns] = useState(profile[MEMORY_KEYS.blockedSenderPatterns] ?? '');
  const [activeCategories, setActiveCategories] = useState(
    (profile[MEMORY_KEYS.activeCategories] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBlockedPatterns(profile[MEMORY_KEYS.blockedSenderPatterns] ?? '');
    setActiveCategories(
      (profile[MEMORY_KEYS.activeCategories] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    );
  }, [profile]);

  function toggleCategory(value) {
    setActiveCategories((current) =>
      current.includes(value) ? current.filter((c) => c !== value) : [...current, value],
    );
    setSaved(false);
  }

  async function handleSave() {
    if (isSaving || !onSave) return;
    setIsSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      await onSave(MEMORY_KEYS.blockedSenderPatterns, blockedPatterns);
      await onSave(MEMORY_KEYS.activeCategories, activeCategories.join(','));
      setSaved(true);
    } catch {
      setSaveError('Could not save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="filters-panel">
      <div className="filters-panel__section">
        <div className="filters-panel__label">Blocked sender patterns</div>
        <div className="filters-panel__hint">
          Comma-separated substrings. Emails matching any pattern are ignored.
        </div>
        <textarea
          className="filters-panel__textarea"
          rows={3}
          value={blockedPatterns}
          onChange={(event) => {
            setBlockedPatterns(event.target.value);
            setSaved(false);
          }}
          placeholder="noreply,no-reply,newsletter"
        />
      </div>

      <div className="filters-panel__section">
        <div className="filters-panel__label">Active email categories</div>
        <div className="filters-panel__hint">
          Only emails matching these categories will create tasks.
        </div>
        <div className="filters-panel__categories">
          {CATEGORY_OPTIONS.map((option) => (
            <label key={option.value} className="filters-panel__category">
              <input
                type="checkbox"
                checked={activeCategories.includes(option.value)}
                onChange={() => toggleCategory(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      {saveError ? <div className="inline-error">{saveError}</div> : null}
      {saved ? <div className="filters-panel__saved">Saved.</div> : null}

      <button
        type="button"
        className="connection-button is-primary filters-panel__save"
        disabled={isSaving}
        onClick={() => void handleSave()}
      >
        {isSaving ? 'Saving...' : 'Save filters'}
      </button>
    </div>
  );
}
