import React from 'react';
import { GoogleIcon, XeroIcon, SunIcon, MoonIcon } from './icons.jsx';
import MemoryPanel from './MemoryPanel.jsx';
import FiltersPanel from './FiltersPanel.jsx';
import { PLAN_CONFIG, PLAN_KEYS } from '../utils/firstCustomer.js';

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
  plan,
  onPlanChange,
}) {
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

      {activeSection === 'plan' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Plan</div>
          <div className="plan-settings-grid">
            {[PLAN_CONFIG[PLAN_KEYS.starter], PLAN_CONFIG[PLAN_KEYS.plus]].map((item) => {
              const active = item.key === plan;
              return (
                <article key={item.key} className={`plan-settings-card ${active ? 'is-active' : ''}`.trim()}>
                  <div className="plan-settings-card__top">
                    <div>
                      <h3>{item.label}</h3>
                      <p>{item.price}</p>
                    </div>
                    {active ? <span className="plan-settings-card__badge">Current</span> : null}
                  </div>
                  <p className="plan-settings-card__promise">{item.promise}</p>
                  <ul>
                    {item.includes.slice(0, 5).map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                  {item.locked.length ? (
                    <div className="plan-settings-card__locked">
                      Locked on Starter: {item.locked.join(', ')}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={`connection-button ${active ? 'is-connected' : 'is-primary'}`}
                    onClick={() => onPlanChange(item.key)}
                    disabled={active}
                  >
                    {active ? 'Selected' : `Switch to ${item.label}`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeSection === 'memory' ? (
        <section className="settings-section settings-section--memory">
          <div className="settings-section__heading">Memory</div>
          <MemoryPanel
            profile={profile}
            isLoading={isMemoryLoading}
            memoryError={memoryError}
            onSave={onSaveMemory}
          />
        </section>
      ) : null}

      {activeSection === 'filters' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Filters</div>
          <FiltersPanel profile={profile} onSave={onSaveMemory} />
        </section>
      ) : null}

      {activeSection === 'privacy' ? (
        <section className="settings-section">
          <div className="settings-section__heading">Privacy</div>

          <div className="privacy-row">
            <div className="privacy-row__title">Data we store</div>
            <div className="privacy-row__body">
              Olivander stores your Gmail and Google Calendar access tokens (encrypted), your business memory profile, and a log of actions taken in your account. No email content is stored permanently — only the draft and classification result for each approval.
            </div>
          </div>

          <div className="privacy-row">
            <div className="privacy-row__title">How your data is used</div>
            <div className="privacy-row__body">
              Your business memory (name, tone, pricing) is sent to Groq&apos;s API to generate email drafts. No customer email content is used to train AI models. Groq&apos;s data retention policy applies to API calls.
            </div>
          </div>

          <div className="privacy-row">
            <div className="privacy-row__title">Data deletion</div>
            <div className="privacy-row__body">
              Disconnecting Google removes your stored access tokens immediately. To delete your account and all associated data, email <a href="mailto:hello@olivander.app" className="privacy-link">hello@olivander.app</a>.
            </div>
          </div>

          <div className="privacy-row">
            <div className="privacy-row__title">Third-party services</div>
            <div className="privacy-row__body">
              Google (Gmail, Calendar), Xero (invoicing), Groq (AI), and Supabase (database). Each operates under its own privacy policy.
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
