import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

// vite-plugin-pwa exposes a virtual module that wires the service worker
// lifecycle to a React hook. `needRefresh` flips on when a new SW is waiting
// to activate; calling updateServiceWorker(true) tells it to take over and
// reloads the page so the user lands on the new build.
//
// `offlineReady` flips on once the SW has cached the app shell — we show a
// brief, less obtrusive confirmation so the user knows offline access works
// without being interrupted.
const POLL_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Hourly check for a newer SW. PWAs that stay open for days (an exec
      // dashboard left on a wall display, e.g.) would otherwise never see
      // updates until the tab is closed.
      window.setInterval(() => {
        registration.update().catch(() => {
          /* network blip — try again next interval */
        });
      }, POLL_INTERVAL_MS);
    },
  });

  // Auto-dismiss the offline-ready hint after a short delay — it's a one-time
  // courtesy, not a call to action.
  useEffect(() => {
    if (!offlineReady) return;
    const t = window.setTimeout(() => setOfflineReady(false), 4500);
    return () => window.clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  if (needRefresh) {
    return (
      <Banner role="dialog" aria-label="Update available">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
            <RefreshCw className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight text-ink">
              A new version is ready
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink/70">
              Refresh to get the latest fixes and features.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateServiceWorker(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setNeedRefresh(false)}
                className="inline-flex items-center rounded-md px-2 py-1.5 text-xs font-medium text-ink/60 transition hover:bg-black/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </Banner>
    );
  }

  if (offlineReady) {
    return (
      <Banner role="status" aria-live="polite" tone="muted">
        <p className="text-xs leading-relaxed text-ink/80">
          Atheon is ready to use offline.
        </p>
      </Banner>
    );
  }

  return null;
}

function Banner({
  children,
  role,
  tone = "default",
  ...rest
}: {
  children: React.ReactNode;
  role: "dialog" | "status";
  tone?: "default" | "muted";
} & { "aria-label"?: string; "aria-live"?: "polite" }) {
  // Pinned to the top so it doesn't fight with the InstallPrompt at the
  // bottom. On mobile we span the viewport; on sm+ we anchor to the right.
  return (
    <div
      role={role}
      {...rest}
      className={`fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1000] mx-auto max-w-md rounded-xl border ${
        tone === "muted"
          ? "border-ink/10 bg-paper/95"
          : "border-ink/10 bg-paper/95 shadow-[0_8px_24px_-12px_rgba(15,17,21,0.18)]"
      } p-3 backdrop-blur sm:right-4 sm:left-auto sm:mx-0 sm:max-w-sm`}
    >
      {tone === "muted" ? null : <DismissChip />}
      {children}
    </div>
  );
}

function DismissChip() {
  return (
    <span aria-hidden className="absolute right-2 top-2 hidden text-ink/30">
      <X className="h-3.5 w-3.5" />
    </span>
  );
}
