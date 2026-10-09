import { useRef, useState } from 'react';
import { Button, Space, message } from 'antd';
import { CameraOutlined, DeleteOutlined } from '@ant-design/icons';
import { usersApi } from '../api/users.api';
import { getErrorMessage } from '../api/client';
import type { User } from '../types';

const MAX_BYTES = 2 * 1024 * 1024;

/** Admin: upload (JPEG or PNG, up to 2 MB) or remove a user's photo. */
export default function PhotoUploadControl({
  user,
  onChange,
}: {
  user: Pick<User, 'id' | 'photoVersion'>;
  onChange: (updated: User) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      message.error('Choose a JPEG or PNG photo');
      return;
    }
    if (file.size > MAX_BYTES) {
      message.error('The photo must be 2 MB or smaller');
      return;
    }
    setBusy(true);
    try {
      const { data } = await usersApi.uploadPhoto(user.id, file);
      onChange(data);
      message.success('Photo saved');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await usersApi.deletePhoto(user.id);
      onChange(data);
      message.success('Photo removed');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space size={6}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) upload(file);
        }}
      />
      <Button size="small" icon={<CameraOutlined />} loading={busy} onClick={() => input.current?.click()}>
        {user.photoVersion ? 'Change photo' : 'Upload photo'}
      </Button>
      {user.photoVersion ? (
        <Button size="small" icon={<DeleteOutlined />} disabled={busy} onClick={remove}>
          Remove
        </Button>
      ) : null}
    </Space>
  );
}
