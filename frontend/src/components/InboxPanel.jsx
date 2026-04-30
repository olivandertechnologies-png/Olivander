import React, { useState } from 'react';
import { buildManualInboxMessage } from '../utils/firstCustomer.js';

function CategoryChip({ category }) {
  const slug = String(category || 'needs-reply').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return <span className={`inbox-category inbox-category--${slug}`}>{category}</span>;
}

function InboxCard({ message, plusLocked, onCreateJob, onQueueReply, onDismiss, onUpgrade }) {
  return (
    <article className={`inbox-card ${plusLocked ? 'is-plus-preview' : ''}`.trim()}>
      <div className="inbox-card__top">
        <div>
          <h3>{message.customer}</h3>
          <p>{message.subject}</p>
        </div>
        <CategoryChip category={message.category} />
      </div>

      <div className="inbox-card__meta">
        <span>{message.receivedAt}</span>
        <span>{message.email}</span>
      </div>

      <blockquote className="inbox-card__body">{message.body}</blockquote>

      <div className="inbox-card__interpretation">
        <strong>Olivander read</strong>
        <span>{plusLocked ? message.plusOnlyReason : message.interpretation}</span>
      </div>

      <div className="inbox-card__draft">
        <strong>Draft reply</strong>
        <p>{message.draft}</p>
      </div>

      <div className="inbox-card__actions">
        {plusLocked ? (
          <button type="button" className="btn-approve" onClick={onUpgrade}>View Plus</button>
        ) : (
          <>
            <button type="button" className="btn-approve" onClick={() => onQueueReply(message)}>Queue reply</button>
            <button type="button" className="btn-edit" onClick={() => onCreateJob(message)}>Create job</button>
            <button type="button" className="plain-action plain-action--danger" onClick={() => onDismiss(message.id)}>Dismiss</button>
          </>
        )}
      </div>
    </article>
  );
}

export default function InboxPanel({
  messages,
  planIsPlus,
  demoMode,
  googleConnected,
  isSyncingInbox,
  inboxSyncMessage,
  onCreateJob,
  onQueueReply,
  onDismiss,
  onManualMessage,
  onSyncInbox,
  onOpenConnections,
  onUpgrade,
}) {
  const [showComposer, setShowComposer] = useState(false);
  const [customer, setCustomer] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    onManualMessage(buildManualInboxMessage({ customer, email, body: text }));
    setCustomer('');
    setEmail('');
    setBody('');
    setShowComposer(false);
  }

  return (
    <section className="panel-scroll__inner inbox-panel">
      <div className="panel-title-row">
        <div>
          <h2 className="display-title">Inbox</h2>
          <p>Customer messages grouped into practical admin actions.</p>
        </div>
        <div className="panel-title-row__actions">
          {!demoMode ? (
            <button
              type="button"
              className="btn-edit"
              onClick={googleConnected ? onSyncInbox : onOpenConnections}
              disabled={isSyncingInbox}
            >
              {isSyncingInbox ? 'Syncing Gmail' : googleConnected ? 'Sync Gmail' : 'Connect Gmail'}
            </button>
          ) : null}
          <button type="button" className="primary-button" onClick={() => setShowComposer((value) => !value)}>
            Add message
          </button>
        </div>
      </div>

      {inboxSyncMessage ? <div className="inbox-sync-status">{inboxSyncMessage}</div> : null}

      {showComposer ? (
        <form className="manual-message-form" onSubmit={handleSubmit}>
          <div className="manual-message-form__grid">
            <label>
              Customer
              <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="e.g. Sam Taylor" />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.co.nz" />
            </label>
          </div>
          <label>
            Message
            <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Paste a customer message..." rows={5} />
          </label>
          <div className="manual-message-form__actions">
            <button type="submit" className="btn-approve">Create inbox card</button>
            <button type="button" className="plain-action" onClick={() => setShowComposer(false)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {messages.length ? (
        <div className="inbox-list">
          {messages.map((message) => {
            const plusLocked = !planIsPlus && ['Payment question'].includes(message.category);
            return (
              <InboxCard
                key={message.id}
                message={message}
                plusLocked={plusLocked}
                onCreateJob={onCreateJob}
                onQueueReply={onQueueReply}
                onDismiss={onDismiss}
                onUpgrade={onUpgrade}
              />
            );
          })}
        </div>
      ) : (
        <div className="empty-card">No inbox cards. Add a message or connect Gmail.</div>
      )}
    </section>
  );
}
