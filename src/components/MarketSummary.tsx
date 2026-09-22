import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import {
  fetchFearGreed,
  fetchUsdIdr,
  fetchNewsSummary,
  type FearGreed,
  type UsdIdr,
  type NewsSummary,
} from "@/lib/market.functions";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fngStyle(value: number): string {
  if (value <= 24) return "bg-red-500/20 text-red-200 border-red-400/60";
  if (value <= 44) return "bg-orange-500/20 text-orange-200 border-orange-400/60";
  if (value <= 55) return "bg-yellow-500/20 text-yellow-100 border-yellow-400/60";
  if (value <= 74) return "bg-emerald-500/20 text-emerald-200 border-emerald-400/60";
  return "bg-emerald-400/25 text-emerald-100 border-emerald-300/70";
}

function SubError({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-red-400/50 bg-red-500/10 p-3 text-xs text-red-100">
      {message}
    </p>
  );
}

export function MarketSummary() {
  const getFng = useServerFn(fetchFearGreed);
  const getFx = useServerFn(fetchUsdIdr);
  const getNews = useServerFn(fetchNewsSummary);

  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [fng, setFng] = useState<FearGreed | null>(null);
  const [fngErr, setFngErr] = useState<string | null>(null);
  const [fx, setFx] = useState<UsdIdr | null>(null);
  const [fxErr, setFxErr] = useState<string | null>(null);
  const [news, setNews] = useState<NewsSummary | null>(null);
  const [newsErr, setNewsErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setHasRun(true);
    setLoading(true);
    setFng(null);
    setFx(null);
    setNews(null);
    setFngErr(null);
    setFxErr(null);
    setNewsErr(null);

    const [r1, r2, r3] = await Promise.allSettled([
      getFng() as Promise<FearGreed>,
      getFx() as Promise<UsdIdr>,
      getNews() as Promise<NewsSummary>,
    ]);

    if (r1.status === "fulfilled") setFng(r1.value);
    else setFngErr(`Gagal ambil Fear & Greed Index. (${errMsg(r1.reason)})`);

    if (r2.status === "fulfilled") setFx(r2.value);
    else setFxErr(`Gagal ambil kurs USD/IDR. (${errMsg(r2.reason)})`);

    if (r3.status === "fulfilled") setNews(r3.value);
    else setNewsErr(`Gagal ambil / merangkum berita. (${errMsg(r3.reason)})`);

    setUpdatedAt(new Date());
    setLoading(false);
  }, [getFng, getFx, getNews]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void run()}
          disabled={loading}
          className="neon-glow-pink rounded-md border border-[color:var(--neon-pink)] bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Loading…" : "Refresh Ringkasan Pasar"}
        </button>
        {updatedAt && !loading && (
          <span className="text-xs text-white/60">
            Updated {updatedAt.toLocaleString("id-ID")}
          </span>
        )}
      </div>

      {!hasRun && !loading && (
        <div className="neon-card-violet rounded-2xl p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--neon-violet)]/60 bg-black/40 text-2xl">
            🌎
          </div>
          <p className="text-sm font-medium text-white/80">
            Klik “Refresh Ringkasan Pasar” untuk melihat sentimen pasar, kurs USD/IDR, dan
            rangkuman berita terbaru.
          </p>
          <p className="mt-2 text-xs text-white/50">
            Tidak ada data yang diambil sebelum kamu klik tombolnya.
          </p>
        </div>
      )}

      {loading && (
        <div className="neon-card rounded-xl p-6 text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--neon-pink)] border-t-transparent" />
          <p className="text-sm text-white/80">Mengambil sentimen, kurs, dan berita…</p>
        </div>
      )}

      {hasRun && !loading && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="neon-card-violet rounded-2xl p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-neon-orange">
                Sentimen Pasar
              </p>
              {fngErr ? (
                <SubError message={fngErr} />
              ) : fng ? (
                <div className="flex items-center gap-4">
                  <div
                    className={`rounded-lg border-2 px-5 py-2 text-3xl font-extrabold ${fngStyle(fng.value)}`}
                  >
                    {fng.value}
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white">{fng.classification}</p>
                    <p className="text-xs text-white/60">
                      Skala 0–100: makin kecil artinya pasar makin takut, makin besar artinya
                      makin serakah.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="neon-card rounded-2xl p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-neon-orange">
                Kurs USD / IDR
              </p>
              {fxErr ? (
                <SubError message={fxErr} />
              ) : fx ? (
                <div>
                  <p className="text-2xl font-bold text-neon-pink">
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      maximumFractionDigits: 0,
                    }).format(fx.rate)}
                  </p>
                  <p className="mt-1 text-xs text-white/60">
                    Nilai 1 Dolar AS dalam Rupiah{fx.date ? ` · data ${fx.date}` : ""}.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="neon-card rounded-2xl p-5 sm:p-7">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-neon-orange">
              Ringkasan Berita
            </p>
            {newsErr ? (
              <SubError message={newsErr} />
            ) : news ? (
              <>
                <p className="whitespace-pre-line text-sm leading-relaxed text-white/85">
                  {news.summary}
                </p>
                <p className="mt-4 text-xs text-white/50">
                  Dari {news.count} berita terbaru
                  {news.sources.length ? ` · sumber: ${news.sources.join(", ")}` : ""}
                </p>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
