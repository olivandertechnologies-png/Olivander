import React from 'react';
import ActivityList from './ActivityList.jsx';
import { ACTIVITY_FILTERS } from '../utils/constants.js';

export default function ActivityPanel({ activityFilter, onActivityFilterChange, activityItems, recentEmailsError }) {
  return (
    <section className="panel-scroll__inner activity-panel">
      <div className="filter-row filter-row--spacious">
        {ACTIVITY_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`filter-chip ${activityFilter === filter ? 'is-active' : ''}`}
            onClick={() => onActivityFilterChange(filter)}
          >
            {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>
      <ActivityList items={activityItems} emptyText="No activity" showTimestamp />
      {recentEmailsError ? <div className="inline-error">{recentEmailsError}</div> : null}
    </section>
  );
}
