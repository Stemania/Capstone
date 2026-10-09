import { useEffect, useState, type CSSProperties } from 'react';
import { usersApi } from '../api/users.api';
import type { CrewMember } from '../types';
import { initials, personLabel } from '../utils/people';

/** Photo object URLs by "userId:version"; null when the photo could not be loaded. */
const photoCache = new Map<string, Promise<string | null>>();

function loadPhoto(userId: string, version: number): Promise<string | null> {
  const key = `${userId}:${version}`;
  let pending = photoCache.get(key);
  if (!pending) {
    pending = usersApi
      .getPhoto(userId)
      .then(({ data }) => URL.createObjectURL(data))
      .catch(() => null);
    photoCache.set(key, pending);
  }
  return pending;
}

const PALETTE = ['#1f4e79', '#2f6f5e', '#7a4b1f', '#5b3f8c', '#8c3f4f', '#3f6b8c', '#5e6b2f'];

function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export interface PersonAvatarProps {
  userId?: string | null;
  fullName?: string | null;
  photoVersion?: number | null;
  size?: number;
}

/** The person's photo, or their initials when there is none (or it may not be shown). */
export function PersonAvatar({ userId, fullName, photoVersion, size = 28 }: PersonAvatarProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (userId && photoVersion) {
      loadPhoto(userId, photoVersion).then((url) => {
        if (alive) setSrc(url);
      });
    }
    return () => {
      alive = false;
    };
  }, [userId, photoVersion]);

  const style: CSSProperties = {
    width: size,
    height: size,
    minWidth: size,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: src ? '#e8e8e8' : colorFor(userId || fullName || '?'),
    color: '#fff',
    fontSize: Math.max(10, Math.round(size * 0.4)),
    fontWeight: 600,
    lineHeight: 1,
    userSelect: 'none',
  };

  return (
    <span style={style} aria-hidden="true">
      {src ? (
        <img src={src} alt="" width={size} height={size} style={{ objectFit: 'cover' }} />
      ) : (
        initials(fullName)
      )}
    </span>
  );
}

export interface PersonChipProps extends PersonAvatarProps {
  nickname?: string | null;
  /** Shown instead of a name when there is no person. */
  emptyText?: string;
  strong?: boolean;
}

/** Avatar plus "Nickname · Full name". */
export function PersonChip({
  userId,
  fullName,
  nickname,
  photoVersion,
  size = 22,
  emptyText = '—',
  strong = false,
}: PersonChipProps) {
  if (!userId && !fullName) {
    return <span style={{ color: '#8c8c8c' }}>{emptyText}</span>;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <PersonAvatar userId={userId} fullName={fullName} photoVersion={photoVersion} size={size} />
      <span
        style={{
          fontWeight: strong ? 600 : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {personLabel(fullName, nickname)}
      </span>
    </span>
  );
}

export interface CrewChipsProps {
  crew?: CrewMember[] | null;
  /** Used when there is no crew list (older payloads): the lead alone. */
  lead?: { id?: string | null; fullName?: string | null; nickname?: string | null; photoVersion?: number | null };
  size?: number;
  emptyText?: string;
  /** One line, wrapping helpers after the lead. */
  vertical?: boolean;
}

/** Every crew member, lead first, each with their photo; helpers are marked. */
export function CrewChips({ crew, lead, size = 22, emptyText = 'Unassigned', vertical = false }: CrewChipsProps) {
  const members: CrewMember[] =
    crew && crew.length
      ? crew
      : lead?.id || lead?.fullName
        ? [
            {
              id: lead.id || '',
              fullName: lead.fullName || '',
              nickname: lead.nickname,
              photoVersion: lead.photoVersion,
              isLead: true,
            },
          ]
        : [];
  if (!members.length) return <span style={{ color: '#8c8c8c' }}>{emptyText}</span>;
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: vertical ? 'column' : 'row',
        flexWrap: 'wrap',
        alignItems: vertical ? 'flex-start' : 'center',
        gap: vertical ? 4 : 10,
        minWidth: 0,
      }}
    >
      {members.map((m) => (
        <span key={m.id || m.fullName} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <PersonChip
            userId={m.id}
            fullName={m.fullName}
            nickname={m.nickname}
            photoVersion={m.photoVersion}
            size={size}
            strong={m.isLead && members.length > 1}
          />
          {members.length > 1 && (
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>{m.isLead ? '(lead)' : '(helper)'}</span>
          )}
        </span>
      ))}
    </span>
  );
}

/** "Ana · Ben · Cara" for tooltips and print. */
export function crewNames(crew?: CrewMember[] | null, fallback?: string | null): string {
  if (crew && crew.length) return crew.map((m) => personLabel(m.fullName, m.nickname)).join(', ');
  return fallback || '';
}

export default PersonAvatar;
