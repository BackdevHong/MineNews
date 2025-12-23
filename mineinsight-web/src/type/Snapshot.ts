export type TopGame = {
  universeId: number;
  name: string;
  description: string | null;

  playing: number | null;
  visits: number | null;
  favorites: number | null;

  upVotes: number | null;
  downVotes: number | null;
  likeRatio: number | null;

  creator: Creator;
  created: string | null;
  updated: string | null;
  maxPlayers: number | null;
  genre: string | null;

  playing_compact?: string | null;
  visits_compact?: string | null;
  favorites_compact?: string | null;

  delta?: {
    playing: number | null;
    playingPct?: number | null;
    // (원하면 visits/favorites도 여기에)
  };
};

type Creator = { id?: number; name?: string; type?: string } | null;

// export type Snapshot = {
//   generatedAt: string;
//   meta: { sortName: string; sortId: string };
//   top5: TopGame[];
//   ai: { summary: string };
// };

export type Article = {
  universeId: number;
  gameName: string;
  title: string;
  oneLiner: string;
  body: string;
  metrics: {
    playing: number | null;
    visits: number | null;
    favorites: number | null;
    likeRatio: number | null;
    updated: string | null;
    genre: string | null;
    maxPlayers: number | null;
  };
  descriptionSource: string | null;
};

export type Snapshot = {
  generatedAt: string;
  meta: { sortName: string; sortId: string };
  headlines: string[];
  articles: Article[];
};