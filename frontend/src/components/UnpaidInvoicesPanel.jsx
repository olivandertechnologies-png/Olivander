import React, { useEffect, useMemo, useState } from 'react';

import { MailIcon } from './icons.jsx';
import { readResponseDetail } from '../utils/api.js';

function formatMoney(amount, currency = 'NZD') {
  return `${currency} ${Number(amount || 0).toLocaleString('en-NZ', {
    style: 'currency',
    currency,
  }).replace(currency, '').trim()}`;
}

function formatDueDate(value) {
  if (!value) return 'No due date';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function overdueTone(daysOverdue) {
  const days = Number(daysOverdue || 0);
  if (days >= 15) return 'danger';
  if (days >= 1) return 'warning';
  return 'neutral';
}

function OverdueBadge({ daysOverdue }) {
  const days = Number(daysOverdue || 0);
  const label = days > 0 ? `${days}d overdue` : 'Not due';
  return (
    <span className={`invoice-overdue-badge invoice-overdue-badge--${overdueTone(days)}`}>
      {label}
    </span>
  );
}

function InvoiceRow({ invoice, busy, queued, onReminder }) {
  const invoiceNumber = invoice.invoice_number || invoice.invoice_id || 'Invoice';
  const canSend = Boolean(invoice.contact_email) && !queued;
  return (
    <tr className={queued ? 'is-queued' : ''}>
      <td>
        <strong>{invoiceNumber}</strong>
        <span>{formatDueDate(invoice.due_date)}</span>
      </td>
      <td>
        <strong>{invoice.contact_name || 'Unknown contact'}</strong>
        <span>{invoice.contact_email || 'No email in Xero'}</span>
      </td>
      <td className="unpaid-invoices__amount">
        {formatMoney(invoice.amount_due, invoice.currency_code || 'NZD')}
      </td>
      <td>
        <OverdueBadge daysOverdue={invoice.days_overdue} />
      </td>
      <td className="unpaid-invoices__action-cell">
        <button
          type="button"
          className="connection-button is-primary invoice-reminder-button"
          onClick={() => onReminder(invoice)}
          disabled={!canSend || busy}
          title={!invoice.contact_email ? 'Add an email address to this contact in Xero first' : undefined}
        >
          <MailIcon />
          <span>{queued ? 'Queued' : busy ? 'Queuing...' : 'Send reminder'}</span>
        </button>
      </td>
    </tr>
  );
}

export default function UnpaidInvoicesPanel({
  fetchProtected,
  xeroConnected,
  onOpenConnections,
  onReminderQueued,
}) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(Boolean(xeroConnected));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyInvoiceId, setBusyInvoiceId] = useState('');
  const [queuedInvoiceIds, setQueuedInvoiceIds] = useState(() => new Set());

  async function loadInvoices() {
    if (!xeroConnected) {
      setInvoices([]);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetchProtected('/api/invoices/unpaid');
      if (response.status === 401) return;
      if (!response.ok) throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
      const payload = await response.json();
      setInvoices(Array.isArray(payload) ? payload : payload.invoices || []);
    } catch {
      setInvoices([]);
      setError('Could not load unpaid invoices from Xero.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInvoices();
  }, [xeroConnected]);

  const totalDue = useMemo(
    () => invoices.reduce((total, invoice) => total + Number(invoice.amount_due || 0), 0),
    [invoices],
  );
  const currency = invoices[0]?.currency_code || 'NZD';

  async function handleReminder(invoice) {
    const invoiceId = invoice.invoice_id;
    if (!invoiceId || busyInvoiceId) return;

    setBusyInvoiceId(invoiceId);
    setNotice('');
    setError('');
    try {
      const response = await fetchProtected(`/api/invoices/${encodeURIComponent(invoiceId)}/reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (response.status === 401) return;
      if (!response.ok) throw new Error(await readResponseDetail(response, `Failed with status ${response.status}`));
      setQueuedInvoiceIds((current) => new Set([...current, invoiceId]));
      setNotice(`Reminder queued for ${invoice.contact_name || invoice.invoice_number || 'invoice'}.`);
      onReminderQueued?.();
    } catch (requestError) {
      setError(requestError.message || 'Could not queue reminder.');
    } finally {
      setBusyInvoiceId('');
    }
  }

  if (!xeroConnected) {
    return (
      <section className="panel-scroll__inner unpaid-invoices-panel">
        <div className="panel-title-row">
          <div>
            <h2 className="display-title">Invoices</h2>
            <p>Connect Xero to see unpaid invoices and queue reminders for approval.</p>
          </div>
          <button type="button" className="connection-button is-primary" onClick={onOpenConnections}>
            Connect Xero
          </button>
        </div>
        <div className="empty-card empty-card--center">Xero is not connected.</div>
      </section>
    );
  }

  if (loading) {
    return <div className="panel-scroll__inner"><div className="memory-loading">Loading unpaid invoices...</div></div>;
  }

  return (
    <section className="panel-scroll__inner unpaid-invoices-panel">
      <div className="panel-title-row">
        <div>
          <h2 className="display-title">Invoices</h2>
          <p>Live Xero balances. Reminders stay in approval before anything is sent.</p>
        </div>
        <button type="button" className="connection-button" onClick={() => void loadInvoices()}>
          Refresh
        </button>
      </div>

      <div className="unpaid-invoices__summary">
        <div>
          <span>Unpaid</span>
          <strong>{invoices.length}</strong>
        </div>
        <div>
          <span>Total due</span>
          <strong>{formatMoney(totalDue, currency)}</strong>
        </div>
      </div>

      {notice ? <div className="inline-success">{notice}</div> : null}
      {error ? <div className="inline-error">{error}</div> : null}

      {invoices.length === 0 ? (
        <div className="empty-card empty-card--center">No unpaid authorised invoices in Xero.</div>
      ) : (
        <div className="unpaid-invoices__table-wrap">
          <table className="unpaid-invoices__table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Contact</th>
                <th>Amount due</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <InvoiceRow
                  key={invoice.invoice_id || invoice.invoice_number}
                  invoice={invoice}
                  busy={busyInvoiceId === invoice.invoice_id}
                  queued={queuedInvoiceIds.has(invoice.invoice_id)}
                  onReminder={handleReminder}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
