import React from 'react';
import { CheckCircleIcon, MailIcon, RejectIcon, ClockIcon } from './icons.jsx';
import { getActivityAppearance } from '../utils/format.js';
import { formatActivityTimestamp } from '../utils/format.js';

function ActivityGlyph({ icon }) {
  if (icon === 'check') return <CheckCircleIcon />;
  if (icon === 'mail') return <MailIcon />;
  if (icon === 'reject') return <RejectIcon />;
  return <ClockIcon />;
}

export default function ActivityList({ items, emptyText, showTimestamp = false }) {
  if (!items.length) {
    return <div className="empty-card">{emptyText}</div>;
  }

  return (
    <div className="activity-list">
      {items.map((item, index) => {
        const appearance = getActivityAppearance(item.type);
        return (
          <article
            key={item.id}
            className={`activity-item ${index === items.length - 1 ? 'is-last' : ''}`}
          >
            <div className={`activity-item__icon tone-${appearance.tone}`}>
              <ActivityGlyph icon={appearance.icon} />
            </div>
            <div className="activity-item__content">
              <div className="activity-item__row">
                <div className="activity-item__name">{item.title}</div>
                {showTimestamp ? (
                  <div className="activity-item__time">
                    {formatActivityTimestamp(item.createdAt ?? item.timestamp)}
                  </div>
                ) : null}
              </div>
              <div className="activity-item__description">{item.description}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
