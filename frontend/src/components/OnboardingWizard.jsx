import React, { useState } from 'react';
import { GoogleIcon, XeroIcon, ArrowRightIcon } from './icons.jsx';

const STEPS = ['connect', 'business', 'preferences', 'launch'];
const STEP_LABELS = ['Connect', 'Your business', 'Preferences', 'Ready'];

const BUSINESS_QUESTIONS = [
  { key: 'business_name', label: 'Business name', placeholder: 'e.g. Alpine Guides Ltd' },
  { key: 'business_type', label: 'What type of business?', placeholder: 'e.g. Tourism, Trades, Consulting' },
  { key: 'owner_email', label: 'Your email address', placeholder: 'you@example.com', type: 'email' },
  { key: 'location', label: 'Where are you based?', placeholder: 'e.g. Queenstown, NZ' },
  { key: 'pricing_range', label: 'Typical job value', placeholder: 'e.g. $200–$500 per session' },
  { key: 'payment_terms', label: 'Payment terms', placeholder: 'e.g. Invoice on completion, 14 days' },
  { key: 'gst_registered', label: 'GST registered?', placeholder: 'yes or no' },
  { key: 'reply_tone', label: 'How should replies sound?', placeholder: 'e.g. Friendly but professional' },
];

const PREFERENCE_QUESTIONS = [
  { key: 'reschedule_policy', label: 'Rescheduling policy', placeholder: 'e.g. 48 hours notice required' },
  { key: 'no_show_handling', label: 'No-show handling', placeholder: 'e.g. Charge 50% of booking' },
];

export default function OnboardingWizard({
  onComplete,
  onGoogleConnect,
  onXeroConnect,
  googleConnected,
  xeroConnected,
  googleBusy,
  xeroBusy,
}) {
  const [step, setStep] = useState(0);
  const [businessData, setBusinessData] = useState({});
  const [preferenceData, setPreferenceData] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const currentStepId = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  function handleBusinessChange(key, value) {
    setBusinessData((prev) => ({ ...prev, [key]: value }));
  }

  function handlePreferenceChange(key, value) {
    setPreferenceData((prev) => ({ ...prev, [key]: value }));
  }

  function canProceed() {
    if (currentStepId === 'connect') return googleConnected;
    if (currentStepId === 'business') return Boolean(businessData.business_name?.trim());
    return true;
  }

  async function handleNext() {
    if (!canProceed()) return;

    if (isLastStep) {
      setIsSubmitting(true);
      setError('');
      try {
        await onComplete({ ...businessData, ...preferenceData });
      } catch {
        setError('Could not complete setup. Please try again.');
        setIsSubmitting(false);
      }
      return;
    }

    setStep((s) => s + 1);
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <div className="wordmark" aria-label="Olivander">
            <span className="wordmark__o">O</span>
            <span className="wordmark__rest">livander</span>
          </div>
          <p className="onboarding-header__sub">Let's get you set up in a few steps.</p>
        </div>

        <div className="onboarding-stepper">
          {STEP_LABELS.map((label, index) => (
            <div key={label} className={`onboarding-step ${index === step ? 'is-active' : ''} ${index < step ? 'is-done' : ''}`}>
              <div className="onboarding-step__dot" />
              <span className="onboarding-step__label">{label}</span>
            </div>
          ))}
        </div>

        <div className="onboarding-body">
          {currentStepId === 'connect' && (
            <div className="onboarding-section">
              <h3 className="onboarding-section__title">Connect your accounts</h3>
              <p className="onboarding-section__hint">
                Gmail and Calendar are needed for the core workflows. Xero is optional — connect it if you want invoice automation.
              </p>

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
                  disabled={googleBusy || googleConnected}
                  onClick={onGoogleConnect}
                >
                  {googleBusy ? 'Connecting...' : googleConnected ? 'Connected' : 'Connect Google'}
                </button>
              </div>

              <div className="connection-row">
                <div className="connection-row__left">
                  <XeroIcon />
                  <div>
                    <div className="connection-row__name">Xero</div>
                    <div className="connection-row__meta">Invoices · Contacts (optional)</div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`connection-button ${xeroConnected ? 'is-connected' : 'is-primary'}`}
                  disabled={xeroBusy || xeroConnected}
                  onClick={onXeroConnect}
                >
                  {xeroBusy ? 'Connecting...' : xeroConnected ? 'Connected' : 'Connect Xero'}
                </button>
              </div>

              {!googleConnected && (
                <p className="onboarding-section__required">Google connection is required to continue.</p>
              )}
            </div>
          )}

          {currentStepId === 'business' && (
            <div className="onboarding-section">
              <h3 className="onboarding-section__title">Tell us about your business</h3>
              <p className="onboarding-section__hint">
                This is stored in your business memory and shapes every reply and task.
              </p>
              <div className="onboarding-fields">
                {BUSINESS_QUESTIONS.map((q) => (
                  <div key={q.key} className="onboarding-field">
                    <label className="onboarding-field__label" htmlFor={`biz-${q.key}`}>
                      {q.label}
                    </label>
                    <input
                      id={`biz-${q.key}`}
                      type={q.type || 'text'}
                      className="onboarding-field__input"
                      placeholder={q.placeholder}
                      value={businessData[q.key] ?? ''}
                      onChange={(e) => handleBusinessChange(q.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStepId === 'preferences' && (
            <div className="onboarding-section">
              <h3 className="onboarding-section__title">Set your preferences</h3>
              <p className="onboarding-section__hint">
                These policies guide how Olivander handles edge cases on your behalf.
              </p>
              <div className="onboarding-fields">
                {PREFERENCE_QUESTIONS.map((q) => (
                  <div key={q.key} className="onboarding-field">
                    <label className="onboarding-field__label" htmlFor={`pref-${q.key}`}>
                      {q.label}
                    </label>
                    <input
                      id={`pref-${q.key}`}
                      type="text"
                      className="onboarding-field__input"
                      placeholder={q.placeholder}
                      value={preferenceData[q.key] ?? ''}
                      onChange={(e) => handlePreferenceChange(q.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStepId === 'launch' && (
            <div className="onboarding-section onboarding-section--center">
              <h3 className="onboarding-section__title">You're ready to go</h3>
              <p className="onboarding-section__hint">
                Olivander will start watching your inbox and queueing actions for your approval.
                Nothing is sent without your sign-off.
              </p>
              <ul className="onboarding-launch-list">
                <li>Email triage — classify and draft replies</li>
                <li>Booking requests — propose calendar slots</li>
                {xeroConnected && <li>Invoice creation — queued for approval</li>}
                <li>All actions require your approval before executing</li>
              </ul>
            </div>
          )}
        </div>

        {error ? <div className="inline-error onboarding-error">{error}</div> : null}

        <div className="onboarding-footer">
          {step > 0 && (
            <button
              type="button"
              className="onboarding-back"
              onClick={() => setStep((s) => s - 1)}
              disabled={isSubmitting}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="connection-button is-primary onboarding-next"
            disabled={!canProceed() || isSubmitting}
            onClick={() => void handleNext()}
          >
            {isLastStep ? (isSubmitting ? 'Saving...' : 'Launch Olivander') : (
              <>Next <ArrowRightIcon /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
