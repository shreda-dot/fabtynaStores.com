"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const IOS_HINT_KEY = "fabtyna-ios-install-hint";

export function InstallButton() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos && !isStandalone) {
      try {
        if (localStorage.getItem(IOS_HINT_KEY) !== "1") setIosHint(true);
      } catch {
        setIosHint(true);
      }
    }

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
          onClick={() => {
            try {
              localStorage.setItem(IOS_HINT_KEY, "1");
            } catch {
              /* ignore */
            }
            setIosHint(false);
          }}
        >
          Dismiss
        </button>
      </p>
    );
  }

  return null;
}