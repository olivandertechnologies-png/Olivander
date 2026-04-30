import React, { useEffect, useState } from 'react';
import { PlusIcon } from './icons.jsx';

const STAGES = [
  { key: 'new_enquiry',     label: 'New enquiry',      color: 'accent' },
  { key: 'contacted',       label: 'Contacted',        color: 'muted' },
  { key: 'quote_sent',      label: 'Quote sent',       color: 'warning' },
  { key: 'quote_accepted',  label: 'Accepted',         color: 'success' },
  { key: 'won',             label: 'Won',              color: 'success' },
  { key: 'lost',            label: 'Lost',             color: 'danger' },
];

const STAGE_NEXT = {
  new_enquiry:    'contacted',
  contacted:      'quote_sent',
  quote_sent:     'quote_accepted',
  quote_accepted: 'won',
};

function StageChip({ stage }) {
  const cfg = STAGES.find((s) => s.key === stage) || STAGES[0];
  return (
    <span className={`lead-stage-chip lead-stage-chip--${cfg.color}`}>{cfg.label}</span>
  );
}

function LeadRow({ lead, onStageChange }) {
  const hasNext = STAGE_NEXT[lead.stage];
  const nextLabel = STAGES.find((s) => s.key === hasNext)?.label;

  return (
    <div className="lead-row">
      <div className="lead-row__left">
        <div className="lead-row__name">{lead.name}</div>
        {lead.email ? <div className="lead-row__meta">{lead.email}</div> : null}
        {lead.enquiry_type ? (
          <div className="lead-row__meta">{lead.enquiry_type.replace(/_/g, ' ')}</div>
        ) : null}
      </div>
      <div className="lead-row__right">
        <StageChip stage={lead.stage} />
        {hasNext ? (
          <button
            type="button"
            className="lead-row__advance"
            onClick={() => onStageChange(lead.id, hasNext)}
          >
            → {nextLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function LeadPipelinePanel({ fetchProtected }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('active');
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetchProtected('/api/leads');
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        if (!cancelled) setLeads(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setError('Could not load leads.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  async function handleStageChange(leadId, newStage) {
    try {
      const response = await fetchProtected(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      if (!response.ok) return;
      const updated = await response.json();
      setLeads((current) => current.map((l) => (l.id === leadId ? updated : l)));
    } catch { /* silent */ }
  }

  async function handleAddLead(event) {
    event.preventDefault();
    if (!addName.trim()) return;
    setAdding(true);
    try {
      const response = await fetchProtected('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim(), email: addEmail.trim() || undefined, source: 'manual' }),
      });
      if (!response.ok) return;
      const lead = await response.json();
      setLeads((current) => [lead, ...current]);
      setAddName(''); setAddEmail(''); setShowAdd(false);
    } catch { /* silent */ } finally {
      setAdding(false);
    }
  }

  const activeStages = new Set(['new_enquiry', 'contacted', 'quote_sent', 'quote_accepted']);
  const filtered = filter === 'active'
    ? leads.filter((l) => activeStages.has(l.stage))
    : filter === 'won'
      ? leads.filter((l) => l.stage === 'won')
      : leads.filter((l) => l.stage === 'lost');

  if (loading) return <div className="panel-scroll__inner"><div className="memory-loading">Loading pipeline…</div></div>;

  return (
    <section className="panel-scroll__inner lead-pipeline-panel">
      {error ? <div className="inline-error">{error}</div> : null}

      <div className="lead-pipeline__toolbar">
        <div className="filter-tabs">
          {[
            { key: 'active', label: `Active (${leads.filter((l) => activeStages.has(l.stage)).length})` },
            { key: 'won',    label: `Won (${leads.filter((l) => l.stage === 'won').length})` },
            { key: 'lost',   label: `Lost (${leads.filter((l) => l.stage === 'lost').length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`filter-tab ${filter === tab.key ? 'is-active' : ''}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="connection-button is-primary"
          style={{ padding: '6px 12px', fontSize: '13px', gap: '4px', display: 'inline-flex', alignItems: 'center' }}
          onClick={() => setShowAdd((s) => !s)}
        >
          <PlusIcon />
          <span>Add lead</span>
        </button>
      </div>

      {showAdd ? (
        <form className="lead-add-form" onSubmit={handleAddLead}>
          <input
            className="memory-edit-row__input"
            type="text"
            placeholder="Name *"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            required
          />
          <input
            className="memory-edit-row__input"
            type="email"
            placeholder="Email (optional)"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="connection-button is-primary" disabled={adding}>
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button type="button" className="connection-button" onClick={() => setShowAdd(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <div className="lead-pipeline__empty">
          {filter === 'active' ? 'No active leads yet. Agent will add them automatically from email.' : `No ${filter} leads.`}
        </div>
      ) : (
        <div className="lead-list">
          {filtered.map((lead) => (
            <LeadRow key={lead.id} lead={lead} onStageChange={handleStageChange} />
          ))}
        </div>
      )}
    </section>
  );
}
