import express from "express";
import fs from "fs/promises";
import path from "path";

const app = express();
const PORT = 3001;

const SNAPSHOT_DIR = path.join(process.cwd(), "public", "snapshots");
const THUMB_BASE = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";

const thumbCache = new Map(); // key -> { expiresAt, payload }
const THUMB_TTL_MS = 1000 * 60 * 30; // 30분

async function listSnapshotFiles() {
  const files = (await fs.readdir(SNAPSHOT_DIR))
    .filter((f) => f.startsWith("roblox_top5_") && f.endsWith(".json"))
    .sort(); // 날짜 기준 정렬(파일명이 YYYY-MM-DD라면 OK)
  return files;
}

async function readSnapshot(fileName) {
  const p = path.join(SNAPSHOT_DIR, fileName);
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

function deltaNumber(cur, prev) {
  if (cur == null || prev == null) return null;
  return cur - prev;
}

function deltaPct(cur, prev) {
  if (cur == null || prev == null) return null;
  if (prev === 0) return null;
  return (cur - prev) / prev; // -1~inf
}

function buildDeltaSnapshot(latest, prev) {
  const prevMap = new Map((prev?.top5 ?? []).map((g) => [g.universeId, g]));

  const top5 = (latest.top5 ?? []).map((g) => {
    const p = prevMap.get(g.universeId);

    const dPlaying = deltaNumber(g.playing, p?.playing ?? null);
    const dVisits = deltaNumber(g.visits, p?.visits ?? null);
    const dFav = deltaNumber(g.favorites, p?.favorites ?? null);
    const dLike = deltaNumber(g.likeRatio, p?.likeRatio ?? null);

    const dPlayingPct = deltaPct(g.playing, p?.playing ?? null);
    const dFavPct = deltaPct(g.favorites, p?.favorites ?? null);

    return {
      ...g,
      delta: {
        playing: dPlaying,
        visits: dVisits,
        favorites: dFav,
        likeRatio: dLike,
        playingPct: dPlayingPct,
        favoritesPct: dFavPct,
        prevUpdated: p?.updated ?? null,
      },
    };
  });

  return {
    ...latest,
    prevMeta: prev
      ? { generatedAt: prev.generatedAt, sortId: prev.meta?.sortId, sortName: prev.meta?.sortName }
      : null,
    top5,
  };
}

// ✅ 최신(=가장 최근 파일) + 이전(=그 다음 파일) + Δ 포함해서 반환
app.get("/api/snapshot/latest", async (req, res) => {
  try {
    const files = await listSnapshotFiles();
    if (files.length === 0) return res.status(404).json({ error: "No snapshot found" });

    const latestFile = files[files.length - 1];
    const prevFile = files.length >= 2 ? files[files.length - 2] : null;

    const latest = await readSnapshot(latestFile);
    const prev = prevFile ? await readSnapshot(prevFile) : null;

    res.json(buildDeltaSnapshot(latest, prev));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Snapshot load failed" });
  }
});

async function fetchRobloxThumbnails(universeIdsCsv) {
  const url =
    `${THUMB_BASE}?universeIds=${encodeURIComponent(universeIdsCsv)}` +
    `&size=768x432&format=Png&isCircular=false`;

  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MineInsight/1.0" } });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Roblox thumbnails error ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

app.get("/api/thumbnails", async (req, res) => {
  try {
    const universeIds = String(req.query.universeIds ?? "").trim();
    if (!universeIds) return res.status(400).json({ error: "universeIds required" });

    const now = Date.now();
    const cached = thumbCache.get(universeIds);
    if (cached && cached.expiresAt > now) {
      res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
      return res.json(cached.payload);
    }

    const json = await fetchRobloxThumbnails(universeIds);

    thumbCache.set(universeIds, { expiresAt: now + THUMB_TTL_MS, payload: json });
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "thumbnail proxy failed" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API running on http://localhost:${PORT}`);
});

function logAndExit(sig) {
  const when = new Date().toISOString();
  console.error(`[${when}] 🔥 received ${sig}`);
  console.error(`pid=${process.pid} uptime=${Math.round(process.uptime())}s`);
  // 어떤 코드가 종료를 유도했는지 힌트가 될 때가 있어서 스택도 남김
  console.error(new Error(`Signal ${sig} captured`).stack);
  // PM2가 정상 종료로 보이게끔
  process.exit(0);
}

process.on("SIGINT", () => logAndExit("SIGINT"));
process.on("SIGTERM", () => logAndExit("SIGTERM"));
process.on("SIGHUP", () => logAndExit("SIGHUP"));