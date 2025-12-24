import { useEffect, useState } from "react";
import type { Snapshot, RawSnapshot } from "../type/Snapshot";
import { normalizeSnapshot } from "../lib/normalizeSnapshot";

export function useSnapshot() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    fetch("/api/snapshot/latest")
      .then((res) => {
        if (!res.ok) throw new Error(`Snapshot fetch failed (${res.status})`);
        return res.json();
      })
      .then((raw: RawSnapshot) => {
        const normalized = normalizeSnapshot(raw);
        if (mounted) setData(normalized);
      })
      .catch((e: Error) => {
        if (mounted) setError(e.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { data, loading, error };
}
