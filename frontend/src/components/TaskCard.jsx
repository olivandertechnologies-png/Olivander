import React, { useEffect, useRef, useState } from 'react';
import { ChevronIcon } from './icons.jsx';
import {
  trimToNull,
  formatRelativeTime,
  formatTaskAnswer,
  isBinaryTaskAnswer,
} from '../utils/format.js';
import { getDisplayPlanSteps, isDuplicateTaskDescription, isPlaceholderDraftContent } from '../utils/task.js';

export default function TaskCard({
  task,
  isExpanded,
  isCancelling,
  onToggle,
  onAnswerQuestion,
  onNoteSubmit,
  onApproveDraft,
  onCancelTask,
  onSaveDraft,
}) {
  const [note, setNote] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [draftText, setDraftText] = useState(task.draftContent ?? task.draftPreview?.text ?? '');
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [isResolvingQuestion, setIsResolvingQuestion] = useState(false);
  const [isEmailExpanded, setIsEmailExpanded] = useState(false);
  const resolveTimerRef = useRef(null);

  const statusMeta =
    task.status === 'done'
      ? { label: 'Done', tone: 'success' }
      : task.status === 'waiting'
        ? { label: 'Waiting', tone: 'warning' }
        : { label: 'Working', tone: 'accent' };

  useEffect(
    () => () => {
      if (resolveTimerRef.current) window.clearTimeout(resolveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (resolveTimerRef.current) {
      window.clearTimeout(resolveTimerRef.current);
      resolveTimerRef.current = null;
    }
    setIsResolvingQuestion(false);
    if (task.questionAnswer) setCustomAnswer('');
  }, [task.id, task.questionAnswer]);

  useEffect(() => {
    setDraftText(task.draftContent ?? task.draftPreview?.text ?? '');
    setIsEditingDraft(false);
  }, [task.draftContent, task.draftPreview?.text, task.id]);

  function submitNote(event) {
    event.preventDefault();
    if (!note.trim()) return;
    onNoteSubmit(task.id, note.trim());
    setNote('');
  }

  function resolveQuestion(answer) {
    if (isResolvingQuestion || task.questionAnswer) return;
    setIsResolvingQuestion(true);
    resolveTimerRef.current = window.setTimeout(() => {
      onAnswerQuestion(task.id, answer);
      resolveTimerRef.current = null;
    }, 220);
  }

  function submitCustomAnswer(event) {
    event.preventDefault();
    event.stopPropagation();
    const answer = customAnswer.trim();
    if (!answer) return;
    resolveQuestion(answer);
  }

  const showClarifyingQuestion =
    Boolean(task.clarifyingQuestion) && (!task.questionAnswer || isResolvingQuestion);
  const showAnsweredState = Boolean(task.questionAnswer) && !isBinaryTaskAnswer(task.questionAnswer);
  const taskPlanSteps = getDisplayPlanSteps(task.planSteps);
  const draftContent = trimToNull(task.draftContent ?? task.draftPreview?.text ?? '');
  const showDraft = Boolean(draftContent) && !isPlaceholderDraftContent(draftContent);
  const isPlanLoading = task.planRequestState === 'loading' || !taskPlanSteps.length;
  const showDescription =
    Boolean(trimToNull(task.description)) &&
    !isDuplicateTaskDescription(task.description, task.name);
  const canCancelTask = task.status !== 'done' && !isCancelling;
  const firstVisibleSection =
    isPlanLoading || taskPlanSteps.length
      ? 'plan'
      : showDraft
        ? 'draft'
        : showClarifyingQuestion
          ? 'question'
          : null;

  return (
    <article
      className={`task-card ${isExpanded ? 'is-expanded' : ''} ${isCancelling ? 'is-removing' : ''}`}
    >
      <button
        type="button"
        className="task-card__summary"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        <span className={`task-card__dot tone-${statusMeta.tone}`} />
        <div className="task-card__heading">
          <div className="task-card__name">{task.name}</div>
          <div className="task-card__timestamp">{formatRelativeTime(task.updatedAt)}</div>
        </div>
        <span className={`task-card__pill tone-${statusMeta.tone}`}>{statusMeta.label}</span>
        <ChevronIcon className={`task-card__chevron ${isExpanded ? 'is-open' : ''}`} />
      </button>

      <div className={`task-card__body-shell ${isExpanded ? 'is-open' : ''}`}>
        <div className="task-card__body" onClick={(event) => event.stopPropagation()}>
          {showDescription ? <div className="task-description">{task.description}</div> : null}

          {task.sourceEmail ? (
            <div className="task-source-email">
              <button
                type="button"
                className="task-source-email__toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsEmailExpanded((current) => !current);
                }}
              >
                <span className="task-source-email__label">
                  {task.sourceEmail.senderName ?? task.sourceEmail.senderEmail ?? 'Original email'}
                </span>
                <ChevronIcon className={`task-source-email__chevron ${isEmailExpanded ? 'is-open' : ''}`} />
              </button>
              {isEmailExpanded ? (
                <div className="task-source-email__body">
                  {trimToNull(task.sourceEmail.fullBody ?? task.sourceEmail.body ?? '') ?? ''}
                </div>
              ) : null}
            </div>
          ) : null}

          {isPlanLoading ? (
            <div className="task-plan task-plan--loading">
              <div className={`task-section-label ${firstVisibleSection === 'plan' ? 'is-first' : ''}`}>
                Plan
              </div>
              <div className="task-loading">
                <div className="plan-spinner" />
                <span>Building the plan…</span>
              </div>
            </div>
          ) : null}

          {taskPlanSteps.length ? (
            <div className="task-plan">
              <div className={`task-section-label ${firstVisibleSection === 'plan' ? 'is-first' : ''}`}>
                Plan
              </div>
              {taskPlanSteps.map((step, index) => (
                <div key={`${task.id}-step-${index}`} className="task-step-row">
                  <span className="step-num">{index + 1}</span>
                  <span className="step-desc">{step.description}</span>
                  <span className={`tier-pill tier-${step.tier}`}>
                    {step.tier === 1 ? 'Auto' : step.tier === 2 ? 'Queued' : 'Review'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {showDraft ? (
            <div className="task-draft">
              <div className={`task-section-label ${firstVisibleSection === 'draft' ? 'is-first' : ''}`}>
                Draft
              </div>
              {isEditingDraft ? (
                <textarea
                  className="approval-card__textarea"
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  rows={8}
                />
              ) : (
                <div className="draft-body">{draftContent}</div>
              )}
              <div className="draft-actions">
                {isEditingDraft ? (
                  <>
                    <button
                      type="button"
                      className="btn-approve"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSaveDraft(task.id, draftText);
                        setIsEditingDraft(false);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn-edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDraftText(task.draftContent ?? task.draftPreview?.text ?? '');
                        setIsEditingDraft(false);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-approve"
                      onClick={(event) => {
                        event.stopPropagation();
                        onApproveDraft(task);
                      }}
                    >
                      Send for approval
                    </button>
                    <button
                      type="button"
                      className="btn-edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsEditingDraft(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-reject"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelTask(task);
                      }}
                    >
                      Cancel task
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {showClarifyingQuestion ? (
            <div className={`task-clarify ${isResolvingQuestion ? 'is-resolving' : ''}`}>
              <div className={`task-section-label ${firstVisibleSection === 'question' ? 'is-first' : ''}`}>
                Question
              </div>
              <div className="clarify-row">
                <span className="clarify-text">{task.clarifyingQuestion}</span>
                <div className="clarify-btns">
                  <button
                    type="button"
                    className={`btn-yes ${task.questionAnswer === 'yes' ? 'is-selected' : ''}`}
                    disabled={isResolvingQuestion}
                    onClick={(event) => {
                      event.stopPropagation();
                      resolveQuestion('yes');
                    }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className={`btn-no ${task.questionAnswer === 'no' ? 'is-selected' : ''}`}
                    disabled={isResolvingQuestion}
                    onClick={(event) => {
                      event.stopPropagation();
                      resolveQuestion('no');
                    }}
                  >
                    No
                  </button>
                </div>
              </div>
              <form
                className="note-row"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.stopPropagation();
                  if (customAnswer.trim()) {
                    submitCustomAnswer(event);
                    return;
                  }
                  submitNote(event);
                }}
              >
                <input
                  type="text"
                  value={customAnswer || note}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setCustomAnswer(nextValue);
                    setNote(nextValue);
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="note-input"
                  placeholder="Or type a note..."
                  disabled={isResolvingQuestion}
                />
                <button
                  type="submit"
                  className="btn-send"
                  onClick={(event) => event.stopPropagation()}
                  disabled={isResolvingQuestion}
                >
                  Send
                </button>
              </form>
            </div>
          ) : null}

          {showAnsweredState ? (
            <div className="task-answer">{formatTaskAnswer(task.questionAnswer)}</div>
          ) : null}

          {canCancelTask && (!showDraft || isEditingDraft) ? (
            <div className="task-card__footer-actions">
              <button
                type="button"
                className="btn-reject"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelTask(task);
                }}
              >
                Cancel task
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
