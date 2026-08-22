import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Input,
  InputNumber,
  Segmented,
  Select,
  Spin,
  Switch,
  Table,
  Typography,
  message,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { usersApi, workerProfileApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import ScoringWeightsPage from '../settings/ScoringWeightsPage';
import type { User, WorkerSchedule, WorkerSkill } from '../../types';

const { Text } = Typography;

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type Tab = 'roster' | 'ranking';

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

export default function WorkerSetupPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'ranking' ? 'ranking' : 'roster';
  const workerId = params.get('worker') || '';

  const [workers, setWorkers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [skillRows, setSkillRows] = useState<SkillRow[]>([]);
  const [schedule, setSchedule] = useState<WorkerSchedule[]>(defaultSchedule());
  const [savingSkills, setSavingSkills] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const setTab = (next: Tab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  };

  const setWorker = (id: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', 'roster');
    nextParams.set('worker', id);
    setParams(nextParams, { replace: true });
  };

  useEffect(() => {
    (async () => {
      setListLoading(true);
      try {
        const { data } = await usersApi.list();
        const production = data
          .filter((u) => u.role === 'PRODUCTION_WORKER')
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
        setWorkers(production);
        if (!workerId && production[0]) {
          const nextParams = new URLSearchParams(params);
          if (!nextParams.get('tab')) nextParams.set('tab', 'roster');
          nextParams.set('worker', production[0].id);
          setParams(nextParams, { replace: true });
        }
      } catch (err) {
        message.error(getErrorMessage(err));
      } finally {
        setListLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!workerId) return;
    const load = async () => {
      setDetailLoading(true);
      try {
        const [machinesRes, skillsRes, scheduleRes] = await Promise.all([
          jobOrdersApi.machines(),
          workerProfileApi.getSkills(workerId).catch(() => ({ data: [] as WorkerSkill[] })),
          workerProfileApi.getSchedule(workerId).catch(() => ({ data: [] as WorkerSchedule[] })),
        ]);
        const existing = new Map((skillsRes.data || []).map((s) => [s.machineTypeId, s]));
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
          setSchedule([...scheduleRes.data].sort((a, b) => a.dayOfWeek - b.dayOfWeek));
        } else {
          setSchedule(defaultSchedule());
        }
      } catch (err) {
        message.error(getErrorMessage(err));
      } finally {
        setDetailLoading(false);
      }
    };
    load();
  }, [workerId]);

  const filteredWorkers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workers;
    return workers.filter((w) => `${w.fullName} ${w.email}`.toLowerCase().includes(q));
  }, [workers, query]);

  const selected = workers.find((w) => w.id === workerId) || null;

  const saveSkills = async () => {
    if (!workerId) return;
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
            else seen = true;
          }
        });
      }
      await workerProfileApi.putSkills(workerId, payload);
      message.success('Skills saved');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSavingSkills(false);
    }
  };

  const saveSchedule = async () => {
    if (!workerId) return;
    setSavingSchedule(true);
    try {
      await workerProfileApi.putSchedule(
        workerId,
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
      title: 'Skill (1–5)',
      key: 'proficiency',
      width: 120,
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
      width: 90,
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
      width: 110,
      render: (_: unknown, row: WorkerSchedule, index: number) => (
        <Select
          disabled={!row.isWorking}
          value={row.startTime || undefined}
          style={{ width: '100%' }}
          options={['06:00', '07:00', '08:00', '09:00', '10:00'].map((t) => ({ value: t, label: t }))}
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
      width: 110,
      render: (_: unknown, row: WorkerSchedule, index: number) => (
        <Select
          disabled={!row.isWorking}
          value={row.endTime || undefined}
          style={{ width: '100%' }}
          options={['16:00', '17:00', '18:00', '20:00', '22:00'].map((t) => ({ value: t, label: t }))}
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
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Set who can run which machines, weekly work hours, and how the shop ranks workers when
        suggesting an assignment. Add or deactivate accounts under Users & Roles.
      </Text>

      <Segmented
        size="large"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        style={{ marginBottom: 20 }}
        options={[
          { label: 'Skills & hours', value: 'roster' },
          { label: 'Ranking', value: 'ranking' },
        ]}
      />

      {tab === 'ranking' ? (
        <ScoringWeightsPage embedded />
      ) : (
        <div className="worker-setup-grid">
          <aside className="worker-setup-list">
            <Input
              allowClear
              placeholder="Search workers…"
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            {listLoading ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Spin />
              </div>
            ) : filteredWorkers.length === 0 ? (
              <Text type="secondary">No production workers yet. Create them under Users & Roles.</Text>
            ) : (
              <div className="worker-setup-list__items">
                {filteredWorkers.map((w) => {
                  const active = w.id === workerId;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      className={`worker-setup-list__item${active ? ' is-active' : ''}`}
                      onClick={() => setWorker(w.id)}
                    >
                      <div className="worker-setup-list__name">{w.fullName}</div>
                      <div className="worker-setup-list__email">{w.email}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <div className="worker-setup-detail">
            {!workerId ? (
              <Text type="secondary">Select a worker to edit skills and hours.</Text>
            ) : detailLoading ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <Spin size="large" />
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#0f1c2e' }}>
                    {selected?.fullName || 'Worker'}
                  </div>
                  <Text type="secondary">{selected?.email}</Text>
                </div>

                <div className="worker-setup-panel">
                  <div className="worker-setup-panel__head">
                    <span>Skills</span>
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
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
                    Only machines they can operate should be switched on. One primary skill only.
                  </Text>
                </div>

                <div className="worker-setup-panel">
                  <div className="worker-setup-panel__head">
                    <span>Weekly hours</span>
                    <Button
                      type="primary"
                      loading={savingSchedule}
                      onClick={saveSchedule}
                      style={{ fontWeight: 600 }}
                    >
                      Save hours
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
