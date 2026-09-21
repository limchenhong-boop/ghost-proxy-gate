// Creates and owns a single Browser-Lab session for the browser shell.
// Status is "connecting" -> "ready" | "unavailable". When it is anything other
// than "ready", the shell keeps using the Render proxy as a fallback.

import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import BrowserLabClient from "@/lib/browserLabClient";

export default function useBrowserLab() {
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);
  const [client, setClient] = useState(null);
  const clientRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await base44.functions.invoke("browserLabSession", {
          action: "create",
          width: Math.round(window.innerWidth),
          height: Math.round(window.innerHeight),
        });
        if (!data?.ok) throw new Error(data?.error || "Browser-Lab is unavailable.");

        const c = new BrowserLabClient(data.baseUrl, data.sessionId);
        await c.connect();
        if (cancelled) { c.close(); return; }

        c.onClose = () => setStatus("unavailable");
        clientRef.current = c;
        setClient(c);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) { setError(e.message); setStatus("unavailable"); }
      }
    })();

    return () => {
      cancelled = true;
      const c = clientRef.current;
      if (c) {
        base44.functions.invoke("browserLabSession", { action: "delete", sessionId: c.sessionId }).catch(() => {});
        c.close();
        clientRef.current = null;
      }
    };
  }, []);

  return { status, error, client };
}