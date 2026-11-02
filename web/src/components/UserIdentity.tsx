import { Tooltip } from 'antd';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useViewport';
import { PersonAvatar } from './PersonAvatar';

export interface UserIdentityProps {
  userId?: string | null;
  fullName?: string | null;
  nickname?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  /** Avatar size on desktop. Phones use 32px unless `lockSize` is set. */
  size?: number;
  /** Keep `size` on phones too (the worker-setup header is 48px). */
  lockSize?: boolean;
  /**
   * `list` is the narrow worker list: name, then the nickname as plain quoted
   * text (no pill, no email). The nickname ellipsizes only past the panel width.
   */
  variant?: 'default' | 'list';
  /** Shown in place of the contact on phones when there is none ("No email yet"). */
  phoneEmptyContact?: string;
}

function clean(value?: string | null): string {
  return (value || '').trim();
}

/** Full name on the first line; nickname, then email or mobile, on the second. */
export default function UserIdentity({
  userId,
  fullName,
  nickname,
  email,
  mobileNumber,
  size = 40,
  lockSize = false,
  variant = 'default',
  phoneEmptyContact,
}: UserIdentityProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const name = clean(fullName) || '—';
  const nick = clean(nickname);
  const showNick = !!nick && nick.toLowerCase() !== name.toLowerCase();
  const contact = clean(email) || clean(mobileNumber);
  const px = phone && !lockSize ? 32 : size;

  if (variant === 'list') {
    return (
      <div className="user-identity user-identity--list">
        <PersonAvatar userId={userId} fullName={name === '—' ? fullName : name} size={px} />
        <div className="user-identity__text">
          <div className="user-identity__name">{name}</div>
          {showNick ? (
            <Tooltip title={nick}>
              <div className="user-identity__nick">“{nick}”</div>
            </Tooltip>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="user-identity">
      <PersonAvatar userId={userId} fullName={name === '—' ? fullName : name} size={px} />
      <div className="user-identity__text">
        <div className="user-identity__name">{name}</div>
        {showNick || contact || (phone && phoneEmptyContact) ? (
          <div className="user-identity__meta">
            {showNick ? <span className="user-identity__nick">“{nick}”</span> : null}
            {showNick && (contact || (phone && phoneEmptyContact)) ? (
              <span className="user-identity__dot" aria-hidden>·</span>
            ) : null}
            {contact ? (
              <Tooltip title={contact}>
                <span className="user-identity__contact">{contact}</span>
              </Tooltip>
            ) : phone && phoneEmptyContact ? (
              <span className="user-identity__contact user-identity__contact--empty">{phoneEmptyContact}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
