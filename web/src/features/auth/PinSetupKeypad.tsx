import { useState, type ReactNode } from 'react';
import { getErrorMessage } from '../../api/client';
import PinKeypad from './PinKeypad';

type PinSetupKeypadProps = {
  busy?: boolean;
  onSave: (pin: string) => Promise<void>;
  footer?: ReactNode;
};

/** Two-pass PIN creation: Create a PIN → Confirm your PIN. */
export default function PinSetupKeypad({ busy = false, onSave, footer }: PinSetupKeypadProps) {
  const [phase, setPhase] = useState<'create' | 'confirm'>('create');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [resetSignal, setResetSignal] = useState(0);
  const [failSignal, setFailSignal] = useState(0);
  const [saving, setSaving] = useState(false);

  const restart = (message: string) => {
    setError(message);
    setFirstPin('');
    setPhase('create');
    setFailSignal((n) => n + 1);
  };

  const onComplete = async (pin: string) => {
    if (phase === 'create') {
      setFirstPin(pin);
      setPhase('confirm');
      setError('');
      setResetSignal((n) => n + 1);
      return;
    }

    if (pin !== firstPin) {
      restart('PINs do not match. Enter a new PIN.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave(pin);
    } catch (err) {
      restart(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PinKeypad
      title={phase === 'create' ? 'Create a PIN' : 'Confirm your PIN'}
      error={error}
      busy={busy || saving}
      resetSignal={resetSignal}
      failSignal={failSignal}
      onComplete={onComplete}
      footer={footer}
    />
  );
}
