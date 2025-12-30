// src/type/Snapshot.ts

export type ArticleSection = {
  heading: string;
  text: string;
};

export type Article = {
  universeId: number;
  placeId: number | null;
  gameName: string;

  // ✅ 백엔드 AI 스키마 그대로
  title: string;
  deck: string;
  lede: string;
  sections: ArticleSection[];
  whyNow: string;
  numbers: string[];
  whatToDo: string;

  // ✅ metrics는 네가 이미 쓰고 있으니 그대로 유지
  metrics: {
    playing: number | null;
    visits: number | null;
    favorites: number | null;
    likeRatio: number | null;
    updated: string | null;
    genre: string | null;
    maxPlayers: number | null;
  };

  // (선택) raw description 보여주고 싶을 때만
  descriptionSource: string | null;
};

export type Snapshot = {
  generatedAt: string;
  meta: { sortName: string; sortId: string };
  headlines: string[];
  articles: Article[];
  top100?: Top20Item[]; // ✅ optional (구버전 snapshot 대응)
};

// ---------------------------------------
// RawSnapshot (백엔드가 주는 형태)
// ---------------------------------------
export type RawAISection = { heading?: unknown; text?: unknown };

export type RawAIArticle = {
  universeId?: unknown;
  gameName?: unknown;

  title?: unknown;
  deck?: unknown;
  lede?: unknown;
  sections?: unknown; // RawAISection[]
  whyNow?: unknown;
  numbers?: unknown; // string[]
  whatToDo?: unknown;

  // metrics가 articles에 들어올 수도 있고, top5에 따로 있을 수도 있으니 normalize에서 합침
  metrics?: unknown;
  descriptionSource?: unknown;
};

export type RawGame = {
  universeId?: unknown;
  name?: unknown;
  description?: unknown;

  playing?: unknown;
  visits?: unknown;
  favorites?: unknown;
  likeRatio?: unknown;
  updated?: unknown;
  genre?: unknown;
  maxPlayers?: unknown;
};

export type RawSnapshot = {
  generatedAt?: unknown;
  meta?: unknown;
  headlines?: unknown;
  articles?: unknown; // RawAIArticle[]
  top5?: unknown;     // RawGame[]
  top100?: unknown;    // ✅ 추가
};

export type Top20Item = {
  universeId: number;
  placeId: number | null;
  name: string;
  playing: number | null;
};
