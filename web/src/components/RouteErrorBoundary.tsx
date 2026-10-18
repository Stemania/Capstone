import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

type Props = { children: ReactNode; /** Remount when this changes (e.g. pathname). */ resetKey?: string };
type State = { error: Error | null };

/**
 * Catches render crashes in routed pages so the shell stays up with a
 * friendly message instead of a blank screen.
 */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always log — blank screens are hard to diagnose without this.
    console.error('RouteErrorBoundary caught:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="route-error-boundary" style={{ padding: '32px 16px' }}>
        <Result
          status="error"
          title="Something went wrong on this page"
          subTitle="Try reloading. If it keeps happening, tell the Admin what you were doing."
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      </div>
    );
  }
}
