export default function ProxyFrame({ gatewayPage, loading, error }) {
  return (
    <div className="fixed inset-0 z-10 bg-black">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center" role="status" aria-label="Connecting to browsing gateway">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col gap-4 items-center justify-center px-6" role="alert">
          <p className="text-red-300/80 text-sm text-center max-w-md">{error}</p>
          {gatewayPage && <a href={gatewayPage} target="_blank" rel="noopener noreferrer" className="vp-pill border border-current text-sm">Open browsing in its own tab</a>}
        </div>
      )}
    </div>
  );
}