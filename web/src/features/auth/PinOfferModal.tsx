import { Modal, message } from 'antd';
import { useEffect, useState } from 'react';
import { authApi } from '../../api/auth.api';
import { useAuth } from '../../hooks/useAuth';
import PinSetupKeypad from './PinSetupKeypad';

const DISMISS_KEY = 'bmsc_pin_offer_dismissed';

/** Optional, dismissible PIN setup after password login (production workers). */
export default function PinOfferModal() {
  const { user, isWorker } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || !isWorker) return;
    if (sessionStorage.getItem('bmsc_offer_pin') !== '1') return;
    if (localStorage.getItem('bmsc_has_pin') === '1') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    sessionStorage.removeItem('bmsc_offer_pin');
    setOpen(true);
  }, [user, isWorker]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setOpen(false);
  };

  const onSave = async (pin: string) => {
    await authApi.setPin(pin);
    localStorage.setItem('bmsc_has_pin', '1');
    localStorage.removeItem(DISMISS_KEY);
    message.success('PIN saved for this device');
    setOpen(false);
  };

  return (
    <Modal
      open={open}
      title="Faster sign-in on this phone?"
      onCancel={dismiss}
      footer={null}
      destroyOnHidden
      centered
      width={400}
    >
      <p style={{ color: '#475569', marginBottom: 16, textAlign: 'center' }}>
        Set a 6-digit PIN for this device only. You still need your password on any new device.
      </p>
      <PinSetupKeypad
        onSave={onSave}
        footer={
          <button type="button" className="pin-keypad__link" onClick={dismiss}>
            Not now
          </button>
        }
      />
    </Modal>
  );
}
