import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const EXPLORE = "https://apis.roblox.com/explore-api/v1";
const GAMES_V1 = "https://games.roblox.com/v1";

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY가 .env에 없습니다.");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ROBLOX_BATCH_LIMIT = 25;

let cachedSnapshot = null;
let lastUpdated = null;
let lastError = null;

/* -------------------- fetch helpers -------------------- */
async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${res.statusText}\nURL: ${url}\nBODY: ${text.slice(0, 800)}`
    );
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

function clampDesc(s, max = 380) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/* -------------------- explore sorting -------------------- */
async function findSortWithItems(sessionId) {
  const sortsPayload = await fetchJson(
    `${EXPLORE}/get-sorts?sessionId=${encodeURIComponent(sessionId)}`
  );
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
        `${EXPLORE}/get-sort-content?sessionId=${encodeURIComponent(
          sessionId
        )}&sortId=${encodeURIComponent(sortId)}`
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

/* -------------------- games details -------------------- */
async function batchFetchDetails(universeIds) {
  const out = new Map();

  for (const idsChunk of chunk(universeIds, ROBLOX_BATCH_LIMIT)) {
    const ids = idsChunk.join(",");
    const detail = await fetchJson(
      `${GAMES_V1}/games?universeIds=${encodeURIComponent(ids)}`
    );
    const list = Array.isArray(detail?.data) ? detail.data : [];
    for (const g of list) out.set(g.id, g);
  }

  return out;
}

async function batchFetchVotes(universeIds) {
  const out = new Map();

  for (const idsChunk of chunk(universeIds, ROBLOX_BATCH_LIMIT)) {
    const ids = idsChunk.join(",");
    const v = await fetchJson(
      `${GAMES_V1}/games/votes?universeIds=${encodeURIComponent(ids)}`
    );
    const list = Array.isArray(v?.data) ? v.data : [];
    for (const x of list) out.set(x.id, x);
  }

  return out;
}

async function fetchFavoritesCounts(universeIds, concurrency = 5) {
  const map = new Map();
  let i = 0;

  async function worker() {
    while (i < universeIds.length) {
      const id = universeIds[i++];
      try {
        const fav = await fetchJson(
          `${GAMES_V1}/games/${encodeURIComponent(id)}/favorites/count`
        );
        map.set(id, fav?.favoritesCount ?? fav?.count ?? null);
      } catch {
        map.set(id, null);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, universeIds.length) },
      () => worker()
    )
  );

  return map;
}

async function enrichCandidates(candidates, { favConcurrency = 5 } = {}) {
  const universeIds = candidates.map((x) => x.universeId);

  const [detailsMap, votesMap, favMap] = await Promise.all([
    batchFetchDetails(universeIds),
    batchFetchVotes(universeIds),
    fetchFavoritesCounts(universeIds, favConcurrency),
  ]);

  return candidates.map((x) => {
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
      placeId: d?.rootPlaceId ?? null,
      name: d?.name ?? x.exploreName ?? "(no name)",
      description: d?.description ?? null,
      creator: d?.creator
        ? { id: d.creator.id, name: d.creator.name, type: d.creator.type }
        : null,
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
}

/* -------------------- OpenAI: summary (JSON schema 그대로) -------------------- */
function extractTextFromResponse(res) {
  // 최신 SDK면 res.output_text가 있을 수 있어서 우선 사용
  if (res?.output_text && typeof res.output_text === "string") {
    return res.output_text.trim();
  }
  // fallback: output 배열에서 텍스트 찾기
  if (!res || !Array.isArray(res.output)) return "";
  for (const item of res.output) {
    if (!Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c.type === "output_text" && typeof c.text === "string") return c.text.trim();
      if (c.type === "text" && typeof c.text === "string") return c.text.trim();
    }
  }
  return "";
}

async function summarizeTop5WithOpenAI({ sortName, sortId, top5 }) {
  const slim = {
    sortName,
    sortId,
    games: top5.map((g) => ({
      universeId: g.universeId,
      name: g.name,
      description: clampDesc(g.description, 1200),
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
      - 제공된 description 텍스트 + 수치(metrics)만 근거로 작성
      - description에 없는 특징을 만들어내지 말 것
      - 한국어로 작성
      - 출력은 반드시 JSON만 반환 (설명/코드블록 금지)

      길이/형식 규칙(매우 중요):
      - 기사 1개당 전체 분량: 900~1400자(공백 포함) 목표
      - deck 1문장, lede 2~3문장
      - sections는 3~4개, 각 section은 2~4문장
      - numbers에는 제공된 수치만 문장형으로 정리(없으면 '—')
      - updated/genre/maxPlayers 등이 있으면 본문에 자연스럽게 포함

      반환 JSON 스키마(반드시 이 키로!):
      {
        "headlines": ["...", "...", "..."],
        "articles": [
          {
            "universeId": 0,
            "gameName": "...",
            "title": "...",
            "deck": "...",
            "lede": "...",
            "sections": [
              {"heading":"...", "text":"..."},
              {"heading":"...", "text":"..."},
              {"heading":"...", "text":"..."}
            ],
            "whyNow": "...",
            "numbers": ["...", "...", "..."],
            "whatToDo": "..."
          }
        ]
      }

      작성 팁:
      - title은 신문 헤드라인처럼 짧고 강하게(말장난/비유 가능, 과장 금지)
      - whyNow는 '설명에서 드러나는 특징' + '수치'로만 서술
      - whatToDo는 설명에 있는 플레이 방식/목표/콘텐츠를 바탕으로 추천 대상/플레이 포인트를 정리
    `.trim(),
    input: [{ role: "user", content: JSON.stringify(slim) }],
  });

  const raw = extractTextFromResponse(res);

  if (!raw) {
    console.warn("⚠️ AI JSON empty:", {
      status: res?.status,
      incomplete: res?.incomplete_details,
      usage: res?.usage,
    });
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("❌ AI JSON parse failed. raw:", raw.slice(0, 800));
    return null;
  }

  if (!Array.isArray(parsed?.articles)) return null;
  return parsed;
}

function validateAiPayload(ai, universeIds) {
  if (!ai || typeof ai !== "object") return null;

  const headlines = Array.isArray(ai.headlines)
    ? ai.headlines.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 3)
    : [];

  const articles = Array.isArray(ai.articles) ? ai.articles : [];
  if (!articles.length) return null;

  const map = new Map();

  for (const a of articles) {
    const id = Number(a?.universeId);
    if (!Number.isFinite(id)) continue;

    const ok =
      typeof a?.gameName === "string" &&
      typeof a?.title === "string" &&
      typeof a?.deck === "string" &&
      typeof a?.lede === "string" &&
      Array.isArray(a?.sections) &&
      a.sections.length >= 3 &&
      a.sections.length <= 4 &&
      a.sections.every(
        (s) => s && typeof s.heading === "string" && typeof s.text === "string"
      ) &&
      typeof a?.whyNow === "string" &&
      Array.isArray(a?.numbers) &&
      typeof a?.whatToDo === "string";

    if (!ok) continue;

    map.set(id, {
      universeId: id,
      gameName: String(a.gameName).trim(),
      title: String(a.title).trim(),
      deck: String(a.deck).trim(),
      lede: String(a.lede).trim(),
      sections: a.sections.map((s) => ({
        heading: String(s.heading).trim(),
        text: String(s.text).trim(),
      })),
      whyNow: String(a.whyNow).trim(),
      numbers: a.numbers.map((x) => String(x).trim()).filter(Boolean),
      whatToDo: String(a.whatToDo).trim(),
    });
  }

  // TOP5 전부 커버 못하면 → 전체를 실패 처리(=전부 fallback)로 안정성 우선
  const allCovered = universeIds.every((id) => map.has(id));
  if (!allCovered) return null;

  return { headlines, articleMap: map };
}

/* -------------------- snapshot file save -------------------- */
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

  await writeFile(datedPath, JSON.stringify(payload, null, 2), "utf-8");
  await writeFile(latestPath, JSON.stringify(payload, null, 2), "utf-8");

  return { latestPath, datedPath };
}

/* -------------------- snapshot generation -------------------- */
async function generateSnapshot() {
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

  const top5Candidates = topCandidates.slice(0, 5);
  const top100Candidates = topCandidates.slice(0, 100);

  // ✅ Top5는 기사/헤드라인용 (기존처럼)
  const top5 = await enrichCandidates(top5Candidates, { favConcurrency: 5 });

  // ✅ Top100은 랭킹/리스트용 (분할 배치로 안전하게)
  // favorites/count 호출이 100개라 부담되면 favConcurrency를 3~5 추천
  const top100 = await enrichCandidates(top100Candidates, { favConcurrency: 4 });

  // ✅ AI는 top5만
  const aiRaw = await summarizeTop5WithOpenAI({
    sortName: picked.sortName,
    sortId: picked.sortId,
    top5,
  });

  const validated = validateAiPayload(aiRaw, top5.map((g) => g.universeId));
  const articleMap = validated?.articleMap ?? new Map();
  const headlines = validated?.headlines?.length ? validated.headlines : [];

  const fallbackArticle = (g) => ({
    universeId: g.universeId,
    gameName: g.name,
    title: g.name,
    deck: clampDesc(g.description, 120) ?? "설명이 없습니다.",
    lede: clampDesc(g.description, 260) ?? "설명이 없습니다.",
    sections: [
      { heading: "무엇을 하는 게임인가", text: clampDesc(g.description, 420) ?? "설명이 없습니다." },
      { heading: "플레이 포인트", text: "제공된 설명을 바탕으로 핵심 목표/콘텐츠를 확인해보세요." },
      {
        heading: "지표 요약",
        text: `현재 동접(playing): ${g.playing ?? "—"}, 방문(visits): ${g.visits ?? "—"}, 즐겨찾기(favorites): ${g.favorites ?? "—"}, 좋아요 비율(likeRatio): ${g.likeRatio ?? "—"}`,
      },
    ],
    whyNow: "설명과 지표에서 확인 가능한 범위 내에서만 요약했습니다.",
    numbers: [
      `동접(playing): ${g.playing ?? "—"}`,
      `방문(visits): ${g.visits ?? "—"}`,
      `즐겨찾기(favorites): ${g.favorites ?? "—"}`,
      `좋아요 비율(likeRatio): ${g.likeRatio ?? "—"}`,
      `장르(genre): ${g.genre ?? "—"}`,
      `최대 인원(maxPlayers): ${g.maxPlayers ?? "—"}`,
      `업데이트(updated): ${g.updated ?? "—"}`,
    ],
    whatToDo: "설명에 적힌 목표와 콘텐츠 흐름을 따라 첫 판을 시작해보세요.",
  });

  const articles = top5.map((g) => {
    const base = articleMap.get(g.universeId) ?? fallbackArticle(g);
    return { ...base, placeId: g.placeId ?? null };
  });

  return {
    generatedAt: new Date().toISOString(),
    meta: { sortName: picked.sortName, sortId: picked.sortId },

    headlines,
    articles,

    top5,
    top100, // ✅ 추가!
  };
}

/* -------------------- refresh loop -------------------- */
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

/* -------------------- boot -------------------- */
await refreshSnapshot();

// 매주 월요일 00:05 KST
cron.schedule("5 0 * * 1", refreshSnapshot, { timezone: "Asia/Seoul" });

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}