import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
          <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full border border-red-100">
            <div className="text-red-500 text-4xl mb-4 text-center">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">Something went wrong</h1>
            <p className="text-gray-600 mb-6 text-center">
              The application encountered an unexpected error. This might be due to invalid or unexpected data.
            </p>
            {this.state.error && (
              <div className="bg-red-50 p-4 rounded text-sm text-red-800 font-mono mb-6 overflow-x-auto">
                {this.state.error.toString()}
              </div>
            )}
            <button
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded transition"
              onClick={() => window.location.reload()}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
