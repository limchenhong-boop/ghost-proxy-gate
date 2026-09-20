import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { normalizeQuery } from "@/lib/proxy";
import { ArrowLeft, Zap, Loader2, XCircle, Globe, Fingerprint, Server } from "lucide-react";

export default function ProxyTester() {
  const navigate = useNavigate();
  const [proxy, setProxy] = useState("");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runTest = async () => {
    if (!proxy.trim() || !target.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke("testResidentialProxy", {
        proxy: proxy.trim(),
        target: normalizeQuery(target.trim()),
      });
      const data = res.data;
      if (!data.ok) {
        setError(data.error || data.targetError || "The proxy test failed.");
        if (data.egressIp || data.target) setResult(data);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message || "The proxy test could not be completed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="h-screen w-full flex flex-col text-white overflow-hidden"
      style={{
        "--vp-bg": "#0B0314",
        "--vp-bg2": "#1a0b2e",
        "--vp-accent": "#a855f7",
        "--vp-accent2": "#ec4899",
        background: "radial-gradient(circle at 50% 0%, #1a0b2e, #0B0314 60%)",
      }}
    >
      <div className="fixed inset-0 vp-net-bg pointer-events-none opacity-60" aria-hidden="true" />

      <header className="relative z-10 flex items-center px-4 sm:px-6 py-3">
        <button
          onClick={() => navigate("/")}
          className="vp-pill"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Home</span>
        </button>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6 pb-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          <h1 className="ghost-word text-5xl sm:text-6xl vp-fade-up text-center">proxy tester</h1>

          <div className="vp-fade-up flex flex-col gap-4" style={{ animationDelay: "0.08s" }}>
            <div>
              <label className="block text-xs text-white/50 mb-1.5 font-medium tracking-wide uppercase">
                Residential Proxy
              </label>
              <input
                type="text"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder="http://user:pass@host:port"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:border-white/30 transition-colors"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-xs text-white/30 mt-1.5">
                Format: http://user:pass@host:port or host:port:user:pass
              </p>
            </div>

            <div>
              <label className="block text-xs text-white/50 mb-1.5 font-medium tracking-wide uppercase">
                Target Website
              </label>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 text-sm focus:outline-none focus:border-white/30 transition-colors"
                spellCheck={false}
                autoComplete="off"
                onKeyDown={(e) => e.key === "Enter" && runTest()}
              />
            </div>

            <button
              onClick={runTest}
              disabled={loading || !proxy.trim() || !target.trim()}
              className="vp-go-btn w-full justify-center"
              style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {loading ? "Testing…" : "Test Proxy"}
            </button>
          </div>

          {error && (
            <div className="vp-fade-up flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300/90">{error}</p>
            </div>
          )}

          {result && (
            <div className="vp-fade-up flex flex-col gap-4">
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <Fingerprint className="w-4 h-4 text-white/60" />
                  <span className="text-xs text-white/50 font-medium tracking-wide uppercase">Egress IP</span>
                </div>
                {result.egressIp ? (
                  <p className="text-lg font-mono text-white">{result.egressIp}</p>
                ) : (
                  <p className="text-sm text-red-300/70">
                    Could not determine IP: {result.ipError || "unknown error"}
                  </p>
                )}
                {result.proxy && (
                  <p className="text-xs text-white/30 font-mono mt-2 break-all">{result.proxy}</p>
                )}
              </div>

              {result.target && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe className="w-4 h-4 text-white/60" />
                    <span className="text-xs text-white/50 font-medium tracking-wide uppercase">Response</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-white/40">Status</span>
                      <p className="text-white font-mono">{result.target.status}</p>
                    </div>
                    <div>
                      <span className="text-white/40">Time</span>
                      <p className="text-white font-mono">{result.target.timingMs}ms</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-white/40">Final URL</span>
                      <p className="text-white/80 text-xs font-mono break-all">{result.target.finalUrl}</p>
                    </div>
                    {result.target.title && (
                      <div className="col-span-2">
                        <span className="text-white/40">Title</span>
                        <p className="text-white/80">{result.target.title}</p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-white/40">Content-Type</span>
                      <p className="text-white/80 text-xs font-mono">{result.target.contentType || "—"}</p>
                    </div>
                    <div>
                      <span className="text-white/40">Body Size</span>
                      <p className="text-white font-mono">{result.target.bodyLength.toLocaleString()} chars</p>
                    </div>
                    <div>
                      <span className="text-white/40">Server</span>
                      <p className="text-white/80 text-xs font-mono">{result.target.headers?.server || "—"}</p>
                    </div>
                  </div>
                </div>
              )}

              {result.target?.bodySnippet && (
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-xs text-white/50 font-medium tracking-wide uppercase mb-2 block">
                    Body Preview
                  </span>
                  <pre className="text-xs text-white/60 font-mono overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                    {result.target.bodySnippet}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}