import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

const EXPLORE = "https://apis.roblox.com/explore-api/v1";
const GAMES_V1 = "https://games.roblox.com/v1";

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY가 .env에 없습니다.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let cachedSnapshot = null;
let lastUpdated = null;
let lastError = null;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\nURL: ${url}\nBODY: ${text.slice(0, 800)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`JSON parse failed\nURL: ${url}\nBODY: ${text.slice(0, 800)}`);
  }
}

function extractSorts(payload) {
  if (Array.isArray(payload?.sorts)) return payload.sorts;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractItems(content) {
  if (Array.isArray(content?.items)) return content.items;
  if (Array.isArray(content?.content)) return content.content;
  if (Array.isArray(content?.games)) return content.games;
  if (Array.isArray(content?.experiences)) return content.experiences;
  if (Array.isArray(content?.data)) return content.data;

  if (Array.isArray(content?.sections)) {
    for (const sec of content.sections) {
      const arr =
        (Array.isArray(sec?.items) && sec.items) ||
        (Array.isArray(sec?.content) && sec.content) ||
        (Array.isArray(sec?.games) && sec.games) ||
        (Array.isArray(sec?.experiences) && sec.experiences);
      if (arr?.length) return arr;
    }
  }
  return [];
}

function isFiltersPayload(payload) {
  const ct = String(payload?.contentType ?? "").toLowerCase();
  const sortId = String(payload?.sortId ?? "").toLowerCase();
  return ct === "filters" || sortId === "filters" || Array.isArray(payload?.filters);
}

function pickUniverseId(it) {
  return it?.universeId ?? it?.universeID ?? it?.id ?? null;
}

function likeRatio(up, down) {
  const u = Number(up ?? 0);
  const d = Number(down ?? 0);
  const denom = u + d;
  return denom > 0 ? u / denom : null;
}

function compact(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  if (x >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(2)}B`;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1_000) return `${(x / 1_000).toFixed(2)}K`;
  return String(x);
}

async function findSortWithItems(sessionId) {
  const sortsPayload = await fetchJson(`${EXPLORE}/get-sorts?sessionId=${encodeURIComponent(sessionId)}`);
  const sorts = extractSorts(sortsPayload);

  const score = (s) => {
    const n = String(s?.name ?? s?.sortDisplayName ?? "").toLowerCase();
    if (n.includes("popular")) return 100;
    if (n.includes("trending")) return 90;
    if (n.includes("top")) return 80;
    return 10;
  };

  const candidates = sorts
    .filter((s) => String(s?.sortId ?? s?.id ?? "").toLowerCase() !== "filters")
    .sort((a, b) => score(b) - score(a))
    .slice(0, 30);

  for (const s of candidates) {
    const sortId = s?.sortId ?? s?.id;
    const sortName = s?.name ?? s?.sortDisplayName ?? "(unknown)";
    if (!sortId) continue;

    try {
      const content = await fetchJson(
        `${EXPLORE}/get-sort-content?sessionId=${encodeURIComponent(sessionId)}&sortId=${encodeURIComponent(sortId)}`
      );
      if (isFiltersPayload(content)) continue;

      const items = extractItems(content);
      if (items.length) return { sortId, sortName, items };
    } catch {
      // skip
    }
  }
  return null;
}

async function batchFetchDetails(universeIds) {
  const ids = universeIds.join(",");
  const detail = await fetchJson(`${GAMES_V1}/games?universeIds=${encodeURIComponent(ids)}`);
  const list = Array.isArray(detail?.data) ? detail.data : [];
  return new Map(list.map((g) => [g.id, g]));
}

async function batchFetchVotes(universeIds) {
  const ids = universeIds.join(",");
  const v = await fetchJson(`${GAMES_V1}/games/votes?universeIds=${encodeURIComponent(ids)}`);
  const list = Array.isArray(v?.data) ? v.data : [];
  return new Map(list.map((x) => [x.id, x]));
}

async function fetchFavoritesCounts(universeIds) {
  const map = new Map();
  for (const id of universeIds) {
    try {
      const fav = await fetchJson(`${GAMES_V1}/games/${encodeURIComponent(id)}/favorites/count`);
      map.set(id, fav?.favoritesCount ?? fav?.count ?? null);
    } catch {
      map.set(id, null);
    }
  }
  return map;
}

function clampDesc(s, max = 380) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

async function summarizeTop5WithOpenAI({ sortName, sortId, top5 }) {
  const slim = {
    sortName,
    sortId,
    games: top5.map(g => ({
      universeId: g.universeId,
      name: g.name,
      description: clampDesc(g.description, 1200), // 본문에 쓸 수 있으니 좀 더 길게
      playing: g.playing,
      visits: g.visits,
      favorites: g.favorites,
      likeRatio: g.likeRatio,
      updated: g.updated,
      genre: g.genre,
      maxPlayers: g.maxPlayers,
    })),
  };

  const res = await openai.responses.create({
    model: "gpt-5",
    reasoning: { effort: "low" },
    instructions: `
너는 Roblox 주간 게임 신문 편집장이다.

절대 규칙:
- 추측/과장/미래예측 금지
- 제공된 description 텍스트 + 수치만 근거로 작성
- description에 없는 특징을 만들어내지 말 것
- 한국어로 작성

출력은 "반드시 JSON만" 반환한다. (설명/코드블록/여는말/닫는말 금지)

반환 JSON 스키마:
{
  "headlines": ["...", "...", "..."],  // 신문 전체 헤드라인(흥미 유발)
  "articles": [
    {
      "universeId": 0,
      "gameName": "...",
      "title": "...",     // 재밌는 기사 제목
      "oneLiner": "...",  // 한 줄 설명(신문 리드문)
      "body": "..."       // 본문(2~5문단, 너무 길지 않게)
    }
  ]
}

작성 팁:
- title은 신문 제목처럼 짧고 임팩트 있게(말장난/비유 가능, 그러나 과장 금지)
- oneLiner는 description을 한 줄로 압축(핵심 장르/플레이 경험)
- body는 description에서 뽑은 요소들을 신문 톤으로 정리(게임 소개 + 특징 + 플레이 포인트)
`.trim(),
    input: [{ role: "user", content: JSON.stringify(slim) }],
  });

  const raw = extractTextFromResponse(res);

  if (!raw) {
    console.warn("⚠️ AI JSON empty:", { status: res?.status, incomplete: res?.incomplete_details, usage: res?.usage });
    return null;
  }

  // ✅ JSON 파싱/검증
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("❌ AI JSON parse failed. raw:", raw.slice(0, 500));
    return null;
  }

  // 최소 검증
  if (!Array.isArray(parsed?.articles)) return null;
  return parsed;
}

function kstDateKey(d = new Date()) {
  // KST 기준 YYYY-MM-DD
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function saveSnapshot(payload) {
  const dir = path.join(process.cwd(), "public", "snapshots");
  await mkdir(dir, { recursive: true });

  const dateKey = kstDateKey(new Date(payload.generatedAt));

  const latestPath = path.join(dir, "latest.json");
  const datedPath = path.join(dir, `roblox_top5_${dateKey}.json`);

  // 1) 날짜별 스냅샷 (불변)
  await writeFile(datedPath, JSON.stringify(payload, null, 2), "utf-8");

  // 2) latest 갱신
  await writeFile(latestPath, JSON.stringify(payload, null, 2), "utf-8");

  return { latestPath, datedPath };
}

function extractTextFromResponse(res) {
  if (!res || !Array.isArray(res.output)) return "";

  for (const item of res.output) {
    if (!Array.isArray(item.content)) continue;

    for (const c of item.content) {
      if (c.type === "output_text" && typeof c.text === "string") {
        return c.text.trim();
      }
      if (c.type === "text" && typeof c.text === "string") {
        return c.text.trim();
      }
    }
  }
  return "";
}

async function generateSnapshot() {
  // ✅ 핵심: sessionId 하이픈 제거 (400 방지)
  const sessionId = randomUUID().replace(/-/g, "");

  const picked = await findSortWithItems(sessionId);
  if (!picked) throw new Error("Explore에서 items를 반환하는 sort를 찾지 못했습니다.");

  const topCandidates = picked.items
    .map((it) => ({
      universeId: pickUniverseId(it),
      exploreName: it?.name ?? it?.title ?? null,
      explorePlaying: it?.playing ?? it?.playerCount ?? null,
      exploreVisits: it?.visits ?? null,
    }))
    .filter((x) => x.universeId);

  const top5 = topCandidates.slice(0, 5);
  const universeIds = top5.map((x) => x.universeId);

  const [detailsMap, votesMap, favMap] = await Promise.all([
    batchFetchDetails(universeIds),
    batchFetchVotes(universeIds),
    fetchFavoritesCounts(universeIds),
  ]);

  const enriched = top5.map((x) => {
    const d = detailsMap.get(x.universeId);
    const v = votesMap.get(x.universeId);
    const fav = favMap.get(x.universeId);

    const up = v?.upVotes ?? null;
    const down = v?.downVotes ?? null;

    const playing = d?.playing ?? x.explorePlaying ?? null;
    const visits = d?.visits ?? x.exploreVisits ?? null;

    const ratio = likeRatio(up, down);

    return {
      universeId: x.universeId,
      name: d?.name ?? x.exploreName ?? "(no name)",
      description: d?.description ?? null,
      creator: d?.creator ? { id: d.creator.id, name: d.creator.name, type: d.creator.type } : null,
      playing,
      visits,
      favorites: fav,
      upVotes: up,
      downVotes: down,
      likeRatio: ratio == null ? null : Number(ratio.toFixed(6)),
      created: d?.created ?? null,
      updated: d?.updated ?? null,
      maxPlayers: d?.maxPlayers ?? null,
      genre: d?.genre ?? null,
      playing_compact: compact(playing),
      visits_compact: compact(visits),
      favorites_compact: compact(fav),
    };
  });

  // ✅ AI는 "텍스트"가 아니라 "JSON(헤드라인+기사들)"로 받는 걸 권장
  const ai = await summarizeTop5WithOpenAI({
    sortName: picked.sortName,
    sortId: picked.sortId,
    top5: enriched,
  });
  // ai 예시: { headlines: string[], articles: [{ universeId, gameName, title, oneLiner, body }] }

  // ✅ AI 실패해도 서비스는 살아야 하니 fallback 준비
  const headlines = Array.isArray(ai?.headlines) ? ai.headlines.slice(0, 3) : [];

  const aiArticles = new Map(
    (Array.isArray(ai?.articles) ? ai.articles : []).map((a) => [Number(a.universeId), a])
  );

  const articles = enriched.map((g) => {
    const a = aiArticles.get(g.universeId);

    return {
      universeId: g.universeId,
      gameName: g.name,

      // 신문용 콘텐츠
      title: (a?.title && String(a.title).trim()) || g.name,
      oneLiner: (a?.oneLiner && String(a.oneLiner).trim()) || (clampDesc(g.description, 120) ?? "설명이 없습니다."),
      body:
        (a?.body && String(a.body).trim()) ||
        (clampDesc(g.description, 800) ?? "설명이 없습니다."),

      // 근거/팩트(프론트에서 뱃지로 표시)
      metrics: {
        playing: g.playing,
        visits: g.visits,
        favorites: g.favorites,
        likeRatio: g.likeRatio,
        updated: g.updated,
        genre: g.genre,
        maxPlayers: g.maxPlayers,
      },

      // 원문 보존 (검증/디버깅용)
      descriptionSource: g.description ?? null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    meta: { sortName: picked.sortName, sortId: picked.sortId },

    // ✅ 새 스키마
    headlines,
    articles,

    // (선택) 원래 top5도 유지하고 싶으면 같이 넣어도 됨
    top5: enriched
  };
}

async function refreshSnapshot() {
  try {
    lastError = null;
    const snap = await generateSnapshot();
    cachedSnapshot = snap;
    lastUpdated = new Date().toISOString();

    const { latestPath, datedPath } = await saveSnapshot(snap);

    console.log("✔ Snapshot updated");
    console.log("  latest:", latestPath);
    console.log("  dated :", datedPath);
  } catch (e) {
    lastError = e?.message ?? String(e);
    console.error("❌ Snapshot update failed", lastError);
  }
}
// 서버 시작 시 1회
await refreshSnapshot();

// 매주 월요일 00:05 (서버 시간 기준) — 필요하면 KST로 맞춰서 운영
cron.schedule("5 0 * * 1", refreshSnapshot);