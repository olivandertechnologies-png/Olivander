import React from 'react';

function number(value) {
  return Number(value || 0).toLocaleString('en-NZ');
}

function hours(value) {
  const amount = Number(value || 0);
  if (!amount) return '0h';
  return `${amount.toLocaleString('en-NZ', { maximumFractionDigits: 1 })}h`;
}

const OUTCOME_METRICS = [
  { key: 'emails_triaged', label: 'Emails triaged', format: number },
  { key: 'follow_ups_sent', label: 'Follow-ups sent', format: number },
  { key: 'invoices_chased', label: 'Invoices chased', format: number },
  { key: 'quotes_sent', label: 'Quotes sent', format: number },
  { key: 'avg_response_time_hours', label: 'Avg response time', format: hours },
  { key: 'leads_created', label: 'Leads created', format: number },
];

export default function OutcomesPanel({
  summary,
  loading,
  error,
  onRefresh,
}) {
  const total = Number(summary?.total_admin_tasks || 0);

  return (
    <section className="outcomes-panel" aria-label="30-day outcomes">
      <div className="outcomes-panel__header">
        <div>
          <span>30-day outcomes</span>
          <h3>In the last 30 days, Olivander handled {number(total)} admin tasks for you.</h3>
        </div>
        {onRefresh ? (
          <button type="button" className="connection-button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      <div className="outcomes-panel__grid">
        {OUTCOME_METRICS.map((metric) => (
          <div key={metric.key} className="outcomes-stat">
            <strong>{loading && !summary ? '...' : metric.format(summary?.[metric.key])}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
