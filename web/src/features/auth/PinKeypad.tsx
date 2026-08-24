import { useEffect, useRef, useState, type ReactNode } from 'react';
import './PinKeypad.css';

const KEYS: (string | null)[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'back'];

const LETTERS: Record<string, string> = {
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
};

function BackspaceIcon() {
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M9.2 1.2h14.3A2.5 2.5 0 0 1 26 3.7v10.6a2.5 2.5 0 0 1-2.5 2.5H9.2L1.4 9l7.8-7.8zm7.1 3.4-1.1 1.1-2.1-2.1-1.5 1.5 2.1 2.1-2.1 2.1 1.5 1.5 2.1-2.1 2.1 2.1 1.5-1.5-2.1-2.1 2.1-2.1-1.5-1.5z"
      />
    </svg>
  );
}

export type PinKeypadProps = {
  title: string;
  error?: string;
  busy?: boolean;
  /** Increment to clear digits (no shake). */
  resetSignal?: number;
  /** Increment to clear digits and shake the indicator. */
  failSignal?: number;
  onComplete: (pin: string) => void;
  footer?: ReactNode;
};

/** On-screen 6-digit PIN keypad. Digits are never displayed. */
export default function PinKeypad({
  title,
  error,
  busy = false,
  resetSignal = 0,
  failSignal = 0,
  onComplete,
  footer,
}: PinKeypadProps) {
  const [digits, setDigits] = useState('');
  const [shaking, setShaking] = useState(false);
  const completingRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const clearDigits = (withShake: boolean) => {
    setDigits('');
    completingRef.current = false;
    if (!withShake) return;
    setShaking(true);
    window.setTimeout(() => setShaking(false), 420);
  };

  useEffect(() => {
    if (resetSignal === 0) return;
    clearDigits(false);
  }, [resetSignal]);

  useEffect(() => {
    if (failSignal === 0) return;
    clearDigits(true);
  }, [failSignal]);

  useEffect(() => {
    if (digits.length !== 6 || completingRef.current || busy) return;
    completingRef.current = true;
    onCompleteRef.current(digits);
  }, [digits, busy]);

  const press = (key: string) => {
    if (busy || completingRef.current) return;
    if (key === 'back') {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    setDigits((d) => (d.length >= 6 ? d : d + key));
  };

  return (
    <div className="pin-keypad" aria-label="PIN entry">
      <div className="pin-keypad__title">{title}</div>

      <div
        className={`pin-keypad__indicator${shaking ? ' pin-keypad__indicator--shake' : ''}`}
        role="status"
        aria-label={`${digits.length} of 6 digits entered`}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={`pin-keypad__dot${i < digits.length ? ' pin-keypad__dot--filled' : ''}`}
          />
        ))}
      </div>

      {error ? <div className="pin-keypad__error">{error}</div> : <div className="pin-keypad__error" />}

      <div className="pin-keypad__grid">
        {KEYS.map((key, idx) => {
          if (key === null) {
            return <div key={`empty-${idx}`} className="pin-keypad__spacer" aria-hidden />;
          }
          if (key === 'back') {
            return (
              <button
                key="back"
                type="button"
                className="pin-keypad__key pin-keypad__key--action"
                aria-label="Backspace"
                disabled={busy}
                onClick={() => press('back')}
              >
                <BackspaceIcon />
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              className="pin-keypad__key"
              disabled={busy}
              onClick={() => press(key)}
            >
              <span className="pin-keypad__digit">{key}</span>
              {LETTERS[key] ? <span className="pin-keypad__letters">{LETTERS[key]}</span> : null}
            </button>
          );
        })}
      </div>

      {footer ? <div className="pin-keypad__footer">{footer}</div> : null}
    </div>
  );
}
