import React from 'react';
import { GoogleIcon, XeroIcon, SunIcon, MoonIcon } from './icons.jsx';
import MemoryPanel from './MemoryPanel.jsx';
import FiltersPanel from './FiltersPanel.jsx';
import { hasMemoryData } from '../utils/memory.js';

export default function SettingsPanel({
  activeSection,
  googleConnected,
  googleBusy,
  xeroConnected,
  xeroBusy,
  onGoogleToggle,
  onXeroConnect,
  onThemeToggle,
  theme,
  profile,
  isMemoryLoading,
  memoryError,
  onSaveMemory,
}) {
  const showMemoryEmptyState = !isMemoryLoading && !hasMemoryData(profile);
  const nextThemeLabel = theme === 'dark' ? 'Switch to light' : 'Switch to dark';
  const nextThemeIcon = theme === 'dark' ? <MoonIcon /> : <SunIcon />;

  return (
    <section className="panel-scroll__inner settings-panel">
      {activeSection === 'connections' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Connections</div>

          <div className="connection-row">
            <div className="connection-row__left">
              <GoogleIcon />
              <div>
                <div className="connection-row__name">Google Workspace</div>
                <div className="connection-row__meta">Gmail · Calendar</div>
              </div>
            </div>
            <button
              type="button"
              className={`connection-button ${googleConnected ? 'is-connected' : 'is-primary'}`}
              disabled={googleBusy}
              onClick={onGoogleToggle}
            >
              {googleBusy
                ? googleConnected ? 'Connected' : 'Connecting...'
                : googleConnected ? 'Connected' : 'Connect Google'}
            </button>
          </div>

          <div className="connection-row">
            <div className="connection-row__left">
              <XeroIcon />
              <div>
                <div className="connection-row__name">Xero</div>
                <div className="connection-row__meta">Invoices · Contacts</div>
              </div>
            </div>
            <button
              type="button"
              className={`connection-button ${xeroConnected ? 'is-connected' : 'is-primary'}`}
              disabled={xeroBusy}
              onClick={onXeroConnect}
            >
              {xeroBusy
                ? xeroConnected ? 'Connected' : 'Connecting...'
                : xeroConnected ? 'Connected' : 'Connect Xero'}
            </button>
          </div>
        </section>
      ) : null}

      {activeSection === 'appearance' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Appearance</div>
          <div className="settings-option-row">
            <div>
              <div className="tier-row__name">Theme</div>
            </div>
            <button type="button" className="connection-button is-primary" onClick={onThemeToggle}>
              {nextThemeIcon}
              <span>{nextThemeLabel}</span>
            </button>
          </div>
        </section>
      ) : null}

      {activeSection === 'memory' ? (
        <section className="settings-section settings-section--memory">
          <div className="settings-section__heading">Memory</div>
          {memoryError ? <div className="inline-error">{memoryError}</div> : null}
          {showMemoryEmptyState ? (
            <div className="settings-empty-state">Nothing saved yet.</div>
          ) : (
            <MemoryPanel profile={profile} isLoading={isMemoryLoading} memoryError="" />
          )}
        </section>
      ) : null}

      {activeSection === 'filters' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Filters</div>
          <FiltersPanel profile={profile} onSave={onSaveMemory} />
        </section>
      ) : null}
    </section>
  );
}
