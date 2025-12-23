import { useEffect, useState } from "react";
import type { Snapshot } from "../type/Snapshot";

export function useSnapshot() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    fetch("/api/snapshot/latest")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Snapshot fetch failed (${res.status})`);
        }
        return res.json();
      })
      .then((json: Snapshot) => {
        if (mounted) setData(json);
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