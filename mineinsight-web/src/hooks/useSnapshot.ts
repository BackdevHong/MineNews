import { useEffect, useState } from "react";
import type { Snapshot } from "../type/Snapshot";

export function useSnapshot() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/snapshot/latest")
      .then(res => {
        if (!res.ok) throw new Error("Snapshot fetch failed");
        return res.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}