import { Card, Col, Row, Typography } from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  ToolOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const REPORTS = [
  {
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
    to: '/reports/worker-performance',
    title: 'Worker Performance',
    blurb: 'Finished operations, target vs hours worked, difference from target, and machines each worker can run.',
    icon: <TeamOutlined style={{ fontSize: 22 }} />,
  },
];

export default function ReportsHubPage() {
  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        Read-only reports for Admin and Office. Job order printouts are available from each job
        order (Production may print those as well).
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <FileTextOutlined style={{ fontSize: 22, marginTop: 2 }} />
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              Job order printout
            </Typography.Title>
            <Typography.Text type="secondary">
              Open a job order and use <strong>Print</strong>, or go to{' '}
              <code>/job-orders/&lt;id&gt;/print</code>. Letterhead layout with operations and
              signature blocks.
            </Typography.Text>
          </div>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        {REPORTS.map((r) => (
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
