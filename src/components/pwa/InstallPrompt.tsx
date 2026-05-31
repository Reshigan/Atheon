import { useEffect, useState } from "react";
import { Download, X, Share, Plus } from "lucide-react";

// `beforeinstallprompt` is non-standard (Chromium only). The DOM lib doesn't
// declare it on WindowEventMap, so we model what we need locally.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "atheon:pwa:install-dismissed-at";
const FIRST_SEEN_KEY = "atheon:pwa:first-seen-at";
const SHOW_AFTER_MS = 8000; // grace period — let the user see the app first
const DISMISS_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

type Platform = "android-chrome" | "ios-safari" | "desktop" | "unknown";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  const isAndroid = /android/i.test(ua);
  const isMobile = isIOS || isAndroid;
  if (isIOS) return "ios-safari";
  if (isAndroid) return "android-chrome";
  if (!isMobile) return "desktop";
  return "unknown";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)").matches;
  // iOS Safari uses a non-standard navigator.standalone bit.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mql || iosStandalone);
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number.parseInt(raw, 10);
    if (!Number.isFinite(dismissedAt)) return false;
    return Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => {
    if (isStandalone()) return; // already installed — never prompt
    if (recentlyDismissed()) return;

    setPlatform(detectPlatform());

    try {
      if (!localStorage.getItem(FIRST_SEEN_KEY)) {
        localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
      }
    } catch {
      /* localStorage unavailable — non-fatal */
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS Safari never fires beforeinstallprompt — show the manual hint after
    // the grace period anyway so iOS users discover Add to Home Screen.
    const t = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);

    function onInstalled() {
      setVisible(false);
      setDeferred(null);
    }
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(t);
    };
  }, []);

  // On Chromium we wait for the actual beforeinstallprompt before flipping on.
  // On iOS we always show after the timer because there is no event.
  useEffect(() => {
    if (deferred) setVisible(true);
  }, [deferred]);

  if (!visible) return null;
  if (platform === "ios-safari") return <IOSCard onDismiss={dismiss} />;
  if (deferred) return <ChromiumCard onInstall={install} onDismiss={dismiss} />;
  return null;

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "dismissed") {
        rememberDismiss();
      }
    } catch {
      /* user agent denied — non-fatal */
    } finally {
      setDeferred(null);
      setVisible(false);
    }
  }

  function dismiss() {
    rememberDismiss();
    setVisible(false);
  }
}

function rememberDismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* non-fatal */
  }
}

function ChromiumCard({
  onInstall,
  onDismiss,
}: {
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <Shell onDismiss={onDismiss}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-ink">
            Install Atheon
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink/70">
            One-click access from your home screen. Loads instantly, even
            offline.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onInstall}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <Download className="h-3.5 w-3.5" />
              Install
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center rounded-md px-2 py-1.5 text-xs font-medium text-ink/60 transition hover:bg-black/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function IOSCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Shell onDismiss={onDismiss}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-ink">
            Add Atheon to your Home Screen
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink/70">
            Tap <Share className="inline h-3.5 w-3.5 align-[-2px] text-ink/80" />{" "}
            <span className="font-medium text-ink">Share</span>, then{" "}
            <Plus className="inline h-3.5 w-3.5 align-[-2px] text-ink/80" />{" "}
            <span className="font-medium text-ink">Add to Home Screen</span>.
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-3 inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Got it
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Install Atheon"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[1000] mx-auto max-w-md rounded-xl border border-ink/10 bg-paper/95 p-3 shadow-[0_8px_24px_-12px_rgba(15,17,21,0.18)] backdrop-blur sm:right-4 sm:bottom-4 sm:left-auto sm:mx-0 sm:max-w-sm"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss install prompt"
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink/40 transition hover:bg-black/5 hover:text-ink/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}
