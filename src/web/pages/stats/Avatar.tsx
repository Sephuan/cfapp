import { useEffect, useState } from "react";

// Route the CF avatar through the local /api/avatar proxy: it fetches via the
// app's (proxy-aware) network path and caches the bytes to disk, so the avatar
// loads without a VPN and survives restarts. If even the proxy can't produce an
// image (disallowed host / offline first-ever load), fall back to initials.
export function Avatar({ url, initials, color }: { url: string | null | undefined; initials: string; color: string }) {
  const [failed, setFailed] = useState(false);
  // Clear the failed flag whenever the URL changes: a transient error (e.g. the
  // very first load with the network down) must not pin us to initials for the
  // rest of the session once a working avatar URL / connectivity arrives.
  useEffect(() => { setFailed(false); }, [url]);
  if (!url || failed) return <span style={{ color }}>{initials}</span>;
  return (
    <img
      src={`/api/avatar?u=${encodeURIComponent(url)}`}
      alt=""
      className="stats-avatar-img"
      onError={() => setFailed(true)}
    />
  );
}
