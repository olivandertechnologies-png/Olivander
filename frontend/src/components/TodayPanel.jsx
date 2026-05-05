import React, { useState } from 'react';
import { PLAN_CONFIG, PLAN_KEYS, isPlusPlan } from '../utils/firstCustomer.js';
import OutcomesPanel from './OutcomesPanel.jsx';

const DELAY_OPTIONS = [
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'two-days', label: '2 days' },
  { key: 'next-week', label: 'Next week' },
];

function money(value) {
  const amount = Number(value || 0);
  return amount ? `$${amount.toLocaleString('en-NZ')}` : '0';
}

function MetricCard({ label, value, detail, locked, onClick }) {
  return (
    <button
      type="button"
      className={`today-metric ${locked ? 'is-locked' : ''}`.trim()}
      onClick={onClick}
      disabled={locked && !onClick}
    >
      <span className="today-metric__label">{label}</span>
      <span className="today-metric__value">{value}</span>
      {detail ? <span className="today-metric__detail">{detail}</span> : null}
      {locked ? <span className="locked-label">Plus</span> : null}
    </button>
  );
}

function ActionCard({ action, locked, onApprove, onDelay, onDismiss, onEdit, onOpenJob, onUpgrade }) {
  const [delayOpen, setDelayOpen] = useState(false);

  function handleDelayOption(option) {
    setDelayOpen(false);
    onDelay(option);
  }

  return (
    <article className={`admin-action-card ${locked ? 'is-locked' : ''}`.trim()}>
      <div className="admin-action-card__header">
        <div>
          <div className={`admin-action-card__priority admin-action-card__priority--${action.priority || 'medium'}`}>
            {action.priority === 'high' ? 'High' : 'Normal'}
          </div>
          <h3>{action.title}</h3>
        </div>
        {action.value ? <span className="admin-action-card__value">{money(action.value)}</span> : null}
      </div>

      <p className="admin-action-card__why">{action.reason}</p>
      <p className="admin-action-card__detail">{locked ? action.lockedReason : action.detail}</p>

      {action.draft ? (
        <div className="admin-action-card__draft">
          <span>Draft</span>
          <p>{action.draft}</p>
        </div>
      ) : null}

      <div className="admin-action-card__actions">
        {locked ? (
          <button type="button" className="btn-approve" onClick={onUpgrade}>View Plus</button>
        ) : (
          <>
            <button type="button" className="btn-approve" onClick={onApprove}>Queue approval</button>
            <button type="button" className="btn-edit" onClick={onEdit}>Edit</button>
            <button type="button" className="plain-action" onClick={() => setDelayOpen((current) => !current)}>Delay</button>
            <button type="button" className="plain-action" onClick={onOpenJob}>Open job</button>
            <button type="button" className="plain-action plain-action--danger" onClick={onDismiss}>Dismiss</button>
          </>
        )}
      </div>

      {delayOpen && !locked ? (
        <div className="admin-action-delay-menu" aria-label="Delay action">
          <span>Delay for</span>
          {DELAY_OPTIONS.map((option) => (
            <button key={option.key} type="button" onClick={() => handleDelayOption(option)}>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function WorkspaceModeBanner({
  demoMode,
  canUseRealWorkspace,
  onResetDemo,
  onDemoModeChange,
}) {
  const title = demoMode ? 'Demo mode' : 'Real workspace';
  const detail = demoMode
    ? 'Sample leads, jobs, and approval drafts. Nothing is persisted.'
    : 'Live workspace records are loaded and saved for this business.';

  return (
    <div className={`workspace-mode-banner ${demoMode ? 'is-demo' : 'is-real'}`.trim()}>
      <div className="workspace-mode-banner__copy">
        <span>{title}</span>
        <strong>{detail}</strong>
      </div>
      <div className="workspace-mode-banner__actions">
        {demoMode ? (
          <>
            <button type="button" className="plain-action" onClick={onResetDemo}>
              Reset sample data
            </button>
            {canUseRealWorkspace ? (
              <button type="button" className="btn-edit" onClick={() => onDemoModeChange(false)}>
                Use real workspace
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" className="btn-edit" onClick={() => onDemoModeChange(true)}>
            Use sample data
          </button>
        )}
      </div>
    </div>
  );
}

export default function TodayPanel({
  plan,
  demoMode,
  canUseRealWorkspace,
  actionCards,
  jobsToday,
  recentActivity,
  stats,
  outcomesSummary,
  outcomesLoading,
  outcomesError,
  onActionApprove,
  onActionDelay,
  onActionDismiss,
  onActionEdit,
  onOpenJob,
  onNavigate,
  onUpgrade,
  onResetDemo,
  onDemoModeChange,
  onRefreshOutcomes,
}) {
  const plus = isPlusPlan(plan);
  const planConfig = PLAN_CONFIG[plus ? PLAN_KEYS.plus : PLAN_KEYS.starter];

  return (
    <section className="panel-scroll__inner today-panel">
      <div className="today-hero">
        <div>
          <h2 className="display-title">Today</h2>
          <p className="today-hero__copy">The admin work most likely to be forgotten or delayed.</p>
        </div>
        <button type="button" className="plan-status-pill" onClick={onUpgrade}>
          {planConfig.label}
        </button>
      </div>

      <WorkspaceModeBanner
        demoMode={demoMode}
        canUseRealWorkspace={canUseRealWorkspace}
        onResetDemo={onResetDemo}
        onDemoModeChange={onDemoModeChange}
      />

      <OutcomesPanel
        summary={outcomesSummary}
        loading={outcomesLoading}
        error={outcomesError}
        onRefresh={onRefreshOutcomes}
      />

      <div className="today-metrics-grid">
        <MetricCard label="Needs approval" value={stats.awaitingApproval} detail="Ready to review" onClick={() => onNavigate('approvals')} />
        <MetricCard label="New leads" value={stats.newLeads} detail="Inbox and pipeline" onClick={() => onNavigate('leads')} />
        <MetricCard label="Quote follow-ups" value={stats.quoteFollowUps} detail="Waiting too long" onClick={() => onNavigate('jobs')} />
        <MetricCard label="Jobs today" value={stats.jobsToday} detail="Scheduled or flagged" onClick={() => onNavigate('jobs')} />
        <MetricCard
          label="Money at risk"
          value={plus ? money(stats.moneyAtRisk) : 'Locked'}
          detail={plus ? 'Overdue invoices' : 'Invoice chasing'}
          locked={!plus}
          onClick={plus ? () => onNavigate('invoices') : onUpgrade}
        />
        <MetricCard
          label="Calendar gaps"
          value={plus ? stats.calendarGaps : 'Locked'}
          detail={plus ? 'Slots to offer' : 'Scheduling help'}
          locked={!plus}
          onClick={plus ? () => onNavigate('jobs') : onUpgrade}
        />
      </div>

      <div className="today-workspace">
        <div className="today-primary">
          <div className="section-heading-row">
            <div>
              <h3>Top actions</h3>
              <p>Every send or finance action stays approval-first.</p>
            </div>
          </div>

          {actionCards.length ? (
            <div className="admin-action-list">
              {actionCards.map((action) => {
                const locked = action.plusOnly && !plus;
                return (
                  <ActionCard
                    key={action.id}
                    action={action}
                    locked={locked}
                    onApprove={() => onActionApprove(action)}
                    onDelay={(option) => onActionDelay(action, option)}
                    onDismiss={() => onActionDismiss(action)}
                    onEdit={() => onActionEdit(action)}
                    onOpenJob={() => onOpenJob(action.jobId)}
                    onUpgrade={onUpgrade}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty-card">No admin actions waiting.</div>
          )}
        </div>

        <aside className="today-sidebar">
          <section className="today-side-section">
            <div className="today-side-section__title">Jobs today</div>
            {jobsToday.length ? jobsToday.map((job) => (
              <button key={job.id} type="button" className="today-job-row" onClick={() => onOpenJob(job.id)}>
                <span>{job.scheduledFor || 'Unscheduled'}</span>
                <strong>{job.customer}</strong>
                <em>{job.jobType}</em>
              </button>
            )) : <p className="today-side-empty">No scheduled jobs today.</p>}
          </section>

          <section className="today-side-section">
            <div className="today-side-section__title">Activity</div>
            {recentActivity.slice(0, 4).map((item) => (
              <div key={item.id} className="today-activity-row">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}
