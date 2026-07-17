import { useEffect, useState } from 'react';
import { Button, Spin, Empty, message } from 'antd';
import { ToolOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { toolsApi } from '../../api/tools.api';
import { getErrorMessage } from '../../api/client';
import { workerColors } from '../../layouts/WorkerLayout';

interface HeldTool {
  id: string;
  name: string;
  code: string;
  since: string;
}

export default function MyToolsPage() {
  const [tools, setTools] = useState<HeldTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState<string | null>(null);

  const fetchTools = async () => {
    try {
      const { data } = await toolsApi.myTools();
      setTools(data);
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const handleReturn = async (tool: HeldTool) => {
    setReturning(tool.id);
    try {
      await toolsApi.scan(tool.code);
      message.success(`Returned: ${tool.name}`);
      await fetchTools();
    } catch (err) {
      message.error(getErrorMessage(err));
    } finally {
      setReturning(null);
    }
  };

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '64px auto' }} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 44, fontWeight: 800, color: workerColors.green, lineHeight: 1 }}>
          {tools.length}
        </span>
        <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>
          tool{tools.length === 1 ? '' : 's'} checked
          <br />
          out to you
        </span>
      </div>
      <p style={{ color: workerColors.textSecondary, fontSize: 13, marginBottom: 20 }}>
        Return a tool here, or scan its tag again.
      </p>

      {tools.length === 0 ? (
        <Empty description="No tools borrowed" style={{ marginTop: 48 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tools.map((tool) => (
            <div
              key={tool.id}
              style={{
                background: workerColors.card,
                border: `1px solid ${workerColors.cardBorder}`,
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'rgba(34,197,94,0.12)',
                  color: workerColors.green,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                <ToolOutlined />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{tool.name}</div>
                <div style={{ fontSize: 12, color: workerColors.textSecondary }}>
                  {tool.code} · since {dayjs(tool.since).format('MMM D, h:mm A')}
                </div>
              </div>
              <Button
                type="primary"
                loading={returning === tool.id}
                onClick={() => handleReturn(tool)}
                style={{ fontWeight: 700 }}
              >
                Return
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
