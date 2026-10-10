import { useState } from 'react';
import { Button, Card, Col, Row, Select, Typography, message } from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  PrinterOutlined,
  ToolOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { jobOrdersApi } from '../../api/jobOrders.api';
import { getErrorMessage } from '../../api/client';
import type { JobOrder } from '../../types';

const REPORTS = [
  {
    adminOnly: true,
    to: '/reports/efficiency',
    title: 'Production Performance',
    blurb:
      'On-time rate, difference from target, redo share, and breakdowns by worker, operation type, and machine.',
    icon: <BarChartOutlined style={{ fontSize: 22 }} />,
  },
  {
    to: '/reports/inventory',
    title: 'Inventory Status',
    blurb: 'Stock levels, reorder alerts, outstanding borrows, and usage over a period.',
    icon: <ToolOutlined style={{ fontSize: 22 }} />,
  },
  {
    adminOnly: true,
    to: '/reports/worker-performance',
    title: 'Worker Performance',
    blurb: 'Finished operations, target vs hours worked, difference from target, and machines each worker can run.',
    icon: <TeamOutlined style={{ fontSize: 22 }} />,
  },
];

function JobOrderPrintoutCard() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string>();

  const loadJobs = async () => {
    if (jobs || loading) return;
    setLoading(true);
    try {
      const { data } = await jobOrdersApi.list({ scope: 'all' });
      setJobs(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FileTextOutlined style={{ fontSize: 22, marginTop: 2 }} />
        <div style={{ flex: '1 1 260px' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Job order printout
          </Typography.Title>
          <Typography.Text type="secondary">
            The shop&apos;s job order form with operations, materials and signatures. Pick a job
            order to open its printout.
          </Typography.Text>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: '1 1 360px', flexWrap: 'wrap' }}>
          <Select
            showSearch
            allowClear
            placeholder="Search job number, title, or client"
            style={{ flex: '1 1 240px', minWidth: 0 }}
            loading={loading}
            onFocus={loadJobs}
            onOpenChange={(open) => open && loadJobs()}
            value={jobId}
            onChange={setJobId}
            optionFilterProp="label"
            notFoundContent={loading ? 'Loading…' : 'No job orders found'}
            options={(jobs || []).map((j) => ({
              value: j.id,
              label: [j.jobNumber, j.title, j.clientName].filter(Boolean).join(' · '),
            }))}
          />
          <Button
            type="primary"
            icon={<PrinterOutlined />}
            disabled={!jobId}
            onClick={() => jobId && navigate(`/job-orders/${jobId}/print`)}
          >
            Open printout
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function ReportsHubPage() {
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const reports = REPORTS.filter((r) => isAdmin || !r.adminOnly);
  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        Read-only reports for Admin and Office. Job order printouts are also available from each
        job order (Production may print those as well).
      </Typography.Paragraph>

      <JobOrderPrintoutCard />

      <Row gutter={[16, 16]}>
        {reports.map((r) => (
          <Col xs={24} md={8} key={r.to}>
            <Link to={r.to} style={{ color: 'inherit', display: 'block', height: '100%' }}>
              <Card hoverable style={{ height: '100%' }} styles={{ body: { minHeight: 132 } }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  {r.icon}
                  <div>
                    <Typography.Title level={5} style={{ margin: '0 0 6px' }}>
                      {r.title}
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      {r.blurb}
                    </Typography.Text>
                  </div>
                </div>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
