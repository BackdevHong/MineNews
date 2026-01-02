import { useEffect, useMemo, useState } from "react";

type ThumbMap = Record<number, string | null>;

function pickThumbUrl(payload: any, universeId: number): string | null {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const item = data.find((x: any) => Number(x?.universeId) === Number(universeId));
  const thumbs = Array.isArray(item?.thumbnails) ? item.thumbnails : [];

  const best =
    thumbs.find((t: any) => String(t?.state).toLowerCase() === "completed") ??
    thumbs[0];

  return (best?.imageUrl ?? null) as string | null;
}

export function useThumbnails(universeIds: number[]) {
  const [map, setMap] = useState<ThumbMap>({});
  const [loading, setLoading] = useState(false);

  const csv = useMemo(() => {
    const ids = Array.from(new Set(universeIds.filter(Boolean))).slice(0, 50);
    return ids.join(",");
  }, [universeIds]);

  useEffect(() => {
    let alive = true;
    async function run() {
      if (!csv) {
        setMap({});
        return;
      }
      setLoading(true);
      try {
        const r = await fetch(`/api/thumbnails?universeIds=${encodeURIComponent(csv)}`, {
          headers: { Accept: "application/json" },
        });
        if (!r.ok) throw new Error(`thumb fetch failed: ${r.status}`);
        const json = await r.json();

        const ids = csv.split(",").map((s) => Number(s));
        const next: ThumbMap = {};
        for (const id of ids) next[id] = pickThumbUrl(json, id);

        if (alive) setMap(next);
      } catch {
        if (alive) setMap({});
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [csv]);

  return { thumbs: map, loading };
}