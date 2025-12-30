// src/lib/normalizeSnapshot.ts
import type {
  Article,
  ArticleSection,
  RawSnapshot,
  Snapshot,
  Top20Item,
} from "../type/Snapshot";

function asStr(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}
function asNum(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}
function asArr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}
function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

function normalizeSections(x: unknown): ArticleSection[] {
  const arr = asArr(x);
  const out: ArticleSection[] = [];
  for (const it of arr) {
    const o = asObj(it);
    if (!o) continue;
    const heading = asStr(o.heading, "").trim();
    const text = asStr(o.text, "").trim();
    if (!heading && !text) continue;
    out.push({ heading: heading || "SECTION", text });
  }
  return out;
}

function normalizeNumbers(x: unknown): string[] {
  return asArr(x).map((v) => String(v ?? "").trim()).filter(Boolean);
}

function normalizeTop20(x: unknown): Top20Item[] {
  const arr = asArr(x);
  const out: Top20Item[] = [];

  for (const it of arr) {
    const o = asObj(it);
    if (!o) continue;

    const universeId = asNum(o.universeId);
    if (universeId == null) continue;

    out.push({
      universeId,
      placeId: asNum(o.placeId),
      name: asStr(o.name, "").trim() || "(no name)",
      playing: asNum(o.playing),
    });
  }

  // 혹시 백엔드가 순서 보장 안 하면 universeId 순이 아니라 원래 순서를 유지
  return out.slice(0, 100);
}

export function normalizeSnapshot(raw: RawSnapshot): Snapshot {
  const generatedAt = asStr(raw?.generatedAt, new Date().toISOString());

  const metaObj = asObj(raw?.meta) ?? {};
  const meta = {
    sortName: asStr(metaObj.sortName, "(unknown)"),
    sortId: asStr(metaObj.sortId, "(unknown)"),
  };

  const headlines = asArr(raw?.headlines)
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);

  // top5를 metrics/descriptionSource 공급원으로 사용
  const top5Arr = asArr(raw?.top5);
  const top5Map = new Map<number, Record<string, unknown>>();
  for (const g of top5Arr) {
    const o = asObj(g);
    if (!o) continue;
    const id = asNum(o.universeId);
    if (id == null) continue;
    top5Map.set(id, o);
  }

  // ✅ top20 normalize (없으면 [])
  const top100 = normalizeTop20((raw as any)?.top100) ?? [];

  const articlesArr = asArr(raw?.articles);
  const articles: Article[] = [];

  for (const a of articlesArr) {
    const o = asObj(a);
    if (!o) continue;

    const universeId = asNum(o.universeId);
    if (universeId == null) continue;

    // ✅ placeId는 null 허용 (continue 하면 안됨)
    const placeId = asNum(o.placeId);

    const gameName = asStr(o.gameName, "").trim() || "(no name)";
    const title = asStr(o.title, "").trim() || gameName;
    const deck = asStr(o.deck, "").trim();
    const lede = asStr(o.lede, "").trim();
    const sections = normalizeSections(o.sections);
    const whyNow = asStr(o.whyNow, "").trim();
    const numbers = normalizeNumbers(o.numbers);
    const whatToDo = asStr(o.whatToDo, "").trim();

    // ✅ metrics: articles에 없으면 top5에서 끌어옴
    const metricsSrc = (asObj((o as any).metrics) ??
      top5Map.get(universeId) ??
      {}) as Record<string, unknown>;

    const metrics = {
      playing: asNum(metricsSrc.playing),
      visits: asNum(metricsSrc.visits),
      favorites: asNum(metricsSrc.favorites),
      likeRatio: asNum(metricsSrc.likeRatio),
      updated: (metricsSrc.updated == null ? null : asStr(metricsSrc.updated)) as string | null,
      genre: (metricsSrc.genre == null ? null : asStr(metricsSrc.genre)) as string | null,
      maxPlayers: asNum(metricsSrc.maxPlayers),
    };

    // ✅ descriptionSource: top5.description을 기본으로(있으면)
    const top5 = top5Map.get(universeId);
    const descriptionSource =
      asStr((o as any).descriptionSource, "").trim() ||
      (top5 ? asStr(top5.description, "").trim() : "") ||
      null;

    articles.push({
      universeId,
      placeId,
      gameName,
      title,
      deck,
      lede,
      sections,
      whyNow,
      numbers,
      whatToDo,
      metrics,
      descriptionSource,
    });
  }

  return { generatedAt, meta, headlines, articles, top100 };
}
