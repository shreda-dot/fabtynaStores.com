"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const IOS_HINT_KEY = "fabtyna-ios-install-hint";

/** Whether the app is already running as an installed PWA (an external system). */
function isStandaloneNow(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function subscribeStandalone(onChange: () => void): () => void {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

/** The "add to Home Screen" hint shown on iOS, backed by localStorage. */
const hintListeners = new Set<() => void>();

function subscribeHint(onChange: () => void): () => void {
  hintListeners.add(onChange);
  return () => {
    hintListeners.delete(onChange);
  };
}

function readHint(): boolean {
  if (!/iphone|ipad|ipod/i.test(navigator.userAgent) || isStandaloneNow()) return false;
  try {
    return localStorage.getItem(IOS_HINT_KEY) !== "1";
  } catch {
    return true;
  }
}

function dismissHint(): void {
  try {
    localStorage.setItem(IOS_HINT_KEY, "1");
  } catch {
    /* ignore */
  }
  for (const listener of hintListeners) listener();
}

export function InstallButton() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  // Read both browser-only signals through useSyncExternalStore: the server
  // snapshots render nothing, so hydration stays stable without setState in an effect.
  const standalone = useSyncExternalStore(subscribeStandalone, isStandaloneNow, () => true);
  const iosHint = useSyncExternalStore(subscribeHint, readHint, () => false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone) return null;

  if (deferred) {
    return (
      <button
        type="button"
        className="rounded-md border border-border px-3 py-1.5 text-sm"
        onClick={async () => {
          await deferred.prompt();
          await deferred.userChoice;
          setDeferred(null);
        }}
      >
        Install app
      </button>
    );
  }

  if (iosHint) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        To install: tap Share, then Add to Home Screen.
        <button
          type="button"
          className="underline"
          onClick={dismissHint}
        >
          Dismiss
        </button>
      </p>
    );
  }

  return null;
}