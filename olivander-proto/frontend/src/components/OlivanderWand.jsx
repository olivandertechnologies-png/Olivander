import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const FLICK_HIDE_GLOW_MS = 440;
const FLICK_DURATION_MS = 580;

const WandContext = createContext(null);

export function WandProvider({ children }) {
  const [wandStateValue, setWandStateValue] = useState('inactive');
  const [flashState, setFlashState] = useState(null);
  const [isFlicking, setIsFlicking] = useState(false);
  const [hideGlow, setHideGlow] = useState(false);
  const stateRef = useRef('inactive');
  const flickGlowTimerRef = useRef(null);
  const flickTimerRef = useRef(null);
  const flashTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (flickGlowTimerRef.current) {
        window.clearTimeout(flickGlowTimerRef.current);
      }

      if (flickTimerRef.current) {
        window.clearTimeout(flickTimerRef.current);
      }

      if (flashTimerRef.current) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const flick = useCallback(() => {
    if (flickGlowTimerRef.current) {
      window.clearTimeout(flickGlowTimerRef.current);
    }

    if (flickTimerRef.current) {
      window.clearTimeout(flickTimerRef.current);
    }

    setIsFlicking(true);
    setHideGlow(true);

    flickGlowTimerRef.current = window.setTimeout(() => {
      setHideGlow(false);
    }, FLICK_HIDE_GLOW_MS);

    flickTimerRef.current = window.setTimeout(() => {
      setIsFlicking(false);
    }, FLICK_DURATION_MS);
  }, []);

  const setWandState = useCallback(
    (nextState) => {
      if (
        nextState === 'processing' &&
        (stateRef.current === 'inactive' || stateRef.current === 'active')
      ) {
        flick();
      }

      stateRef.current = nextState;
      setWandStateValue(nextState);
    },
    [flick],
  );

  const flashWandState = useCallback((nextState, duration) => {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current);
    }

    setFlashState(nextState);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashState(null);
    }, duration);
  }, []);

  const wandState = hideGlow ? 'inactive' : flashState ?? wandStateValue;

  const value = useMemo(
    () => ({
      flick,
      flashWandState,
      isFlicking,
      setWandState,
      wandState,
    }),
    [flick, flashWandState, isFlicking, setWandState, wandState],
  );

  return <WandContext.Provider value={value}>{children}</WandContext.Provider>;
}

export function useWandState() {
  const context = useContext(WandContext);

  if (!context) {
    throw new Error('useWandState must be used within WandProvider.');
  }

  return context;
}

export default function OlivanderWand({ state }) {
  const { isFlicking, wandState } = useWandState();
  const currentState = state ?? wandState;

  return (
    <svg
      width="52"
      height="52"
      viewBox="0 0 80 80"
      fill="none"
      overflow="visible"
      aria-hidden="true"
      id="wand-svg"
      className={`wand wand--${currentState} ${isFlicking ? 'is-flicking' : ''}`}
      style={{
        background: 'transparent',
        display: 'block',
        flexShrink: 0,
        transformOrigin: '70px 65px',
        transformBox: 'fill-box',
      }}
    >
      <defs>
        <linearGradient id="wand-body-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6A6560" />
          <stop offset="45%" stopColor="#3A3633" />
          <stop offset="100%" stopColor="#0E0C0A" />
        </linearGradient>
        <linearGradient id="wand-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,248,240,0.22)" />
          <stop offset="60%" stopColor="rgba(255,248,240,0.04)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
        <filter id="wand-aura-f" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="wand-orb-f" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>

      <path
        className="wand-body"
        fill="url(#wand-body-grad)"
        d="M 64 74
           L 11 15
           A 2.5 2.5 0 0 1 17 9
           L 76 62
           A 7 7 0 0 1 64 74
           Z"
      />
      <path
        className="wand-highlight"
        fill="url(#wand-sheen)"
        d="M 64 74
           L 11 15
           A 2.5 2.5 0 0 1 17 9
           L 76 62
           A 7 7 0 0 1 64 74
           Z"
      />
      <line
        className="wand-collar"
        x1="33"
        y1="43"
        x2="43"
        y2="51"
        stroke="rgba(0,0,0,0.32)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        className="wand-collar"
        x1="37"
        y1="40"
        x2="47"
        y2="48"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <line
        className="tip-shimmer"
        x1="68"
        y1="68"
        x2="14"
        y2="12"
        stroke="rgba(218,210,255,0.9)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="10 90"
        strokeDashoffset="90"
        opacity="0"
      />

      <circle
        className="tip-aura"
        cx="14"
        cy="12"
        r="13"
        fill="#5A4FD0"
        filter="url(#wand-aura-f)"
        opacity="0"
      />
      <circle
        className="tip-aura-g"
        cx="14"
        cy="12"
        r="13"
        fill="#2E7D52"
        filter="url(#wand-aura-f)"
        opacity="0"
      />
      <circle
        className="tip-aura-r"
        cx="14"
        cy="12"
        r="13"
        fill="#C42B2B"
        filter="url(#wand-aura-f)"
        opacity="0"
      />
      <circle
        className="tip-orb"
        cx="14"
        cy="12"
        r="4"
        fill="#8377E8"
        filter="url(#wand-orb-f)"
        opacity="0"
      />
      <circle className="tip-spark" cx="14" cy="12" r="1.4" fill="white" opacity="0" />
    </svg>
  );
}
