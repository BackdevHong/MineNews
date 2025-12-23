import { useEffect, useMemo, useState } from "react";
import type { Article } from "../type/Snapshot";
import { useSnapshot } from "../hooks/useSnapshot";
import { useThumbnails } from "../hooks/useThumbnails";

/* ---------- utils ---------- */
function compact(n: number | null) {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1e3).toFixed(2)}K`;
  return String(n);
}

function pct(x: number | null) {
  if (x == null) return "—";
  return `${Math.round(x * 100)}%`;
}

function safeDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("ko-KR", { dateStyle: "medium" });
}

/* ---------- UI ---------- */
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
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 160);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={[
          "absolute inset-0 transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0",
          "bg-black/55",
        ].join(" ")}
      />

      {/* Panel */}
      <div
        className={[
          "absolute left-1/2 top-1/2 w-[min(980px,94vw)] -translate-x-1/2 -translate-y-1/2",
          "rounded-2xl modal-paper shadow-2xl",
          "transition-all duration-150 transform-gpu",
          open ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]",
        ].join(" ")}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10">
          <div className="text-sm font-extrabold tracking-tight ink">
            {title}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs ink-sub hover:bg-black/5"
          >
            닫기
          </button>
        </div>

        <div className="p-6 max-h-[78vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Small UI bits ---------- */
function Divider() {
  return <div className="h-px bg-black/10" />;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.035] ring-1 ring-black/10 px-2.5 py-1 text-[11px] ink-sub">
      {children}
    </span>
  );
}

function MetaLine({
  items,
}: {
  items: Array<{ k: string; v: React.ReactNode }>;
}) {
  return (
    <div className="meta-line mt-3">
      {items.map((x, i) => (
        <span key={i}>
          <b>{x.k}</b> {x.v}
        </span>
      ))}
    </div>
  );
}

function Thumb16x9({ url, alt }: { url: string | null; alt: string }) {
  return (
    <div className="relative aspect-[16/9] overflow-hidden rounded-2xl ring-1 ring-black/10 bg-black/[0.03]">
      {url ? (
        <>
          <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-transparent" />
        </>
      ) : (
        <div className="h-full w-full grid place-items-center text-xs ink-sub">
          썸네일 없음
        </div>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const label =
    rank === 1 ? "No.1" : rank === 2 ? "No.2" : rank === 3 ? "No.3" : `No.${rank}`;
  return (
    <div className="rank-badge" title={`Rank ${rank}`}>
      {label}
    </div>
  );
}

function paperFrameClass(rank: number) {
  if (rank === 1) return "paper gold";
  if (rank === 2) return "paper silver";
  if (rank === 3) return "paper bronze";
  return "paper";
}

/* ---------- Page ---------- */
export default function WeeklyRobloxNewspaperPage() {
  const { data: SNAP, loading, error } = useSnapshot();
  const [selected, setSelected] = useState<Article | null>(null);

  const headerDate = useMemo(() => {
    if (!SNAP) return "";
    return new Date(SNAP.generatedAt).toLocaleString("ko-KR", {
      dateStyle: "full",
      timeStyle: "short",
    });
  }, [SNAP]);

  const selectedRank = useMemo(() => {
    if (!SNAP || !selected) return null;
    const idx = SNAP.articles.findIndex((x) => x.universeId === selected.universeId);
    return idx >= 0 ? idx + 1 : null;
  }, [SNAP, selected]);

  // universeIds
  const universeIds = useMemo(() => {
    return (SNAP?.articles ?? []).map((a) => a.universeId).filter(Boolean);
  }, [SNAP]);

  const { thumbs } = useThumbnails(universeIds);

  /* ---------- states ---------- */
  if (loading) {
    return (
      <div className="min-h-screen px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="paper p-6">
            <div className="animate-pulse ink-sub">신문을 인쇄 중입니다…</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !SNAP) {
    return (
      <div className="min-h-screen px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="paper p-6">
            <div className="ink">데이터를 불러오지 못했습니다.</div>
          </div>
        </div>
      </div>
    );
  }

  const lead = SNAP.articles[0] ?? null;
  const rest = SNAP.articles.slice(1);

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Masthead */}
        <header className="masthead">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="kicker">MineInsight · Weekly Roblox Newspaper</div>
              <h1 className="news-h1 masthead-title">이번 주 Roblox TOP 5</h1>
              <div className="kicker">
                기준: <b className="ink">{SNAP.meta.sortName}</b>{" "}
                <span className="ink-sub">({SNAP.meta.sortId})</span> · {headerDate}
              </div>
            </div>

            <div className="flex items-center gap-3 md:justify-end">
              <div className="stamp">
                WEEKLY
              </div>
              <div className="kicker text-right">
                발행 · <b className="ink">{safeDate(SNAP.generatedAt)}</b>
                <div className="ink-sub text-[11px]">Roblox Explore Snapshot</div>
              </div>
            </div>
          </div>
        </header>

        {/* Headlines (신문식: 박스 대신 불릿/줄) */}
        <section className="paper p-5">
          <div className="section-title">HEADLINES</div>
          <Divider />
          <ul className="mt-4 space-y-2">
            {SNAP.headlines.map((h, i) => (
              <li key={i} className="headline-row anim-rise-in" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="headline-bullet">•</span>
                <span className="ink">{h}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Articles layout: Lead + Column list */}
        <section className="grid gap-4 md:grid-cols-3">
          {SNAP.articles.map((a, i) => {
            const rank = i + 1;
            const thumb = thumbs[a.universeId] ?? null;

            const isLead = rank === 1;

            return (
              <article
                key={a.universeId}
                className={[
                  paperFrameClass(rank),
                  "relative cursor-pointer anim-rise-in",
                  isLead ? "md:col-span-2 p-6 md:p-7" : "p-5",
                ].join(" ")}
                style={{ animationDelay: `${Math.min(i * 70, 280)}ms` }}
                onClick={() => setSelected(a)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="kicker">
                      TOP <b className="ink">{rank}</b> · 동접 {compact(a.metrics.playing)}
                    </div>

                    <div
                      className={[
                        "mt-1 font-black tracking-tight ink title-serif",
                        isLead ? "text-2xl md:text-3xl leading-tight" : "text-[18px] leading-snug",
                        "line-clamp-2",
                      ].join(" ")}
                    >
                      {a.gameName}
                    </div>

                    <div
                      className={[
                        "mt-2 body-text",
                        isLead ? "text-[14px] leading-8 line-clamp-3" : "text-[13px] leading-7 line-clamp-2",
                      ].join(" ")}
                    >
                      {a.oneLiner}
                    </div>
                  </div>

                  <RankBadge rank={rank} />
                </div>

                <div className={["mt-4 grid gap-3", isLead ? "md:grid-cols-[1fr,240px]" : "md:grid-cols-[1fr,160px]"].join(" ")}>
                  <div>
                    <MetaLine
                      items={[
                        { k: "호감도", v: pct(a.metrics.likeRatio) },
                        { k: "즐겨찾기", v: compact(a.metrics.favorites) },
                        { k: "장르", v: a.metrics.genre ?? "—" },
                        { k: "업데이트", v: safeDate(a.metrics.updated) },
                      ]}
                    />
                  </div>

                  <div className="md:justify-self-end">
                    <div className={["relative aspect-[16/9] overflow-hidden ring-1 ring-black/10 bg-black/[0.03]", isLead ? "rounded-2xl" : "rounded-xl"].join(" ")}>
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={`${a.gameName} thumbnail`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-[11px] ink-sub">
                          썸네일 없음
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    type="button"
                    className={isLead ? "paper-btn" : "paper-link"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(a);
                    }}
                  >
                    {isLead ? "기사 열람" : "자세히 →"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

      </div>

      {/* Modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.gameName ?? ""}>
        {selected && (
          <div className="space-y-6">
            {/* Header */}
            <div className="grid gap-4 md:grid-cols-[1.2fr,1fr]">
              <div className="relative">
                <div className="absolute left-2 top-2 z-10">
                  <div className="rank-chip">
                    No.{SNAP.articles.findIndex((x) => x.universeId === selected.universeId) + 1}
                  </div>
                </div>
                <Thumb16x9
                  url={thumbs[selected.universeId] ?? null}
                  alt={`${selected.gameName} thumbnail`}
                />
              </div>

              <div className="min-w-0">
                <div className="section-title">ARTICLE</div>
                <div className="mt-1 text-2xl font-black tracking-tight ink">
                  {selected.gameName}
                </div>
                <div className="mt-2 text-sm ink-sub">
                  {selected.oneLiner}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Pill>동접 {compact(selected.metrics.playing)}</Pill>
                  <Pill>방문 {compact(selected.metrics.visits)}</Pill>
                  <Pill>즐겨찾기 {compact(selected.metrics.favorites)}</Pill>
                  <Pill>호감도 {pct(selected.metrics.likeRatio)}</Pill>
                  <Pill>장르 {selected.metrics.genre ?? "—"}</Pill>
                  <Pill>최대 {selected.metrics.maxPlayers ?? "—"}p</Pill>
                  <Pill>업데이트 {safeDate(selected.metrics.updated)}</Pill>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="paper p-5">
              <div className="section-title">STORY</div>
              <Divider />
              {(() => {
                const parts = String(selected.body ?? "")
                  .split(/\n\s*\n/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                const lead = parts[0] ?? "";
                const rest = parts.slice(1);

                return (
                  <div className="mt-4 story-columns">
                    {lead && (
                      <p className="text-[15px] leading-8 ink">
                        {lead}
                      </p>
                    )}
                    {rest.map((p, idx) => (
                      <p key={idx} className="text-[13px] leading-7 body-text">
                        {p}
                      </p>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Source */}
            {selected.descriptionSource && (
              <div className="paper p-5">
                <div className="section-title">SOURCE (description)</div>
                <Divider />
                <div className="mt-3 whitespace-pre-wrap text-[12px] leading-6 ink-sub">
                  {selected.descriptionSource}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
