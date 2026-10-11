"use client";
import React from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl p-8 text-center">
          <div className="rounded-2xl bg-red-500/10 p-8 ring-1 ring-red-400/30">
            <h1 className="text-xl font-black">Something tripped — nothing is lost</h1>
            <p className="mt-2 text-sm text-white/60">
              Nothing is lost. The tournament lives in <code>data/state.json</code> on the host
              laptop, and your draws and scores were saved the moment they were entered.
              Reload to continue; if it repeats, restore the last Backup JSON from
              Owner control → Export.
            </p>
            <code className="mt-3 block rounded-lg bg-black/40 p-2 text-left text-xs text-red-200">
              {String(this.state.error.message || this.state.error)}
            </code>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="mt-4 rounded-xl bg-cyan-400 px-5 py-2 font-bold text-black"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
