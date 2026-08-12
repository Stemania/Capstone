import { useEffect, useMemo, useState } from 'react';
import {
  Button, Checkbox, InputNumber, Select, Spin, Switch, Table, Typography, message, Space,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { usersApi, workerProfileApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import type { User, WorkerSchedule, WorkerSkill } from '../../types';

const { Title, Text } = Typography;

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type SkillRow = {
  machineTypeId: string;
  machineTypeCode: string;
  machineTypeName: string;
  enabled: boolean;
  proficiency: number;
  isPrimary: boolean;
};

function defaultSchedule(): WorkerSchedule[] {
  return DAY_LABELS.map((_, dow) => ({
    dayOfWeek: dow,
    isWorking: dow < 6,
    startTime: dow < 6 ? '08:00' : null,
    endTime: dow < 6 ? '17:00' : null,
  }));
}

export default function WorkerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [skillRows, setSkillRows] = useState<SkillRow[]>([]);
  const [schedule, setSchedule] = useState<WorkerSchedule[]>(defaultSchedule());
  const [loading, setLoading] = useState(true);
  const [savingSkills, setSavingSkills] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        const [userRes, machinesRes, skillsRes, scheduleRes] = await Promise.all([
          usersApi.get(id),
          jobOrdersApi.machines(),
          workerProfileApi.getSkills(id).catch(() => ({ data: [] as WorkerSkill[] })),
          workerProfileApi.getSchedule(id).catch(() => ({ data: [] as WorkerSchedule[] })),
        ]);
        setUser(userRes.data);

        const existing = new Map(
          (skillsRes.data || []).map((s) => [s.machineTypeId, s])
        );
        setSkillRows(
          machinesRes.data.map((m) => {
            const mid = m.id || '';
            const skill = existing.get(mid);
            return {
              machineTypeId: mid,
              machineTypeCode: String(m.code),
              machineTypeName: m.name,
              enabled: Boolean(skill),
              proficiency: skill?.proficiency ?? 3,
              isPrimary: skill?.isPrimary ?? false,
            };
          })
        );

        if (scheduleRes.data?.length === 7) {
          setSchedule(
            [...scheduleRes.data].sort((a, b) => a.dayOfWeek - b.dayOfWeek)
          );
        } else {
          setSchedule(defaultSchedule());
        }
      } catch (err) {
        message.error(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const primaryCount = useMemo(
    () => skillRows.filter((r) => r.enabled && r.isPrimary).length,
    [skillRows]
  );

  const saveSkills = async () => {
    if (!id) return;
    setSavingSkills(true);
    try {
      const payload = skillRows
        .filter((r) => r.enabled && r.machineTypeId)
        .map((r) => ({
          machineTypeId: r.machineTypeId,
          proficiency: r.proficiency,
          isPrimary: r.isPrimary,
        }));
      if (payload.filter((p) => p.isPrimary).length > 1) {
        let seen = false;
        payload.forEach((p) => {
          if (p.isPrimary) {
            if (seen) p.isPrimary = false;
            seen = true;
          }
        });
      }
      await workerProfileApi.putSkills(id, payload);
      message.success('Skills saved');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSavingSkills(false);
    }
  };

  const saveSchedule = async () => {
    if (!id) return;
    setSavingSchedule(true);
    try {
      await workerProfileApi.putSchedule(
        id,
        schedule.map((s) => ({
          dayOfWeek: s.dayOfWeek,
          isWorking: s.isWorking,
          startTime: s.isWorking ? s.startTime || '08:00' : null,
          endTime: s.isWorking ? s.endTime || '17:00' : null,
        }))
      );
      message.success('Schedule saved');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSavingSchedule(false);
    }
  };

  if (loading) {
    return (
      <div className="page-spinner">
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Text type="danger">Worker not found</Text>;
  }

  const skillColumns = [
    {
      title: 'Machine',
      key: 'machine',
      render: (_: unknown, row: SkillRow) => (
        <span style={{ fontWeight: 600 }}>{row.machineTypeName}</span>
      ),
    },
    {
      title: 'Can operate',
      key: 'enabled',
      width: 120,
      render: (_: unknown, row: SkillRow, index: number) => (
        <Switch
          checked={row.enabled}
          onChange={(checked) => {
            setSkillRows((prev) => {
              const next = [...prev];
              next[index] = {
                ...next[index],
                enabled: checked,
                isPrimary: checked ? next[index].isPrimary : false,
              };
              return next;
            });
          }}
        />
      ),
    },
    {
      title: 'Skill level (1–5)',
      key: 'proficiency',
      width: 160,
      render: (_: unknown, row: SkillRow, index: number) => (
        <InputNumber
          min={1}
          max={5}
          value={row.proficiency}
          disabled={!row.enabled}
          onChange={(v) => {
            setSkillRows((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], proficiency: Number(v) || 1 };
              return next;
            });
          }}
        />
      ),
    },
    {
      title: 'Primary',
      key: 'primary',
      width: 100,
      render: (_: unknown, row: SkillRow, index: number) => (
        <Checkbox
          checked={row.isPrimary}
          disabled={!row.enabled}
          onChange={(e) => {
            const checked = e.target.checked;
            setSkillRows((prev) =>
              prev.map((r, i) => ({
                ...r,
                isPrimary: i === index ? checked : checked ? false : r.isPrimary,
              }))
            );
          }}
        />
      ),
    },
  ];

  const scheduleColumns = [
    {
      title: 'Day',
      key: 'day',
      render: (_: unknown, row: WorkerSchedule) => DAY_LABELS[row.dayOfWeek] || row.dayOfWeek,
    },
    {
      title: 'Working',
      key: 'working',
      width: 100,
      render: (_: unknown, row: WorkerSchedule, index: number) => (
        <Switch
          checked={row.isWorking}
          onChange={(checked) => {
            setSchedule((prev) => {
              const next = [...prev];
              next[index] = {
                ...next[index],
                isWorking: checked,
                startTime: checked ? next[index].startTime || '08:00' : null,
                endTime: checked ? next[index].endTime || '17:00' : null,
              };
              return next;
            });
          }}
        />
      ),
    },
    {
      title: 'Start',
      key: 'start',
      width: 140,
      render: (_: unknown, row: WorkerSchedule, index: number) => (
        <Select
          disabled={!row.isWorking}
          value={row.startTime || undefined}
          style={{ width: '100%' }}
          options={['06:00', '07:00', '08:00', '09:00', '10:00'].map((t) => ({
            value: t,
            label: t,
          }))}
          onChange={(v) => {
            setSchedule((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], startTime: v };
              return next;
            });
          }}
        />
      ),
    },
    {
      title: 'End',
      key: 'end',
      width: 140,
      render: (_: unknown, row: WorkerSchedule, index: number) => (
        <Select
          disabled={!row.isWorking}
          value={row.endTime || undefined}
          style={{ width: '100%' }}
          options={['16:00', '17:00', '18:00', '20:00', '22:00'].map((t) => ({
            value: t,
            label: t,
          }))}
          onChange={(v) => {
            setSchedule((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], endTime: v };
              return next;
            });
          }}
        />
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/users')}>
          Back
        </Button>
      </Space>

      <Title level={4} style={{ margin: '0 0 4px' }}>
        {user.fullName}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
        {user.email} · Production worker skills and weekly schedule
        {primaryCount > 1 ? ' · (only one primary skill kept on save)' : ''}
      </Text>

      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748b' }}>
            Skills
          </span>
          <Button type="primary" loading={savingSkills} onClick={saveSkills} style={{ fontWeight: 600 }}>
            Save skills
          </Button>
        </div>
        <Table
          size="small"
          rowKey="machineTypeId"
          pagination={false}
          columns={skillColumns}
          dataSource={skillRows}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          Workers without a skill row for a machine type cannot operate it.
        </Text>
      </div>

      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748b' }}>
            Weekly schedule
          </span>
          <Button type="primary" loading={savingSchedule} onClick={saveSchedule} style={{ fontWeight: 600 }}>
            Save schedule
          </Button>
        </div>
        <Table
          size="small"
          rowKey="dayOfWeek"
          pagination={false}
          columns={scheduleColumns}
          dataSource={schedule}
        />
      </div>
    </div>
  );
}
