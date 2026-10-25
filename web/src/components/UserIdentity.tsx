import { Tooltip } from 'antd';
import { PHONE_QUERY, useMediaQuery } from '../hooks/useViewport';
import { PersonAvatar } from './PersonAvatar';

export interface UserIdentityProps {
  userId?: string | null;
  fullName?: string | null;
  nickname?: string | null;
  email?: string | null;
  mobileNumber?: string | null;
  /** Avatar size on desktop. Phones always use 32px. */
  size?: number;
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
}: UserIdentityProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const name = clean(fullName) || '—';
  const nick = clean(nickname);
  const showNick = !!nick && nick.toLowerCase() !== name.toLowerCase();
  const contact = clean(email) || clean(mobileNumber);
  const px = phone ? 32 : size;

  return (
    <div className="user-identity">
      <PersonAvatar userId={userId} fullName={name === '—' ? fullName : name} size={px} />
      <div className="user-identity__text">
        <div className="user-identity__name">{name}</div>
        {showNick || contact ? (
          <div className="user-identity__meta">
            {showNick ? <span className="user-identity__nick">“{nick}”</span> : null}
            {showNick && contact ? <span className="user-identity__dot" aria-hidden>·</span> : null}
            {contact ? (
              <Tooltip title={contact}>
                <span className="user-identity__contact">{contact}</span>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
