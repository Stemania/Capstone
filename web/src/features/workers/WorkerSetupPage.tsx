import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, InputNumber, Select, Spin, Switch, Typography, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { MOBILE_SHELL_QUERY, NARROW_QUERY, useMediaQuery, useViewport } from '../../hooks/useViewport';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { usersApi, workerProfileApi } from '../../api/users.api';
import { getErrorMessage } from '../../api/client';
import type { User, WorkerSchedule, WorkerSkill } from '../../types';
import UserIdentity from '../../components/UserIdentity';
import { showSetupLink } from '../users/UsersPage';
import WorkerHistoryPanel from './WorkerHistoryPanel';
import './workerSetup.css';
import InfoTip from '../../components/InfoTip';
import { LevelBar, TabBar, PageSkeleton } from '../../components/ui';
import ResponsiveTable from '../../components/ui/ResponsiveTable';

const { Text } = Typography;

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type DetailTab = 'skills' | 'hours' | 'history';

type SkillRow = {
  /** Machine type id */
  key: string;
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
  const [mobileDraft, setMobileDraft] = useState('');
  const [savingSignIn, setSavingSignIn] = useState(false);

  const { isNarrow } = useViewport();
  const compact = useMediaQuery(MOBILE_SHELL_QUERY);
  const pushedDetail = useRef(false);

  const setWorker = (id: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.delete('tab');
    nextParams.set('worker', id);
    if (!nextParams.get('panel')) nextParams.set('panel', 'skills');
    // On narrow screens the list and the detail are separate views, so Back should return to the list.
    pushedDetail.current = isNarrow && !workerId;
    setParams(nextParams, { replace: !pushedDetail.current });
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
        // Only production workers are assigned work.
        const production = data
          .filter((u) => u.role === 'PRODUCTION_WORKER' && u.status !== 'DISABLED')
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
        setWorkers(production);
        if (!workerId && production[0] && !window.matchMedia(NARROW_QUERY).matches) {
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
    const current = workers.find((w) => w.id === workerId);
    setMobileDraft(current?.mobileNumber || '');
  }, [workerId, workers]);

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
            const skill = existing.get(m.id || '');
            return {
              key: m.id || '',
              name: m.name,
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
    return workers.filter((w) =>
      `${w.fullName} ${w.nickname || ''} ${w.email || ''} ${w.mobileNumber || ''}`.toLowerCase().includes(q)
    );
  }, [workers, query]);

  const selected = workers.find((w) => w.id === workerId) || null;

  const saveMobileAndLink = async (generate: boolean) => {
    if (!selected) return;
    const mobile = mobileDraft.trim();
    if (!mobile && !selected.email) {
      message.error('Add a mobile number first. This worker has no email.');
      return;
    }
    setSavingSignIn(true);
    try {
      if (mobile !== (selected.mobileNumber || '')) {
        const { data } = await usersApi.update(selected.id, { mobileNumber: mobile || undefined });
        setWorkers((prev) => prev.map((w) => (w.id === data.id ? { ...w, ...data } : w)));
      }
      if (!generate) {
        message.success('Mobile number saved');
        return;
      }
      const { data } = await usersApi.resendInvite(selected.id);
      showSetupLink(data.setupUrl);
      message.success(
        selected.email
          ? 'Setup link ready. An email was sent as well when delivery succeeded.'
          : 'Setup link ready. Show them the QR — it works once and expires in 48 hours.',
      );
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setSavingSignIn(false);
    }
  };

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
          machineTypeId: r.key,
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
      title: 'Machine',
      key: 'target',
      render: (_: unknown, row: SkillRow) => <strong>{row.name}</strong>,
    },
    {
      title: 'Level',
      dataIndex: 'proficiency',
      width: 200,
      render: (_: unknown, row: SkillRow) =>
        row.enabled ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <InputNumber
              min={1}
              max={5}
              value={row.proficiency}
              aria-label={`${row.name} level`}
              style={{ width: 64 }}
              onChange={(v) => {
                setSkillRows((prev) =>
                  prev.map((r) =>
                    r.key === row.key ? { ...r, proficiency: Number(v) || 1 } : r
                  )
                );
              }}
            />
            <LevelBar level={row.proficiency} />
          </span>
        ) : (
          <span className="ui-muted-note">Can&apos;t run</span>
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
    <div className="worker-setup-page">
      <div
        className={`worker-setup-grid${isNarrow ? (workerId ? ' worker-setup-grid--detail' : ' worker-setup-grid--list') : ''}`}
      >
        <aside className="worker-setup-list">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
            <Input
              allowClear
              placeholder="Search workers…"
              prefix={<SearchOutlined aria-hidden />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <InfoTip
              label="How this works"
              content={
                <>
                  Set who can run which machines and weekly work hours, for production workers and
                  Admins. Work history is built from completed operations and tool activity. Add or
                  deactivate accounts under Users &amp; Roles.
                </>
              }
            />
          </div>
          {listLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : filteredWorkers.length === 0 ? (
            <Text type="secondary">No workers yet. Create them under Users & Roles.</Text>
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
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
                  >
                    <UserIdentity
                      variant="list"
                      userId={w.id}
                      fullName={w.fullName}
                      nickname={w.nickname}
                      email={w.email}
                      mobileNumber={w.mobileNumber}
                    />
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
            <PageSkeleton variant="block" />
          ) : (
            <>
              <div className="ws-hero">
                {selected ? (
                  <UserIdentity
                    userId={selected.id}
                    fullName={selected.fullName}
                    nickname={selected.nickname}
                    email={selected.email}
                    mobileNumber={selected.mobileNumber}
                    size={48}
                    lockSize
                  />
                ) : (
                  'Worker'
                )}
              </div>

              <div className="ws-tabs">
                <TabBar<DetailTab>
                  value={detailTab}
                  onChange={setDetailTab}
                  items={[
                    { label: 'Skills', value: 'skills' },
                    { label: 'Weekly hours', value: 'hours' },
                    { label: 'History', value: 'history' },
                  ]}
                />
              </div>

              {detailTab === 'skills' &&
              selected?.role === 'PRODUCTION_WORKER' &&
              selected.status === 'INVITED' ? (
                <div className="worker-setup-panel" style={{ marginBottom: 12 }}>
                  <div className="worker-setup-panel__head">
                    <span>Sign-in</span>
                  </div>
                  <p style={{ margin: '0 0 8px', color: '#5c6b7a', fontSize: 13 }}>
                    No email is required. Save a mobile number, then generate a one-time setup link.
                    They scan the QR, set a password, and sign in with that number.
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Input
                      value={mobileDraft}
                      onChange={(e) => setMobileDraft(e.target.value)}
                      placeholder="09XXXXXXXXX"
                      style={{ maxWidth: 220 }}
                      inputMode="tel"
                      aria-label="Mobile number"
                    />
                    <Button loading={savingSignIn} onClick={() => saveMobileAndLink(false)}>
                      Save mobile
                    </Button>
                    <Button type="primary" loading={savingSignIn} onClick={() => saveMobileAndLink(true)}>
                      Generate setup link
                    </Button>
                  </div>
                </div>
              ) : null}

              {detailTab === 'skills' ? (
                <div className="worker-setup-panel">
                  <div className="worker-setup-panel__head">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Skills
                      <InfoTip
                        label="How skills work"
                        content="Switch on the machines they can operate, each at level 1 to 5. One primary skill only. Operations without a machine take no skill: anyone can do them. A machine nobody has a skill for yet is open to everyone."
                      />
                    </span>
                    <div className="worker-setup-panel__save m-action-bar">
                      <Button
                        type="primary"
                        loading={savingSkills}
                        onClick={saveSkills}
                        style={{ fontWeight: 600 }}
                      >
                        Save skills
                      </Button>
                    </div>
                  </div>
                  {compact ? (
                    <div className="ws-rows">
                      {skillRows.map((row) => (
                        <div key={row.key} className="ws-row">
                          <div className="ws-row__top">
                            <strong className="ws-row__name">{row.name}</strong>
                            <Switch
                              checked={row.enabled}
                              aria-label={`${row.name} enabled`}
                              onChange={(checked) => {
                                setSkillRows((prev) =>
                                  prev.map((r) =>
                                    r.key === row.key
                                      ? { ...r, enabled: checked, isPrimary: checked ? r.isPrimary : false }
                                      : r
                                  )
                                );
                              }}
                            />
                          </div>
                          <div className="ws-row__meta">
                            <span className="ws-row__k">Level</span>
                            {row.enabled ? (
                              <span className="ws-row__level">
                                <InputNumber
                                  min={1}
                                  max={5}
                                  value={row.proficiency}
                                  aria-label={`${row.name} level`}
                                  onChange={(v) => {
                                    setSkillRows((prev) =>
                                      prev.map((r) =>
                                        r.key === row.key ? { ...r, proficiency: Number(v) || 1 } : r
                                      )
                                    );
                                  }}
                                />
                                <LevelBar level={row.proficiency} />
                              </span>
                            ) : (
                              <span className="ui-muted-note">Can&apos;t run</span>
                            )}
                            <span className="ws-row__k">Primary</span>
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
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ResponsiveTable
                      card={{ title: 'target', badge: 'enabled' }}
                      size="small"
                      rowKey="key"
                      pagination={false}
                      columns={skillColumns}
                      dataSource={skillRows}
                    />
                  )}
                </div>
              ) : null}

              {detailTab === 'hours' ? (
                <div className="worker-setup-panel">
                  <div className="worker-setup-panel__head">
                    <span>Weekly hours</span>
                    <div className="worker-setup-panel__save m-action-bar">
                      <Button
                        type="primary"
                        loading={savingSchedule}
                        onClick={saveSchedule}
                        style={{ fontWeight: 600 }}
                      >
                        Save hours
                      </Button>
                    </div>
                  </div>
                  {compact ? (
                    <div className="ws-rows">
                      {schedule.map((row) => (
                        <div key={row.dayOfWeek} className="ws-row">
                          <div className="ws-row__top">
                            <strong className="ws-row__name">{DAY_LABELS[row.dayOfWeek]}</strong>
                            <Switch
                              checked={row.isWorking}
                              aria-label={`${DAY_LABELS[row.dayOfWeek]} working`}
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
                          </div>
                          <div className="ws-row__meta">
                            <span className="ws-row__k">Start</span>
                            <Select
                              disabled={!row.isWorking}
                              value={row.startTime || undefined}
                              aria-label={`${DAY_LABELS[row.dayOfWeek]} start`}
                              options={Array.from({ length: 24 }, (_, h) => {
                                const v = `${String(h).padStart(2, '0')}:00`;
                                return { value: v, label: v };
                              })}
                              onChange={(v) =>
                                setSchedule((prev) =>
                                  prev.map((d) => (d.dayOfWeek === row.dayOfWeek ? { ...d, startTime: v } : d))
                                )
                              }
                            />
                            <span className="ws-row__k">End</span>
                            <Select
                              disabled={!row.isWorking}
                              value={row.endTime || undefined}
                              aria-label={`${DAY_LABELS[row.dayOfWeek]} end`}
                              options={Array.from({ length: 24 }, (_, h) => {
                                const v = `${String(h).padStart(2, '0')}:00`;
                                return { value: v, label: v };
                              })}
                              onChange={(v) =>
                                setSchedule((prev) =>
                                  prev.map((d) => (d.dayOfWeek === row.dayOfWeek ? { ...d, endTime: v } : d))
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ResponsiveTable
                      card={{ title: 'dayOfWeek', badge: 'isWorking' }}
                      size="small"
                      rowKey="dayOfWeek"
                      pagination={false}
                      columns={scheduleColumns}
                      dataSource={schedule}
                    />
                  )}
                </div>
              ) : null}

              {detailTab === 'history' ? (
                <WorkerHistoryPanel key={workerId} workerId={workerId} />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
