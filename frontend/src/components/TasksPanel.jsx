import React from 'react';
import { PlusIcon } from './icons.jsx';
import TaskCard from './TaskCard.jsx';
import { TASK_FILTERS } from '../utils/constants.js';

export default function TasksPanel({
  taskInput,
  onTaskInputChange,
  onTaskSubmit,
  taskFilter,
  onTaskFilterChange,
  showTaskComposer,
  onNewTaskClick,
  visibleTasks,
  removingTasks,
  expandedTaskId,
  onToggleTask,
  onAnswerQuestion,
  onNoteSubmit,
  onApproveDraft,
  onCancelTask,
  onSaveDraft,
}) {
  return (
    <section className="panel-scroll__inner tasks-panel">
      <div className="panel-heading panel-heading--row">
        <div className="filter-row" style={{ marginBottom: 0 }}>
          {TASK_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`filter-chip ${taskFilter === filter ? 'is-active' : ''}`}
              onClick={() => onTaskFilterChange(filter)}
            >
              {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        <button type="button" className="primary-button" aria-label="New task" onClick={onNewTaskClick}>
          <PlusIcon />
        </button>
      </div>

      {showTaskComposer ? (
        <form className="task-composer" onSubmit={onTaskSubmit}>
          <input
            type="text"
            className="task-composer__input"
            value={taskInput}
            onChange={(event) => onTaskInputChange(event.target.value)}
            placeholder="New task"
          />
          <button type="submit" className="task-composer__send">Add</button>
        </form>
      ) : null}

      {visibleTasks.length ? (
        <div className="task-list">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isExpanded={expandedTaskId === task.id}
              isCancelling={Boolean(removingTasks[task.id])}
              onToggle={() => onToggleTask(task.id)}
              onAnswerQuestion={onAnswerQuestion}
              onNoteSubmit={onNoteSubmit}
              onApproveDraft={onApproveDraft}
              onCancelTask={onCancelTask}
              onSaveDraft={onSaveDraft}
            />
          ))}
        </div>
      ) : (
        <div className="empty-card">No tasks</div>
      )}
    </section>
  );
}
