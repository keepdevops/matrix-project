import React from 'react';
import Button from './Button';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, open: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Unhandled React error:', error, info.componentStack);
  }

  render() {
    const { error, open } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary-icon">⚠</div>
        <h2 className="error-boundary-title">Something went wrong</h2>
        <p className="error-boundary-msg">The UI hit an unexpected error.</p>
        <Button
          variant="outline-primary"
          size="md"
          className="error-boundary-reload"
          onClick={() => window.location.reload()}
        >
          ↺ Reload app
        </Button>
        <div className="error-boundary-detail">
          <Button
            variant="ghost"
            size="sm"
            className="error-boundary-toggle"
            onClick={() => this.setState(s => ({ open: !s.open }))}
          >
            {open ? '▾' : '▸'} Show error details
          </Button>
          {open && (
            <pre className="error-boundary-stack">
              {error.message}
              {'\n'}
              {error.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
