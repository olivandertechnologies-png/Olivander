import React from 'react';
import ApprovalCard from './ApprovalCard.jsx';

export default function ApprovalsPanel({ approvals, removingApprovals, onApprove, onReject, onSaveEdit }) {
  return (
    <section className="panel-scroll__inner approvals-panel">
      {approvals.length ? (
        approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            isRemoving={Boolean(removingApprovals[approval.id])}
            onApprove={onApprove}
            onReject={onReject}
            onSaveEdit={onSaveEdit}
          />
        ))
      ) : (
        <div className="empty-card empty-card--center">No approvals</div>
      )}
    </section>
  );
}
