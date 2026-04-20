import React, { useState, useEffect, useRef } from 'react';
import { GoogleIcon, XeroIcon, ArrowRightIcon } from './icons.jsx';

const STEPS = ['connect', 'chat', 'launch'];
const STEP_LABELS = ['Connect', 'About you', 'Ready'];

const CHAT_QUESTIONS = [
  {
    key: 'business_name',
    text: "Let's get to know your business. What's it called?",
    placeholder: 'e.g. Alpine Guides Ltd',
    optional: false,
  },
  {
    key: 'business_type',
    text: 'What kind of work do you do?',
    placeholder: 'e.g. Mountain guiding, landscaping, consulting',
    optional: false,
  },
  {
    key: 'location',
    text: 'And where are you based?',
    placeholder: 'e.g. Queenstown, NZ',
    optional: false,
  },
  {
    key: 'reply_tone',
    text: 'How should I sound when I reply on your behalf?',
    placeholder: 'e.g. Friendly but professional',
    optional: false,
  },
  {
    key: 'pricing_range',
    text: "What's a typical job worth?",
    placeholder: 'e.g. $200–$500 per session',
    optional: true,
  },
  {
    key: 'payment_terms',
    text: 'When do you usually invoice?',
    placeholder: 'e.g. Invoice on completion, 14-day terms',
    optional: true,
  },
  {
    key: 'gst_registered',
    text: 'Are you GST registered?',
    placeholder: '',
    optional: true,
    quickReplies: ['Yes', 'No'],
  },
  {
    key: 'reschedule_policy',
    text: "What's your rescheduling policy?",
    placeholder: 'e.g. 48 hours notice required',
    optional: true,
  },
  {
    key: 'no_show_handling',
    text: 'How do you handle no-shows?',
    placeholder: 'e.g. Charge 50% of booking value',
    optional: true,
  },
];

let _msgId = 0;
function nextId() { return ++_msgId; }

// Brief reactions shown after each answer before the next question
const REACTIONS = {
  business_name:     (a) => `${a} — love it.`,
  location:          ()  => 'Good to know.',
  reply_tone:        ()  => "Got it, I'll keep that in mind.",
  pricing_range:     ()  => 'Helpful.',
  payment_terms:     ()  => 'Noted.',
  gst_registered:    (a) => a === 'Yes' ? "I'll include GST on invoices." : 'No GST — noted.',
  reschedule_policy: ()  => 'Makes sense.',
  no_show_handling:  ()  => 'Good to know.',
};

function getAck(key, answer) {
  return REACTIONS[key]?.(answer) ?? null;
}

export default function OnboardingWizard({
  onComplete,
  onSaveMemory,
  onGoogleConnect,
  onXeroConnect,
  googleConnected,
  xeroConnected,
  googleBusy,
  xeroBusy,
}) {
  const [step, setStep] = useState(0);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [chatComplete, setChatComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Focus input after AI finishes "typing"
  useEffect(() => {
    if (step === 1 && !isTyping && !chatComplete) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [questionIndex, isTyping, step, chatComplete]);

  // Init / reset chat whenever step changes
  useEffect(() => {
    // Reset chat state on every step change first
    setMessages([]);
    setQuestionIndex(0);
    setChatComplete(false);
    setIsTyping(false);
    setInputValue('');

    if (step !== 1) return;

    // Entering the chat step — show typing indicator then first question
    setIsTyping(true);
    const t = setTimeout(() => {
      setIsTyping(false);
      setMessages([{ id: nextId(), role: 'ai', text: CHAT_QUESTIONS[0].text }]);
    }, 700);
    return () => clearTimeout(t);
  }, [step]);

  function addAiMessage(text) {
    setMessages((prev) => [...prev, { id: nextId(), role: 'ai', text }]);
  }

  function addUserMessage(text) {
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
  }

  function advanceQuestion(fromIndex) {
    const next = fromIndex + 1;
    if (next >= CHAT_QUESTIONS.length) {
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        addAiMessage("That's everything I need. You're all set.");
        setChatComplete(true);
      }, 800);
      return;
    }
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      addAiMessage(CHAT_QUESTIONS[next].text);
      setQuestionIndex(next);
    }, 700);
  }

  async function handleSend(value) {
    const text = (value !== undefined ? value : inputValue).trim();
    if (!text || isTyping || isSaving) return;

    addUserMessage(text);
    setInputValue('');

    const q = CHAT_QUESTIONS[questionIndex];
    if (onSaveMemory && q?.key) {
      setIsSaving(true);
      try { await onSaveMemory(q.key, text); } catch { /* non-fatal */ }
      setIsSaving(false);
    }

    const ack = q?.key ? getAck(q.key, text) : null;
    if (ack) {
      // Show ack bubble, then a beat, then typing → next question
      setTimeout(() => {
        addAiMessage(ack);
        setTimeout(() => advanceQuestion(questionIndex), 250);
      }, 350);
    } else {
      advanceQuestion(questionIndex);
    }
  }

  function handleSkip() {
    if (isTyping) return;
    advanceQuestion(questionIndex);
  }

  function canProceed() {
    if (step === 0) return googleConnected;
    if (step === 1) return chatComplete;
    return true;
  }

  async function handleNext() {
    if (!canProceed()) return;
    if (step < STEPS.length - 1) { setStep((s) => s + 1); return; }
    setIsSubmitting(true);
    setError('');
    try {
      await onComplete({});
    } catch {
      setError('Could not complete setup. Please try again.');
      setIsSubmitting(false);
    }
  }

  const currentQ = CHAT_QUESTIONS[questionIndex];

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">

        {/* Header */}
        <div className="onboarding-header">
          <div className="wordmark" aria-label="Olivander">
            <span className="wordmark__o">O</span>
            <span className="wordmark__rest">livander</span>
          </div>
          <p className="onboarding-header__sub">Let's get you set up in a few steps.</p>
        </div>

        {/* Stepper */}
        <div className="onboarding-stepper">
          {STEP_LABELS.map((label, index) => (
            <React.Fragment key={label}>
              <div className={`onboarding-step ${index === step ? 'is-active' : ''} ${index < step ? 'is-done' : ''}`}>
                <div className="onboarding-step__dot" />
                <span className="onboarding-step__label">{label}</span>
              </div>
              {index < STEP_LABELS.length - 1 && (
                <div className={`onboarding-step__line ${index < step ? 'is-done' : ''}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Body — key forces remount + re-animation on step change */}
        <div className="onboarding-body" key={step}>

          {/* Step 0: Connect */}
          {step === 0 && (
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

          {/* Step 1: Chat */}
          {step === 1 && (
            <div className="ob-chat">
              {/* Messages */}
              <div className="ob-chat__messages">
                {messages.map((msg) => (
                  <div key={msg.id} className={`ob-bubble ob-bubble--${msg.role}`}>
                    {msg.text}
                  </div>
                ))}
                {isTyping && (
                  <div className="ob-bubble ob-bubble--ai ob-typing">
                    <span /><span /><span />
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              {!chatComplete && !isTyping && (
                <div className="ob-input-wrap">
                  {currentQ?.quickReplies ? (
                    <div className="ob-quick-replies">
                      {currentQ.quickReplies.map((reply) => (
                        <button
                          key={reply}
                          type="button"
                          className="ob-quick-reply"
                          onClick={() => void handleSend(reply)}
                        >
                          {reply}
                        </button>
                      ))}
                      {currentQ.optional && (
                        <button type="button" className="ob-skip" onClick={handleSkip}>Skip</button>
                      )}
                    </div>
                  ) : (
                    <div className="ob-input">
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        placeholder={currentQ?.placeholder || 'Type your answer…'}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleSend(); }}
                        disabled={isSaving}
                      />
                      <button
                        type="button"
                        className="ob-send"
                        onClick={() => void handleSend()}
                        disabled={!inputValue.trim() || isSaving}
                        aria-label="Send"
                      >
                        <ArrowRightIcon />
                      </button>
                      {currentQ?.optional && (
                        <button type="button" className="ob-skip" onClick={handleSkip}>Skip</button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Ready */}
          {step === 2 && (
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

        {error && <div className="inline-error onboarding-error">{error}</div>}

        {/* Footer */}
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
          {(step !== 1 || chatComplete) && (
            <button
              type="button"
              className="connection-button is-primary onboarding-next"
              disabled={!canProceed() || isSubmitting}
              onClick={() => void handleNext()}
            >
              {step === STEPS.length - 1
                ? (isSubmitting ? 'Saving…' : 'Launch Olivander')
                : <><span>Continue</span><ArrowRightIcon /></>
              }
            </button>
          )}
        </div>

        {/* Legal links */}
        <p className="onboarding-legal">
          By continuing you agree to our{' '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
