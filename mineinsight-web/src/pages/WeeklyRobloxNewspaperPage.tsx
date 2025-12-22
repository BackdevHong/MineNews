import { useMemo, useState, useEffect } from "react";
import type { Snapshot, TopGame } from "../type/Snapshot";
import { useSnapshot } from "../hooks/useSnapshot";

type Thumb = { universeId: number; url: string | null };

// ---------- helpers ----------
function pct(x: number | null) {
  if (x == null) return "—";
  return `${Math.round(x * 100)}%`;
}
function compact(n: number | null) {
  if (n == null) return "—";
  const x = n;
  if (x >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(2)}B`;
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1_000) return `${(x / 1_000).toFixed(2)}K`;
  return String(x);
}
function clampText(s: string | null, max = 220) {
  if (!s) return "설명이 없습니다.";
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) + "…" : t;
}
function safeDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { dateStyle: "medium" });
}

function toneFromRatio(r: number | null): "neutral" | "good" | "info" | "bad" {
  if (r == null) return "neutral";
  if (r >= 0.92) return "good";
  if (r >= 0.85) return "info";
  return "bad";
}

function StatPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "info";
}) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20"
      : tone === "bad"
      ? "bg-rose-500/10 text-rose-200 ring-rose-400/20"
      : tone === "info"
      ? "bg-sky-500/10 text-sky-200 ring-sky-400/20"
      : "bg-white/5 text-white/80 ring-white/10";
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ${cls}`}>
      <span className="opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <h2 className="text-sm font-semibold text-white/90">{title}</h2>
        {hint ? <div className="mt-1 text-xs text-white/50">{hint}</div> : null}
      </div>
    </div>
  );
}

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="absolute left-1/2 top-1/2 w-[min(820px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-zinc-950 ring-1 ring-white/10 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="text-sm font-semibold text-white">{title}</div>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
          >
            닫기
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1
      ? "bg-amber-500/15 text-amber-200 ring-amber-400/30"
      : rank === 2
      ? "bg-slate-200/10 text-slate-100 ring-slate-200/20"
      : rank === 3
      ? "bg-orange-500/10 text-orange-200 ring-orange-400/20"
      : "bg-white/5 text-white/70 ring-white/10";
  return (
    <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ${cls}`}>
      #{rank}
    </div>
  );
}

function MetricBar({
  label,
  value,
  hint,
}: {
  label: string;
  value: number; // 0..100
  hint: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/60">{label}</div>
        <div className="text-xs font-semibold text-white/80">{hint}</div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/30 ring-1 ring-white/10">
        <div className="h-full rounded-full bg-white/60" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function parseHeadlineBlock(text: string): { bullets: string[]; lines: string[] } {
  const lines = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("•")).slice(0, 3).map((l) => l.replace(/^•\s*/, ""));
  return { bullets, lines };
}

async function fetchThumbnails(universeIds: number[]): Promise<Map<number, string | null>> {
  if (universeIds.length === 0) return new Map();

  // Roblox thumbnails API (universeIds 기반)
  const url =
  "/api/thumbnails" +
  `?universeIds=${encodeURIComponent(universeIds.join(","))}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return new Map(universeIds.map((id) => [id, null]));

  const json = await res.json();

  // 응답 구조가 바뀌거나 실패 대비해서 방어적으로 파싱
  // 보통 { data: [{ universeId, thumbnails: [{ imageUrl }] }] } 또는 유사 형태가 옴
  const map = new Map<number, string | null>();

  const data = Array.isArray(json?.data) ? json.data : [];
  for (const row of data) {
    const uid = Number(row?.universeId ?? row?.targetId ?? row?.id);
    let imageUrl: string | null = null;

    if (typeof row?.imageUrl === "string") imageUrl = row.imageUrl;
    if (!imageUrl && Array.isArray(row?.thumbnails) && row.thumbnails[0]?.imageUrl) {
      imageUrl = row.thumbnails[0].imageUrl;
    }
    if (!imageUrl && Array.isArray(row?.thumbnails) && row.thumbnails[0]?.url) {
      imageUrl = row.thumbnails[0].url;
    }

    if (Number.isFinite(uid)) map.set(uid, imageUrl);
  }

  // 누락된 건 null로 채움
  for (const id of universeIds) if (!map.has(id)) map.set(id, null);

  return map;
}

function deltaBadge(n: number | null, unit = "") {
  if (n == null) return { text: "—", tone: "neutral" as const };
  if (n > 0) return { text: `▲ ${compact(n)}${unit}`, tone: "good" as const };
  if (n < 0) return { text: `▼ ${compact(Math.abs(n))}${unit}`, tone: "bad" as const };
  return { text: `• 0${unit}`, tone: "neutral" as const };
}

function deltaPctBadge(p: number | null) {
  if (p == null) return { text: "—", tone: "neutral" as const };
  const v = p * 100;
  if (v > 0) return { text: `(+${v.toFixed(1)}%)`, tone: "good" as const };
  if (v < 0) return { text: `(${v.toFixed(1)}%)`, tone: "bad" as const };
  return { text: "(0.0%)", tone: "neutral" as const };
}

// ---------- Page ----------
export default function WeeklyRobloxNewspaperPage() {
// ✅ 1. Hook 전부 최상단
  const [selected, setSelected] = useState<TopGame | null>(null);
  const [thumbs, setThumbs] = useState<Map<number, string | null>>(new Map());
  const { data: SNAP, loading, error } = useSnapshot();

  // ✅ 썸네일 fetch effect
  useEffect(() => {
    if (!SNAP) return;

    const ids = SNAP.top5.map((g) => g.universeId);
    fetchThumbnails(ids)
      .then(setThumbs)
      .catch(() =>
        setThumbs(new Map(ids.map((id) => [id, null])))
      );
  }, [SNAP]); // 🔑 SNAP 의존성 필수

  // ✅ 메모들
  const headerDate = useMemo(() => {
    if (!SNAP) return "";
    return new Date(SNAP.generatedAt).toLocaleString("ko-KR", {
      dateStyle: "full",
      timeStyle: "short",
    });
  }, [SNAP]);

  const { bullets } = useMemo(() => {
    if (!SNAP) return { bullets: [] };
    return parseHeadlineBlock(SNAP.ai.summary);
  }, [SNAP]);

  // ✅ 2. 이제서야 조건부 return
    if (loading) {
    return (
        <div className="min-h-screen bg-zinc-950 text-white">
        <div className="mx-auto px-10 py-10 space-y-6">
            <div className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-8">
            <div className="h-4 w-40 bg-white/10 rounded animate-pulse" />
            <div className="mt-4 h-10 w-[520px] bg-white/10 rounded-2xl animate-pulse" />
            <div className="mt-6 grid gap-2">
                <div className="h-12 bg-white/5 ring-1 ring-white/10 rounded-2xl animate-pulse" />
                <div className="h-12 bg-white/5 ring-1 ring-white/10 rounded-2xl animate-pulse" />
                <div className="h-12 bg-white/5 ring-1 ring-white/10 rounded-2xl animate-pulse" />
            </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-5 h-[420px] animate-pulse" />
            <div className="lg:col-span-2 space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-5 h-[190px] animate-pulse" />
                ))}
            </div>
            </div>
        </div>
        </div>
    );
    }

  if (error || !SNAP) {
    return <div className="p-10 text-red-400">데이터 로드 실패</div>;
  }

  const top1 = SNAP.top5[0];

  // 간단한 “상대적” 바(Top5 중 max 기준) — 보기용
  const maxPlaying = Math.max(...SNAP.top5.map((g) => g.playing ?? 0), 1);
  const maxVisits = Math.max(...SNAP.top5.map((g) => g.visits ?? 0), 1);
  const maxFav = Math.max(...SNAP.top5.map((g) => g.favorites ?? 0), 1);

  const d1 = deltaBadge(top1.delta?.playing ?? null);
  const d1p = deltaPctBadge(top1.delta?.playingPct ?? null);

  console.log(top1)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-gradient-to-br from-sky-500/20 via-purple-500/15 to-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] translate-x-1/3 translate-y-1/3 rounded-full bg-gradient-to-tr from-rose-500/10 via-amber-500/10 to-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto px-10 py-10">
        {/* Hero */}
        <div className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-6 md:p-8 shadow-2xl">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs text-white/55">MineInsight • Weekly Roblox Newspaper</div>
              <h1 className="mt-2 text-3xl md:text-4xl font-extrabold tracking-tight">
                이번 주 <span className="text-white/80">TOP 5</span> 게임 리포트
              </h1>
              <div className="mt-3 text-sm text-white/60">
                기준 정렬: <span className="text-white/85">{SNAP.meta.sortName}</span>{" "}
                <span className="text-white/30">({SNAP.meta.sortId})</span>
                <span className="mx-2 text-white/20">•</span>
                생성: <span className="text-white/85">{headerDate}</span>
              </div>

              {/* Bullet Headlines */}
              <div className="mt-5 grid gap-2">
                {(bullets.length ? bullets : ["헤드라인이 아직 없습니다."]).map((b, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-2xl bg-black/20 ring-1 ring-white/10 px-4 py-3"
                  >
                    <div className="h-2.5 w-2.5 rounded-full bg-white/70" />
                    <div className="text-sm text-white/80">{b}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top1 Spotlight */}
            {top1 ? (
              <div className="md:w-[360px] rounded-3xl bg-gradient-to-b from-white/8 to-white/4 ring-1 ring-white/10 p-5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-white/70">Spotlight</div>
                  <RankBadge rank={1} />
                </div>
                <div className="mt-3 overflow-hidden rounded-2xl ring-1 ring-white/10 bg-black/30">
                {thumbs.get(top1.universeId) ? (
                    <img
                    src={thumbs.get(top1.universeId) ?? ""}
                    alt={top1.name}
                    className="h-[140px] w-full object-cover"
                    loading="lazy"
                    />
                ) : (
                    <div className="h-[140px] w-full animate-pulse bg-white/5" />
                )}
                </div>
                <div className="mt-2 text-lg font-semibold text-white">{top1.name}</div>
                <div className="mt-2 text-sm text-white/65">{clampText(top1.description, 140)}</div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <StatPill label="동접" value={top1.playing_compact ?? compact(top1.playing)} tone="info" />
                    <StatPill label="동접Δ" value={`${d1.text} ${d1p.text}`} tone={d1.tone} />
                    <StatPill label="호감도" value={pct(top1.likeRatio)} tone={toneFromRatio(top1.likeRatio)} />
                    <StatPill label="즐겨찾기" value={top1.favorites_compact ?? compact(top1.favorites)} />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2">
                  <MetricBar
                    label="동접 지수(Top5 대비)"
                    value={((top1.playing ?? 0) / maxPlaying) * 100}
                    hint={`${top1.playing_compact ?? compact(top1.playing)}`}
                  />
                  <MetricBar
                    label="방문 지수(Top5 대비)"
                    value={((top1.visits ?? 0) / maxVisits) * 100}
                    hint={`${top1.visits_compact ?? compact(top1.visits)}`}
                  />
                  <MetricBar
                    label="즐겨찾기 지수(Top5 대비)"
                    value={((top1.favorites ?? 0) / maxFav) * 100}
                    hint={`${top1.favorites_compact ?? compact(top1.favorites)}`}
                  />
                </div>

                <button
                  onClick={() => setSelected(top1)}
                  className="mt-4 w-full rounded-2xl bg-white/10 hover:bg-white/15 ring-1 ring-white/10 px-4 py-2.5 text-sm font-semibold"
                >
                  Spotlight 자세히 보기
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Main grid */}
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Left column */}
          <div className="lg:col-span-1 space-y-5">
            <div className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-5">
              <SectionTitle title="AI 요약 원문" hint="헤드라인/요약은 스냅샷 생성 시 함께 저장됨" />
              <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/75">
                {SNAP.ai.summary || "요약이 없습니다."}
              </pre>
            </div>

            <div className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-5">
              <SectionTitle title="데이터 소스" hint="Roblox Explore + Games + Votes + Favorites" />
              <div className="mt-3 space-y-2 text-xs text-white/65">
                <div className="rounded-2xl bg-black/20 ring-1 ring-white/10 p-3">
                  <div className="font-semibold text-white/80">Explore</div>
                  <div className="mt-1">Discover/Charts의 TOP 목록(정렬 기반)</div>
                </div>
                <div className="rounded-2xl bg-black/20 ring-1 ring-white/10 p-3">
                  <div className="font-semibold text-white/80">Games</div>
                  <div className="mt-1">설명/방문/제작자/업데이트일 등 상세</div>
                </div>
                <div className="rounded-2xl bg-black/20 ring-1 ring-white/10 p-3">
                  <div className="font-semibold text-white/80">Votes/Favorites</div>
                  <div className="mt-1">호감도(좋아요 비율), 즐겨찾기 카운트</div>
                </div>
              </div>

              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-white/60 hover:text-white/80">
                  원본 스냅샷 JSON 보기
                </summary>
                <pre className="mt-3 overflow-auto rounded-2xl bg-black/30 p-3 text-[11px] leading-5 text-white/70 ring-1 ring-white/10 max-h-[360px]">
                  {JSON.stringify(SNAP, null, 2)}
                </pre>
              </details>
            </div>
          </div>

          {/* Right column: Cards */}
          <div className="lg:col-span-2 space-y-4">
            <SectionTitle title="TOP 5 랭킹" hint="카드를 클릭하면 상세 정보를 확인할 수 있어요" />

            {SNAP.top5.map((g, i) => {
              const tone = toneFromRatio(g.likeRatio);
              const dp = deltaBadge(g.delta?.playing ?? null);
              const dpp = deltaPctBadge(g.delta?.playingPct ?? null);

              return (
                <button
                  key={g.universeId}
                  onClick={() => setSelected(g)}
                  className="group w-full text-left rounded-3xl bg-white/5 ring-1 ring-white/10 p-5 transition hover:bg-white/7 hover:ring-white/20"
                >
                  <div className="flex items-start justify-between gap-5">
                    {/* Left: thumbnail + text */}
                    <div className="flex min-w-0 gap-4">
                        {/* Thumbnail */}
                        <div className="relative h-[92px] w-[164px] shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10 bg-black/30">
                        {thumbs.get(g.universeId) ? (
                            <img
                            src={thumbs.get(g.universeId) ?? ""}
                            alt={g.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            />
                        ) : (
                            <div className="h-full w-full animate-pulse bg-white/5" />
                        )}

                        {/* Rank overlay */}
                        <div className="absolute left-2 top-2">
                            <RankBadge rank={i + 1} />
                        </div>
                        </div>

                        {/* Text */}
                        <div className="min-w-0">
                        <div className="min-w-0">
                            <h3 className="truncate text-lg font-semibold text-white">{g.name}</h3>
                            <div className="mt-1 text-xs text-white/50">
                            {g.creator?.name ? `by ${g.creator.name}` : "creator unknown"}
                            <span className="mx-2 text-white/20">•</span>
                            updated {safeDate(g.updated)}
                            </div>
                        </div>

                        <div className="mt-3 text-sm text-white/70">{clampText(g.description, 220)}</div>

                        <div className="mt-4 flex flex-wrap gap-2">
                            <StatPill label="동접" value={g.playing_compact ?? compact(g.playing)} tone="info" />
                            <StatPill label="동접Δ" value={`${dp.text} ${dpp.text}`} tone={dp.tone} />
                            <StatPill label="방문" value={g.visits_compact ?? compact(g.visits)} />
                            <StatPill label="즐겨찾기" value={g.favorites_compact ?? compact(g.favorites)} />
                            <StatPill label="호감도" value={pct(g.likeRatio)} tone={toneFromRatio(g.likeRatio)} />
                        </div>

                        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                            <MetricBar
                            label="동접 지수"
                            value={((g.playing ?? 0) / maxPlaying) * 100}
                            hint={g.playing_compact ?? compact(g.playing)}
                            />
                            <MetricBar
                            label="방문 지수"
                            value={((g.visits ?? 0) / maxVisits) * 100}
                            hint={g.visits_compact ?? compact(g.visits)}
                            />
                            <MetricBar
                            label="즐겨찾기 지수"
                            value={((g.favorites ?? 0) / maxFav) * 100}
                            hint={g.favorites_compact ?? compact(g.favorites)}
                            />
                        </div>
                        </div>
                    </div>
                    <div className="shrink-0">
                      <div className="rounded-2xl bg-black/20 ring-1 ring-white/10 px-3 py-2 text-xs text-white/50">
                        <div>universeId</div>
                        <div className="mt-1 font-mono text-white/85">{g.universeId}</div>
                      </div>

                      <div className="mt-3 rounded-2xl bg-gradient-to-b from-white/10 to-white/5 ring-1 ring-white/10 px-3 py-3">
                        <div className="text-xs text-white/60">Quick facts</div>
                        <div className="mt-2 space-y-1 text-xs text-white/75">
                          <div>👍 {compact(g.upVotes)}</div>
                          <div>👎 {compact(g.downVotes)}</div>
                          <div>Max {g.maxPlayers ?? "—"}p</div>
                        </div>
                      </div>

                      <div className="mt-3 text-xs text-white/40 group-hover:text-white/60 transition">
                        클릭해서 자세히
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.name} (universeId=${selected.universeId})` : ""}
      >
        {selected && (
          <div className="space-y-5">
            <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
              <div className="text-xs text-white/50">Description</div>
              <div className="mt-2 text-sm text-white/80 leading-6 whitespace-pre-wrap">
                {selected.description || "설명이 없습니다."}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <StatPill label="동접" value={selected.playing_compact ?? compact(selected.playing)} tone="info" />
              <StatPill label="방문" value={selected.visits_compact ?? compact(selected.visits)} />
              <StatPill label="즐겨찾기" value={selected.favorites_compact ?? compact(selected.favorites)} />
              <StatPill label="호감도" value={pct(selected.likeRatio)} tone={toneFromRatio(selected.likeRatio)} />
              <StatPill label="👍" value={compact(selected.upVotes)} />
              <StatPill label="👎" value={compact(selected.downVotes)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-white/70">
              <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                <div className="text-white/50">Creator</div>
                <div className="mt-1 text-white/85">
                  {selected.creator?.name ?? "—"}{" "}
                  {selected.creator?.type ? `(${selected.creator.type})` : ""}
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                <div className="text-white/50">Genre / MaxPlayers</div>
                <div className="mt-1 text-white/85">
                  {selected.genre ?? "—"} / {selected.maxPlayers ?? "—"}
                </div>
              </div>
              <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                <div className="text-white/50">Created</div>
                <div className="mt-1 text-white/85">{safeDate(selected.created)}</div>
              </div>
              <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
                <div className="text-white/50">Updated</div>
                <div className="mt-1 text-white/85">{safeDate(selected.updated)}</div>
              </div>
            </div>

            <div className="text-[11px] text-white/40">
              Tip: 다음 단계에서 “전주 대비 증감(Δ)”을 계산하면 카드에 🔺🔻 같은 트렌드 배지도 붙일 수 있어요.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
