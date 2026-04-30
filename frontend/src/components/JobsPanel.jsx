import React, { useMemo, useState } from 'react';
import { JOB_STAGES, getStageLabel, isPlusPlan } from '../utils/firstCustomer.js';

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount ? `$${amount.toLocaleString('en-NZ')}` : '';
}

function StageSelect({ job, plan, onChange }) {
  const plus = isPlusPlan(plan);
  const [open, setOpen] = useState(false);
  const stages = JOB_STAGES.filter((stage) => plus || stage.starter);

  function handleSelect(stageKey) {
    setOpen(false);
    onChange(job.id, stageKey);
  }

  return (
    <div className="job-stage-menu">
      <button
        type="button"
        className="job-stage-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{getStageLabel(job.status)}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="job-stage-options" role="listbox">
          {stages.map((stage) => (
            <button
              key={stage.key}
              type="button"
              className={stage.key === job.status ? 'is-active' : ''}
              role="option"
              aria-selected={stage.key === job.status}
              onClick={() => handleSelect(stage.key)}
            >
              {stage.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function JobDetail({ job, plan, onStageChange, onAddNote, onQueueFollowUp, onUpgrade }) {
  const [note, setNote] = useState('');
  const plus = isPlusPlan(plan);

  if (!job) {
    return (
      <aside className="job-detail-panel">
        <div className="empty-card">Select a job to see the timeline.</div>
      </aside>
    );
  }

  function submitNote(event) {
    event.preventDefault();
    const value = note.trim();
    if (!value) return;
    onAddNote(job.id, value);
    setNote('');
  }

  return (
    <aside className="job-detail-panel">
      <div className="job-detail__header">
        <div className="job-detail__title">
          <h3>{job.customer}</h3>
          <p>{job.jobType}</p>
        </div>
        <div className="job-detail__stage">
          <span>Stage</span>
          <StageSelect job={job} plan={plan} onChange={onStageChange} />
        </div>
      </div>

      <dl className="job-detail__facts">
        <div><dt>Address</dt><dd>{job.address || 'Not set'}</dd></div>
        <div><dt>Contact</dt><dd>{job.phone || job.email || 'Not set'}</dd></div>
        <div><dt>Value</dt><dd>{formatMoney(job.value) || 'Unknown'}</dd></div>
        <div><dt>Scheduled</dt><dd>{job.scheduledFor || 'Not scheduled'}</dd></div>
      </dl>

      <section className="job-detail__section">
        <h4>Next action</h4>
        <p>{job.nextAction || 'No action set.'}</p>
        <div className="job-detail__actions">
          <button type="button" className="btn-approve" onClick={() => onQueueFollowUp(job)}>
            Draft follow-up
          </button>
          {job.invoice && !plus ? (
            <button type="button" className="btn-edit" onClick={onUpgrade}>Unlock invoice reminders</button>
          ) : null}
        </div>
      </section>

      {job.invoice ? (
        <section className={`job-detail__section ${plus ? '' : 'is-locked'}`.trim()}>
          <h4>Invoice</h4>
          <p>
            {plus
              ? `${formatMoney(job.invoice.amount)} - ${job.invoice.dueDaysAgo} days overdue`
              : 'Invoice status and payment chasing are available on Admin Plus.'}
          </p>
        </section>
      ) : null}

      <section className="job-detail__section">
        <h4>Notes</h4>
        <div className="job-note-list">
          {(job.notes || []).map((item, index) => <p key={`${job.id}-note-${index}`}>{item}</p>)}
        </div>
        <form className="job-note-form" onSubmit={submitNote}>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add note" />
          <button type="submit" className="btn-send">Add</button>
        </form>
      </section>

      <section className="job-detail__section">
        <h4>Timeline</h4>
        <div className="job-timeline">
          {(job.timeline || []).map((item, index) => <span key={`${job.id}-timeline-${index}`}>{item}</span>)}
        </div>
      </section>
    </aside>
  );
}

export default function JobsPanel({
  jobs,
  plan,
  selectedJobId,
  onSelectJob,
  onStageChange,
  onAddJob,
  onAddNote,
  onQueueFollowUp,
  onUpgrade,
}) {
  const [view, setView] = useState('list');
  const [filter, setFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [newJob, setNewJob] = useState({ customer: '', jobType: '', address: '' });
  const plus = isPlusPlan(plan);

  const visibleStages = JOB_STAGES.filter((stage) => plus || stage.starter);
  const filteredJobs = useMemo(() => (
    filter === 'all' ? jobs : jobs.filter((job) => job.status === filter)
  ), [filter, jobs]);
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || filteredJobs[0] || jobs[0] || null;

  function submitNewJob(event) {
    event.preventDefault();
    if (!newJob.customer.trim()) return;
    onAddJob({
      customer: newJob.customer.trim(),
      jobType: newJob.jobType.trim() || 'Manual job',
      address: newJob.address.trim(),
    });
    setNewJob({ customer: '', jobType: '', address: '' });
    setShowAdd(false);
  }

  return (
    <section className="panel-scroll__inner jobs-panel">
      <div className="panel-title-row">
        <div>
          <h2 className="display-title">Jobs</h2>
          <p>Simple job records with next actions and customer history.</p>
        </div>
        <div className="panel-title-row__actions">
          <div className="segmented-control" aria-label="Job view">
            <button type="button" className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}>List</button>
            <button type="button" className={view === 'board' ? 'is-active' : ''} onClick={() => setView('board')}>Board</button>
          </div>
          <button type="button" className="primary-button" onClick={() => setShowAdd((value) => !value)}>Add job</button>
        </div>
      </div>

      {showAdd ? (
        <form className="job-add-form" onSubmit={submitNewJob}>
          <input value={newJob.customer} onChange={(event) => setNewJob((current) => ({ ...current, customer: event.target.value }))} placeholder="Customer name" />
          <input value={newJob.jobType} onChange={(event) => setNewJob((current) => ({ ...current, jobType: event.target.value }))} placeholder="Job type" />
          <input value={newJob.address} onChange={(event) => setNewJob((current) => ({ ...current, address: event.target.value }))} placeholder="Address or suburb" />
          <button type="submit" className="btn-approve">Create job</button>
        </form>
      ) : null}

      <div className="jobs-layout">
        <div className="jobs-main">
          <div className="filter-row">
            <button type="button" className={`filter-chip ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>All</button>
            {visibleStages.map((stage) => (
              <button
                key={stage.key}
                type="button"
                className={`filter-chip ${filter === stage.key ? 'is-active' : ''}`}
                onClick={() => setFilter(stage.key)}
              >
                {stage.label}
              </button>
            ))}
          </div>

          {view === 'board' ? (
            <div className="jobs-board">
              {visibleStages.map((stage) => (
                <div key={stage.key} className="jobs-board__column">
                  <div className="jobs-board__heading">{stage.label}</div>
                  {jobs.filter((job) => job.status === stage.key).map((job) => (
                    <button key={job.id} type="button" className="job-card" onClick={() => onSelectJob(job.id)}>
                      <strong>{job.customer}</strong>
                      <span>{job.jobType}</span>
                      <em>{job.nextAction}</em>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="job-list">
              {filteredJobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className={`job-row ${selectedJob?.id === job.id ? 'is-active' : ''}`.trim()}
                  onClick={() => onSelectJob(job.id)}
                >
                  <span className="job-row__main">
                    <strong>{job.customer}</strong>
                    <em>{job.jobType} - {job.address || 'No address'}</em>
                  </span>
                  <span className="job-row__meta">
                    {formatMoney(job.value)}
                    <span>{getStageLabel(job.status)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <JobDetail
          job={selectedJob}
          plan={plan}
          onStageChange={onStageChange}
          onAddNote={onAddNote}
          onQueueFollowUp={onQueueFollowUp}
          onUpgrade={onUpgrade}
        />
      </div>
    </section>
  );
}
