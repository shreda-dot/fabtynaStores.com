"use client";

import { useEffect } from "react";

/** Progressive enhancement: leave the offline page as soon as the browser reports a connection. */
export function OnlineRedirect() {
  useEffect(() => {
    const onOnline = () => window.location.replace("/");
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return null;
}