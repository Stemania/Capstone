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
import { operationTypesApi, usersApi, workerProfileApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import type { User, WorkerSchedule, WorkerSkill } from '../../types';
import WorkerHistoryPanel from './WorkerHistoryPanel';

const { Text } = Typography;

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type DetailTab = 'skills' | 'hours' | 'history';

type SkillRow = {
  /** `machine:<id>` or `operation:<id>` */
  key: string;
  kind: 'machine' | 'operation';
  targetId: string;
  name: string;
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
  const workerId = params.get('worker') || '';
  const detailTab: DetailTab =
    params.get('panel') === 'hours'
      ? 'hours'
      : params.get('panel') === 'history'
        ? 'history'
        : 'skills';

  const [workers, setWorkers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [skillRows, setSkillRows] = useState<SkillRow[]>([]);
  const [schedule, setSchedule] = useState<WorkerSchedule[]>(defaultSchedule());
  const [savingSkills, setSavingSkills] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const setWorker = (id: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.delete('tab');
    nextParams.set('worker', id);
    if (!nextParams.get('panel')) nextParams.set('panel', 'skills');
    setParams(nextParams, { replace: true });
  };

  const setDetailTab = (next: DetailTab) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('panel', next);
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
          nextParams.delete('tab');
          nextParams.set('worker', production[0].id);
          nextParams.set('panel', 'skills');
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
        const [machinesRes, typesRes, skillsRes, scheduleRes] = await Promise.all([
          jobOrdersApi.machines(),
          operationTypesApi.list(),
          workerProfileApi.getSkills(workerId).catch(() => ({ data: [] as WorkerSkill[] })),
          workerProfileApi.getSchedule(workerId).catch(() => ({ data: [] as WorkerSchedule[] })),
        ]);
        const existing = new Map(
          (skillsRes.data || []).map((s) => [
            s.machineTypeId ? `machine:${s.machineTypeId}` : `operation:${s.operationTypeId}`,
            s,
          ])
        );
        const row = (kind: SkillRow['kind'], targetId: string, name: string): SkillRow => {
          const key = `${kind}:${targetId}`;
          const skill = existing.get(key);
          return {
            key,
            kind,
            targetId,
            name,
            enabled: Boolean(skill),
            proficiency: skill?.proficiency ?? 3,
            isPrimary: skill?.isPrimary ?? false,
          };
        };
        // Operations without a machine carry their own skill; Checking and
        // outsourced work do not.
        const noMachineTypes = (typesRes.data || [])
          .filter((t) => !t.defaultMachineTypeId && !t.isOutsourced && t.code !== 'CHECKING')
          .sort((a, b) => a.name.localeCompare(b.name));
        setSkillRows([
          ...machinesRes.data.map((m) => row('machine', m.id || '', m.name)),
          ...noMachineTypes.map((t) => row('operation', t.id, t.name)),
        ]);
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
    const enabled = skillRows.filter((r) => r.enabled);
    if (enabled.length && !enabled.some((r) => r.isPrimary)) {
      message.warning('Mark one enabled skill as primary');
      return;
    }
    setSavingSkills(true);
    try {
      await workerProfileApi.putSkills(
        workerId,
        enabled.map((r) => ({
          ...(r.kind === 'machine' ? { machineTypeId: r.targetId } : { operationTypeId: r.targetId }),
          proficiency: r.proficiency,
          isPrimary: r.isPrimary,
        }))
      );
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
        schedule.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isWorking: d.isWorking,
          startTime: d.isWorking ? d.startTime : null,
          endTime: d.isWorking ? d.endTime : null,
        }))
      );
      message.success('Hours saved');
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSavingSchedule(false);
    }
  };

  const skillColumns = [
    {
      title: 'Can do',
      dataIndex: 'enabled',
      width: 100,
      render: (_: unknown, row: SkillRow) => (
        <Switch
          checked={row.enabled}
          onChange={(checked) => {
            setSkillRows((prev) =>
              prev.map((r) =>
                r.key === row.key
                  ? {
                      ...r,
                      enabled: checked,
                      isPrimary: checked ? r.isPrimary : false,
                    }
                  : r
              )
            );
          }}
        />
      ),
    },
    {
      title: 'Machine or operation',
      key: 'target',
      render: (_: unknown, row: SkillRow) => (
        <span>
          <strong>{row.name}</strong>{' '}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.kind === 'machine' ? 'machine' : 'no machine'}
          </Text>
        </span>
      ),
    },
    {
      title: 'Level',
      dataIndex: 'proficiency',
      width: 120,
      render: (_: unknown, row: SkillRow) => (
        <InputNumber
          min={1}
          max={5}
          value={row.proficiency}
          disabled={!row.enabled}
          onChange={(v) => {
            setSkillRows((prev) =>
              prev.map((r) =>
                r.key === row.key ? { ...r, proficiency: Number(v) || 1 } : r
              )
            );
          }}
        />
      ),
    },
    {
      title: 'Primary',
      dataIndex: 'isPrimary',
      width: 90,
      render: (_: unknown, row: SkillRow) => (
        <Checkbox
          checked={row.isPrimary}
          disabled={!row.enabled}
          onChange={(e) => {
            const on = e.target.checked;
            setSkillRows((prev) =>
              prev.map((r) => ({
                ...r,
                isPrimary: r.key === row.key ? on : on ? false : r.isPrimary,
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
      dataIndex: 'dayOfWeek',
      render: (dow: number) => DAY_LABELS[dow],
    },
    {
      title: 'Working',
      dataIndex: 'isWorking',
      width: 90,
      render: (_: unknown, row: WorkerSchedule) => (
        <Switch
          checked={row.isWorking}
          onChange={(checked) => {
            setSchedule((prev) =>
              prev.map((d) =>
                d.dayOfWeek === row.dayOfWeek
                  ? {
                      ...d,
                      isWorking: checked,
                      startTime: checked ? d.startTime || '08:00' : null,
                      endTime: checked ? d.endTime || '17:00' : null,
                    }
                  : d
              )
            );
          }}
        />
      ),
    },
    {
      title: 'Start',
      dataIndex: 'startTime',
      render: (_: unknown, row: WorkerSchedule) => (
        <Select
          disabled={!row.isWorking}
          value={row.startTime || undefined}
          style={{ width: 110 }}
          options={Array.from({ length: 24 }, (_, h) => {
            const v = `${String(h).padStart(2, '0')}:00`;
            return { value: v, label: v };
          })}
          onChange={(v) => {
            setSchedule((prev) =>
              prev.map((d) => (d.dayOfWeek === row.dayOfWeek ? { ...d, startTime: v } : d))
            );
          }}
        />
      ),
    },
    {
      title: 'End',
      dataIndex: 'endTime',
      render: (_: unknown, row: WorkerSchedule) => (
        <Select
          disabled={!row.isWorking}
          value={row.endTime || undefined}
          style={{ width: 110 }}
          options={Array.from({ length: 24 }, (_, h) => {
            const v = `${String(h).padStart(2, '0')}:00`;
            return { value: v, label: v };
          })}
          onChange={(v) => {
            setSchedule((prev) =>
              prev.map((d) => (d.dayOfWeek === row.dayOfWeek ? { ...d, endTime: v } : d))
            );
          }}
        />
      ),
    },
  ];

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Set who can run which machines and weekly work hours. Work history is built from completed
        operations and tool activity. Add or deactivate accounts under Users & Roles.
      </Text>

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
            <Text type="secondary">Select a worker to edit skills, hours, or history.</Text>
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

              <Segmented
                value={detailTab}
                onChange={(v) => setDetailTab(v as DetailTab)}
                style={{ marginBottom: 16 }}
                options={[
                  { label: 'Skills', value: 'skills' },
                  { label: 'Weekly hours', value: 'hours' },
                  { label: 'History', value: 'history' },
                ]}
              />

              {detailTab === 'skills' ? (
                <div className="worker-setup-panel">
                  <div className="worker-setup-panel__head">
                    <span>Skills</span>
                    <Button
                      type="primary"
                      loading={savingSkills}
                      onClick={saveSkills}
                      style={{ fontWeight: 600 }}
                    >
                      Save skills
                    </Button>
                  </div>
                  <Table
                    size="small"
                    rowKey="key"
                    pagination={false}
                    columns={skillColumns}
                    dataSource={skillRows}
                  />
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
                    Switch on the machines they can operate and the operations they can do, each at
                    level 1 to 5. One primary skill only. Once anyone has an operation skill, only
                    workers with it are suggested and can be assigned to that operation.
                  </Text>
                </div>
              ) : null}

              {detailTab === 'hours' ? (
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
              ) : null}

              {detailTab === 'history' ? (
                <div className="worker-setup-panel">
                  <div className="worker-setup-panel__head">
                    <span>History</span>
                  </div>
                  <WorkerHistoryPanel workerId={workerId} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
