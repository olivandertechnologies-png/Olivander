import React, { useEffect, useState } from 'react';
import { formatRelativeTime } from '../utils/format.js';

const CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', review: 'Review' };

function ConfidenceDot({ level }) {
  return <span className={`exec-confidence exec-confidence--${level}`} aria-label={CONFIDENCE_LABEL[level]} />;
}

function ExecutionPlan({ plan }) {
  const [open, setOpen] = useState(false);
  if (!plan?.steps?.length) return null;

  const overall = plan.confidence || 'medium';

  return (
    <div className="exec-plan">
      <button
        type="button"
        className="exec-plan__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ConfidenceDot level={overall} />
        <span className="exec-plan__toggle-label">
          Execution plan · <span className={`exec-plan__conf exec-plan__conf--${overall}`}>{CONFIDENCE_LABEL[overall]} confidence</span>
        </span>
        <span className="exec-plan__chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ol className="exec-plan__steps">
          {plan.steps.map((s) => (
            <li key={s.n} className="exec-plan__step">
              <ConfidenceDot level={s.confidence} />
              <div className="exec-plan__step-body">
                <span className="exec-plan__step-action">{s.action}</span>
                <span className="exec-plan__step-system">{s.system}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ContextUsed({ chunks }) {
  if (!chunks?.length) return null;
  return (
    <div className="exec-context">
      <span className="exec-context__label">Context used:</span>
      {chunks.map((c) => (
        <span key={c.key} className="exec-context__chip">{c.key.replace(/_/g, ' ')}</span>
      ))}
    </div>
  );
}

export default function ApprovalCard({ approval, isRemoving, onApprove, onReject, onSaveEdit }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(approval.agentResponse);
  const isMissedResponse = approval.type === 'missed_response';

  useEffect(() => {
    setIsEditing(false);
    setDraftText(approval.agentResponse);
  }, [approval.agentResponse, approval.id]);

  return (
    <article className={`approval-card ${isRemoving ? 'is-removing' : ''}`}>
      <div className="approval-card__inner">
        <div className="approval-card__header">
          <div className="approval-card__sender">
            <div className="approval-card__sender-name">{approval.senderName}</div>
            <div className="approval-card__sender-email">{approval.senderEmail}</div>
          </div>
          <span
            className={`approval-card__badge ${
              approval.status === 'edited' ? 'is-edited' : 'is-review'
            }`}
          >
            {approval.status === 'edited' ? 'Edited' : 'Ready'}
          </span>
        </div>

        <div className="approval-card__subject">{approval.subject}</div>
        <div className="approval-card__meta">
          {formatRelativeTime(approval.createdAt)} · {approval.tier}
        </div>

        {approval.why ? <div className="approval-card__why-text">{approval.why}</div> : null}

        <ExecutionPlan plan={approval.executionPlan} />
        <ContextUsed chunks={approval.retrievedContext} />

        <div className="approval-card__response-label">{isMissedResponse ? 'Action' : 'Draft'}</div>
        {isEditing ? (
          <textarea
            className="approval-card__textarea"
            rows="7"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
        ) : (
          <div className="approval-card__response">{approval.agentResponse}</div>
        )}

        <div className="approval-card__actions">
          <button
            type="button"
            className="approval-action approval-action--approve"
            onClick={() => onApprove(approval)}
          >
            {isMissedResponse ? 'Mark handled' : 'Approve'}
          </button>
          {!isMissedResponse ? (
            <button
              type="button"
              className="approval-action approval-action--edit"
              onClick={() => {
                if (isEditing) {
                  onSaveEdit(approval, draftText);
                  setIsEditing(false);
                  return;
                }
                setIsEditing(true);
              }}
            >
              {isEditing ? 'Save' : 'Edit'}
            </button>
          ) : null}
          <button
            type="button"
            className="approval-action approval-action--reject"
            onClick={() => onReject(approval)}
          >
            {isMissedResponse ? 'Dismiss' : 'Reject'}
          </button>
        </div>
      </div>
    </article>
  );
}
