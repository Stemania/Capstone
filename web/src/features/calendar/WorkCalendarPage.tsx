import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  TimePicker,
  Typography,
  Spin,
  message,
  DatePicker,
} from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  DeleteOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';
import {
  calendarApi,
  type CalendarExceptionType,
  type WorkCalendarException,
} from '../../api/calendar.api';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isNormalWorkingDay(d: Dayjs): boolean {
  const dow = d.day(); // 0=Sun
  return dow >= 1 && dow <= 6;
}

function exceptionBadge(exc: WorkCalendarException): string {
  if (exc.type === 'HOLIDAY_NO_WORK') return 'Closed';
  if (exc.type === 'OVERTIME') {
    const until = exc.endTime ? exc.endTime.slice(0, 5) : '—';
    return `OT until ${until}`;
  }
  const start = exc.startTime ? exc.startTime.slice(0, 5) : '08:00';
  const end = exc.endTime ? exc.endTime.slice(0, 5) : '17:00';
  const sunday = dayjs(exc.date).day() === 0;
  return sunday ? `Sunday work, ${start}–${end}` : `Special, ${start}–${end}`;
}

function defaultsForType(type: CalendarExceptionType): {
  startTime: Dayjs | null;
  endTime: Dayjs | null;
} {
  if (type === 'HOLIDAY_NO_WORK') return { startTime: null, endTime: null };
  if (type === 'OVERTIME') {
    return {
      startTime: dayjs('17:00', 'HH:mm'),
      endTime: dayjs('20:00', 'HH:mm'),
    };
  }
  return {
    startTime: dayjs('08:00', 'HH:mm'),
    endTime: dayjs('17:00', 'HH:mm'),
  };
}

function monthCells(anchor: Dayjs): Dayjs[] {
  const start = anchor.startOf('month');
  // Monday-first grid
  const gridStart = start.subtract((start.day() + 6) % 7, 'day');
  return Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
}

export default function WorkCalendarPage() {
  const { isAdmin } = useAuth();
  const [anchor, setAnchor] = useState(() => dayjs());
  const [exceptions, setExceptions] = useState<WorkCalendarException[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkCalendarException | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const watchType = Form.useWatch('type', form) as CalendarExceptionType | undefined;

  const byDate = useMemo(() => {
    const map = new Map<string, WorkCalendarException>();
    for (const e of exceptions) map.set(e.date, e);
    return map;
  }, [exceptions]);

  const fetchMonth = async (month: Dayjs) => {
    setLoading(true);
    try {
      const from = month.startOf('month').format('YYYY-MM-DD');
      const to = month.endOf('month').format('YYYY-MM-DD');
      const { data } = await calendarApi.list(from, to);
      setExceptions(data || []);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonth(anchor);
  }, [anchor]);

  const openCreate = (date: Dayjs) => {
    if (!isAdmin) return;
    const existing = byDate.get(date.format('YYYY-MM-DD'));
    if (existing) {
      openEdit(existing);
      return;
    }
    setEditing(null);
    const type: CalendarExceptionType = isNormalWorkingDay(date)
      ? 'OVERTIME'
      : 'SPECIAL_WORKING_DAY';
    const defaults = defaultsForType(type);
    form.setFieldsValue({
      type,
      date,
      dateTo: null,
      startTime: defaults.startTime,
      endTime: defaults.endTime,
      note: undefined,
    });
    setFormOpen(true);
  };

  const openEdit = (exc: WorkCalendarException) => {
    setEditing(exc);
    form.setFieldsValue({
      type: exc.type,
      date: dayjs(exc.date),
      dateTo: null,
      startTime: exc.startTime ? dayjs(exc.startTime, 'HH:mm') : null,
      endTime: exc.endTime ? dayjs(exc.endTime, 'HH:mm') : null,
      note: exc.note || undefined,
    });
    setFormOpen(true);
  };

  const onTypeChange = (type: CalendarExceptionType) => {
    const defaults = defaultsForType(type);
    form.setFieldsValue({
      startTime: defaults.startTime,
      endTime: defaults.endTime,
    });
  };

  const submitForm = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const type = values.type as CalendarExceptionType;
      const payload = {
        type,
        date: (values.date as Dayjs).format('YYYY-MM-DD'),
        dateTo: values.dateTo
          ? (values.dateTo as Dayjs).format('YYYY-MM-DD')
          : undefined,
        startTime:
          type === 'HOLIDAY_NO_WORK'
            ? null
            : (values.startTime as Dayjs)?.format('HH:mm') || null,
        endTime:
          type === 'HOLIDAY_NO_WORK'
            ? null
            : (values.endTime as Dayjs)?.format('HH:mm') || null,
        note: values.note?.trim() || null,
      };

      if (editing) {
        await calendarApi.update(editing.id, {
          type: payload.type,
          date: payload.date,
          startTime: payload.startTime,
          endTime: payload.endTime,
          note: payload.note,
        });
        message.success('Exception updated');
      } else {
        const { data } = await calendarApi.create(payload);
        message.success(
          data.length > 1
            ? `Created ${data.length} calendar exceptions`
            : 'Exception created'
        );
      }
      setFormOpen(false);
      await fetchMonth(anchor);
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (exc: WorkCalendarException) => {
    if (!isAdmin) return;
    let impactCount = 0;
    try {
      if (exc.type === 'OVERTIME' || exc.type === 'SPECIAL_WORKING_DAY') {
        const { data } = await calendarApi.deleteImpact(exc.id);
        impactCount = data.affectedCount || 0;
      }
    } catch {
      /* still allow delete; impact is advisory */
    }

    Modal.confirm({
      title: `Remove exception on ${dayjs(exc.date).format('MMM D, YYYY')}?`,
      icon: <WarningOutlined />,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            Deleting may leave schedules in hours that are no longer working time.
            This does not auto-reschedule anything.
          </p>
          {impactCount > 0 ? (
            <p style={{ marginBottom: 0 }}>
              <strong>{impactCount}</strong> scheduled operation
              {impactCount === 1 ? '' : 's'} would fall outside working hours.{' '}
              <Link to="/schedule" onClick={() => Modal.destroyAll()}>
                Review schedule
              </Link>
            </p>
          ) : (
            <p style={{ marginBottom: 0, color: '#64748b' }}>
              No scheduled operations appear stranded by this change.
            </p>
          )}
        </div>
      ),
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await calendarApi.remove(exc.id);
          message.success('Exception deleted');
          setFormOpen(false);
          setEditing(null);
          await fetchMonth(anchor);
        } catch (err) {
          message.error(getErrorMessage(err));
          throw err;
        }
      },
    });
  };

  const cells = monthCells(anchor);
  const todayKey = dayjs().format('YYYY-MM-DD');

  return (
    <div className="std-list-page work-calendar-page">
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Shop-wide overtime, special working days, and holidays. Applies to every worker&apos;s
        schedule for that date.
        {!isAdmin ? ' Viewing only — ask an Admin to make changes.' : null}
      </Typography.Text>

      <div className="work-calendar__toolbar">
        <div className="work-calendar__nav">
          <Button
            icon={<LeftOutlined />}
            onClick={() => setAnchor((a) => a.subtract(1, 'month'))}
            aria-label="Previous month"
          />
          <div className="work-calendar__month-label">{anchor.format('MMMM YYYY')}</div>
          <Button
            icon={<RightOutlined />}
            onClick={() => setAnchor((a) => a.add(1, 'month'))}
            aria-label="Next month"
          />
        </div>
        <Button onClick={() => setAnchor(dayjs())}>Today</Button>
      </div>

      <div className="work-calendar__legend">
        <span>
          <i className="work-calendar__dot work-calendar__dot--ot" /> Overtime
        </span>
        <span>
          <i className="work-calendar__dot work-calendar__dot--special" /> Special working day
        </span>
        <span>
          <i className="work-calendar__dot work-calendar__dot--holiday" /> Holiday / closed
        </span>
      </div>

      {loading ? (
        <div className="page-spinner">
          <Spin size="large" />
        </div>
      ) : (
        <div className="work-calendar__grid" role="grid" aria-label="Work calendar">
          {WEEKDAYS.map((d) => (
            <div key={d} className="work-calendar__weekday">
              {d}
            </div>
          ))}
          {cells.map((day) => {
            const key = day.format('YYYY-MM-DD');
            const inMonth = day.month() === anchor.month();
            const exc = byDate.get(key);
            const normal = isNormalWorkingDay(day);
            const classes = [
              'work-calendar__cell',
              inMonth ? '' : 'work-calendar__cell--outside',
              key === todayKey ? 'work-calendar__cell--today' : '',
              !normal && !exc ? 'work-calendar__cell--off' : '',
              exc ? `work-calendar__cell--${exc.type.toLowerCase()}` : '',
              isAdmin ? 'work-calendar__cell--interactive' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={key}
                type="button"
                className={classes}
                disabled={!isAdmin && !exc}
                onClick={() => {
                  if (isAdmin || exc) openCreate(day);
                }}
                title={exc ? exceptionBadge(exc) : undefined}
              >
                <span className="work-calendar__day-num">{day.date()}</span>
                {exc ? (
                  <span className="work-calendar__badge">{exceptionBadge(exc)}</span>
                ) : inMonth && normal ? (
                  <span className="work-calendar__muted">Working</span>
                ) : inMonth ? (
                  <span className="work-calendar__muted">Off</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <Modal
        title={editing ? 'Edit calendar exception' : 'Add calendar exception'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={submitForm}
        confirmLoading={saving}
        okText={editing ? 'Save' : 'Create'}
        okButtonProps={{ disabled: !isAdmin }}
        destroyOnHidden
        footer={
          isAdmin
            ? undefined
            : [
                <Button key="close" onClick={() => setFormOpen(false)}>
                  Close
                </Button>,
              ]
        }
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }} disabled={!isAdmin}>
          <Form.Item
            name="type"
            label="Type"
            rules={[{ required: true, message: 'Choose a type' }]}
          >
            <Select
              onChange={onTypeChange}
              options={[
                { value: 'OVERTIME', label: 'Overtime (extend a working day)' },
                {
                  value: 'SPECIAL_WORKING_DAY',
                  label: 'Special working day (e.g. Sunday work)',
                },
                { value: 'HOLIDAY_NO_WORK', label: 'Holiday / closed' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="date"
            label={editing ? 'Date' : 'From date'}
            rules={[{ required: true, message: 'Pick a date' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          {!editing && (
            <Form.Item
              name="dateTo"
              label="Through date (optional)"
              tooltip="Set an end date to create the same exception across a range, e.g. a week of OT."
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          )}
          {watchType !== 'HOLIDAY_NO_WORK' && (
            <>
              <Form.Item
                name="startTime"
                label="Start time"
                rules={[{ required: true, message: 'Start time required' }]}
              >
                <TimePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="endTime"
                label="End time"
                rules={[{ required: true, message: 'End time required' }]}
              >
                <TimePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
          <Form.Item name="note" label="Note (optional)">
            <Input.TextArea rows={2} placeholder="e.g. Rush order, company holiday…" />
          </Form.Item>
        </Form>
        {isAdmin && editing && (
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => confirmDelete(editing)}
            block
            style={{ marginTop: 4 }}
          >
            Delete exception
          </Button>
        )}
      </Modal>
    </div>
  );
}
