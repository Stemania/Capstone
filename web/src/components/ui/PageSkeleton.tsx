import { Skeleton } from 'antd';

/** Skeleton placeholders instead of a spinner while a page loads. */
export default function PageSkeleton({ variant = 'list' }: { variant?: 'list' | 'detail' | 'cards' | 'block' }) {
  if (variant === 'block') {
    return (
      <div className="ui-skeleton" aria-busy="true" aria-label="Loading">
        <Skeleton active title={false} paragraph={{ rows: 4 }} />
      </div>
    );
  }
  if (variant === 'cards') {
    return (
      <div className="ui-skeleton ui-skeleton--cards" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="ui-skeleton__card">
            <Skeleton active title={{ width: '50%' }} paragraph={{ rows: 2 }} />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'detail') {
    return (
      <div className="ui-skeleton" aria-busy="true" aria-label="Loading">
        <div className="ui-skeleton__card">
          <Skeleton active title={{ width: '30%' }} paragraph={{ rows: 3 }} />
        </div>
        <div className="ui-skeleton__card">
          <Skeleton active title={false} paragraph={{ rows: 6 }} />
        </div>
      </div>
    );
  }
  return (
    <div className="ui-skeleton" aria-busy="true" aria-label="Loading">
      <div className="ui-skeleton__card">
        <Skeleton.Input active size="small" style={{ width: 260 }} />
        <div style={{ height: 16 }} />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} active title={false} paragraph={{ rows: 1, width: '100%' }} />
        ))}
      </div>
    </div>
  );
}
