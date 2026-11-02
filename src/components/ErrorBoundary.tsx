import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

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
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[CYFSA Navigator] Uncaught runtime error:", error, errorInfo);
  }

  private handleReset = () => {
    try {
      if ("caches" in window) {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        });
      }
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((reg) => reg.unregister());
        });
      }
    } catch {}
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mb-4 text-rose-600">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="font-display font-bold text-xl text-slate-900 mb-2">
            Unable to Load View
          </h2>
          <p className="text-sm text-slate-600 max-w-md mb-6 leading-relaxed">
            The application encountered a temporary display issue. Click below to reload and clear cached assets.
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reload &amp; Clear Cache</span>
            </button>
          </div>
          {this.state.error && (
            <details className="mt-6 text-left max-w-lg bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500 font-mono">
              <summary className="cursor-pointer font-bold text-slate-700">Diagnostic Details</summary>
              <pre className="mt-2 whitespace-pre-wrap overflow-x-auto">{this.state.error.message}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
