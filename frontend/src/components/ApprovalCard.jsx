import React, { useEffect, useState } from 'react';
import { formatRelativeTime } from '../utils/format.js';

export default function ApprovalCard({ approval, isRemoving, onApprove, onReject, onSaveEdit }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(approval.agentResponse);

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

        <div className="approval-card__response-label">Draft</div>
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
            Approve
          </button>
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
          <button
            type="button"
            className="approval-action approval-action--reject"
            onClick={() => onReject(approval)}
          >
            Reject
          </button>
        </div>
      </div>
    </article>
  );
}
