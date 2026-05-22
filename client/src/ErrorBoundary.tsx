import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="auth-screen">
          <div className="auth-card">
            <h2>Something went wrong</h2>
            <p className="error">{this.state.error.message}</p>
            <button type="button" onClick={() => window.location.assign("/")}>
              Reload home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
