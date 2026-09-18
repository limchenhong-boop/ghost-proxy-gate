export default function ProxyFrame({
  currentUrl,
  srcDoc,
  loading,
  error,
  onLoaded,
}) {
  return (
    <div className="fixed inset-0 z-10 bg-black">
      {loading && !srcDoc && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <p className="text-red-300/80 text-sm text-center max-w-md">{error}</p>
        </div>
      )}
      {!error && (
        <div className="w-full h-full">
          {srcDoc && (
            <iframe
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
              className="w-full h-full block"
              title="Ghost Proxy"
              referrerPolicy="no-referrer"
              onLoad={onLoaded}
            />
          )}
        </div>
      )}
    </div>
  );
}