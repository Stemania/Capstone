import { DisconnectOutlined } from '@ant-design/icons';

export default function NeedsConnection({ what }: { what?: string }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: '#475569' }}>
      <DisconnectOutlined style={{ fontSize: 40, color: '#d97706' }} />
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 12, color: '#0f172a' }}>
        Needs a connection
      </div>
      <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
        {what ? `${what} needs` : 'This needs'} a connection. Without one you can still open
        My Assignments and Start, Pause, Resume, Complete, or Report breakdown; those are sent
        when the connection returns.
      </div>
    </div>
  );
}
