import React from 'react';

function IconBase({ children, className = '' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ui-icon ${className}`.trim()}
    >
      {children}
    </svg>
  );
}

export function HouseIcon() {
  return (
    <IconBase>
      <path d="M2.4 7.1 8 2.8l5.6 4.3" />
      <path d="M3.8 6.2v7h8.4v-7" />
    </IconBase>
  );
}

export function TaskListIcon() {
  return (
    <IconBase>
      <path d="M4.9 4.4h8" />
      <path d="M4.9 8h8" />
      <path d="M4.9 11.6h8" />
      <path d="M2.8 4.4h.1" />
      <path d="M2.8 8h.1" />
      <path d="M2.8 11.6h.1" />
    </IconBase>
  );
}

export function CheckCircleIcon() {
  return (
    <IconBase>
      <circle cx="8" cy="8" r="5.8" />
      <path d="m5.7 8.1 1.5 1.5 3.2-3.3" />
    </IconBase>
  );
}

export function LinesIcon() {
  return (
    <IconBase>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h9" />
      <path d="M2.5 11.5h7" />
    </IconBase>
  );
}

export function ArrowRightIcon() {
  return (
    <IconBase>
      <path d="M3 8h9.2" />
      <path d="m9 4.9 3.2 3.1L9 11.1" />
    </IconBase>
  );
}

export function ArrowLeftIcon() {
  return (
    <IconBase>
      <path d="M13 8H3.8" />
      <path d="M7 4.9 3.8 8 7 11.1" />
    </IconBase>
  );
}

export function LinkIcon() {
  return (
    <IconBase>
      <path d="M6.1 10 4.7 11.4a2.6 2.6 0 0 1-3.7-3.7L3 5.7" />
      <path d="m9.9 6 1.4-1.4A2.6 2.6 0 1 1 15 8.3l-2 2" />
      <path d="m5.5 10.5 5-5" />
    </IconBase>
  );
}

export function PlusIcon() {
  return (
    <IconBase>
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </IconBase>
  );
}

export function ChevronIcon({ className = '' }) {
  return (
    <IconBase className={className}>
      <path d="m6 4.6 3.8 3.4L6 11.4" />
    </IconBase>
  );
}

export function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, display: 'block' }}
      className="ui-icon"
      aria-hidden="true"
    >
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DatabaseIcon() {
  return (
    <IconBase>
      <ellipse cx="8" cy="4.2" rx="4.6" ry="1.8" />
      <path d="M3.4 4.2v4.1c0 1 2 1.8 4.6 1.8s4.6-.8 4.6-1.8V4.2" />
      <path d="M3.4 8.3v3.5c0 1 2 1.8 4.6 1.8s4.6-.8 4.6-1.8V8.3" />
    </IconBase>
  );
}

export function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="ui-icon"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 3V5.25M12 18.75V21M21 12H18.75M5.25 12H3M18.36 5.64l-1.59 1.59M7.23 16.77l-1.59 1.59M18.36 18.36l-1.59-1.59M7.23 7.23 5.64 5.64"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="ui-icon"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <IconBase>
      <path d="M6.1 3.2H3.7a1.2 1.2 0 0 0-1.2 1.2v7.2a1.2 1.2 0 0 0 1.2 1.2h2.4" />
      <path d="M9.1 5.2 12 8l-2.9 2.8" />
      <path d="M5 8h7" />
    </IconBase>
  );
}

export function MailIcon() {
  return (
    <IconBase>
      <rect x="2.2" y="3.3" width="11.6" height="9.4" rx="1.6" />
      <path d="m2.9 4.4 5.1 4 5.1-4" />
    </IconBase>
  );
}

export function ClockIcon() {
  return (
    <IconBase>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M8 5.2v3.1l2 1.4" />
    </IconBase>
  );
}

export function RejectIcon() {
  return (
    <IconBase>
      <circle cx="8" cy="8" r="5.7" />
      <path d="m6.1 6.1 3.8 3.8" />
      <path d="m9.9 6.1-3.8 3.8" />
    </IconBase>
  );
}

export function FunnelIcon() {
  return (
    <IconBase>
      <path d="M2 3h12l-4.5 5.5v4.5l-3-1.5V8.5Z" />
    </IconBase>
  );
}

export function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="connection-logo">
      <path
        fill="#4285f4"
        d="M24 14.3c0-.78-.07-1.52-.2-2.24H14v4.24h5.6a4.78 4.78 0 0 1-2.08 3.14v2.6h3.36c1.96-1.8 3.12-4.47 3.12-7.77Z"
      />
      <path
        fill="#34a853"
        d="M14 24.5c2.8 0 5.15-.93 6.87-2.53l-3.36-2.6c-.93.63-2.12 1-3.5 1-2.7 0-4.98-1.82-5.8-4.27H4.74v2.69A10.38 10.38 0 0 0 14 24.5Z"
      />
      <path
        fill="#fbbc04"
        d="M8.2 16.15A6.22 6.22 0 0 1 7.88 14c0-.75.12-1.48.33-2.15V9.16H4.74A10.42 10.42 0 0 0 3.5 14c0 1.67.4 3.24 1.24 4.84l3.46-2.69Z"
      />
      <path
        fill="#ea4335"
        d="M14 7.58c1.52 0 2.89.52 3.96 1.54l2.97-2.97C19.15 4.49 16.8 3.5 14 3.5a10.38 10.38 0 0 0-9.26 5.66l3.47 2.69c.8-2.45 3.08-4.27 5.79-4.27Z"
      />
    </svg>
  );
}

export function XeroIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" className="connection-logo">
      <circle cx="50" cy="50" r="50" fill="#13B5EA" />
      <path
        fill="white"
        d="M74.9 25.1c-1.5-1.5-3.9-1.5-5.4 0L50 44.6 30.5 25.1c-1.5-1.5-3.9-1.5-5.4 0s-1.5 3.9 0 5.4L44.6 50 25.1 69.5c-1.5 1.5-1.5 3.9 0 5.4.7.7 1.7 1.1 2.7 1.1s2-.4 2.7-1.1L50 55.4l19.5 19.5c.7.7 1.7 1.1 2.7 1.1s2-.4 2.7-1.1c1.5-1.5 1.5-3.9 0-5.4L55.4 50l19.5-19.5c1.5-1.5 1.5-3.9 0-5.4z"
      />
    </svg>
  );
}
