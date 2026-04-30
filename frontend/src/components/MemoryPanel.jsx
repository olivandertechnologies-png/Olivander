import React, { useEffect, useState } from 'react';
import { MEMORY_KEYS } from '../utils/constants.js';
import { trimToNull } from '../utils/format.js';

const PROFILE_FIELDS = [
  { key: MEMORY_KEYS.businessName,    label: 'Business name',      placeholder: 'e.g. Alpine Guides Ltd',             multiline: false },
  { key: MEMORY_KEYS.businessType,    label: 'What you do',        placeholder: 'e.g. Mountain guiding, landscaping', multiline: false },
  { key: 'location',                  label: 'Location',           placeholder: 'e.g. Queenstown, NZ',               multiline: false },
  { key: MEMORY_KEYS.replyTone,       label: 'Reply tone',         placeholder: 'e.g. Friendly but professional',     multiline: false },
  { key: MEMORY_KEYS.pricingRange,    label: 'Typical job value',  placeholder: 'e.g. $200–$500 per session',        multiline: false },
  { key: MEMORY_KEYS.paymentTerms,    label: 'Payment terms',      placeholder: 'e.g. Invoice on completion, 14 days', multiline: false },
  { key: MEMORY_KEYS.gstRegistered,   label: 'GST registered',     placeholder: 'Yes or No',                          multiline: false },
  { key: MEMORY_KEYS.reschedulePolicy, label: 'Reschedule policy', placeholder: 'e.g. 48 hours notice required',     multiline: true  },
  { key: MEMORY_KEYS.noShowHandling,  label: 'No-show handling',   placeholder: 'e.g. Charge 50% of booking value',  multiline: true  },
];

export default function MemoryPanel({ profile, isLoading, memoryError, onSave }) {
  const [fields, setFields] = useState({});
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState(null);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const initial = {};
    PROFILE_FIELDS.forEach(({ key }) => {
      initial[key] = trimToNull(profile[key]) ?? '';
    });
    setFields(initial);
    setDirty({});
  }, [profile]);

  function handleChange(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setDirty((prev) => ({ ...prev, [key]: true }));
    setSavedKey(null);
    setSaveError('');
  }

  async function handleSave(key) {
    if (!onSave || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(key, fields[key]);
      setDirty((prev) => ({ ...prev, [key]: false }));
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      setSaveError('Could not save — check connection.');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <div className="memory-loading">Loading profile…</div>;
  }

  return (
    <div className="memory-edit-panel">
      {memoryError ? <div className="inline-error">{memoryError}</div> : null}
      {saveError ? <div className="inline-error">{saveError}</div> : null}

      {PROFILE_FIELDS.map(({ key, label, placeholder, multiline }) => {
        const isDirty = Boolean(dirty[key]);
        const isSaved = savedKey === key;

        return (
          <div key={key} className="memory-edit-row">
            <label className="memory-edit-row__label" htmlFor={`mem-${key}`}>
              {label}
            </label>
            {multiline ? (
              <textarea
                id={`mem-${key}`}
                className="memory-edit-row__input memory-edit-row__input--textarea"
                rows={2}
                value={fields[key] ?? ''}
                placeholder={placeholder}
                onChange={(e) => handleChange(key, e.target.value)}
              />
            ) : (
              <input
                id={`mem-${key}`}
                type="text"
                className="memory-edit-row__input"
                value={fields[key] ?? ''}
                placeholder={placeholder}
                onChange={(e) => handleChange(key, e.target.value)}
              />
            )}
            <div className="memory-edit-row__actions">
              {isSaved ? (
                <span className="memory-edit-row__saved">Saved</span>
              ) : (
                <button
                  type="button"
                  className="memory-edit-row__save-btn"
                  disabled={!isDirty || saving}
                  onClick={() => void handleSave(key)}
                >
                  Save
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
