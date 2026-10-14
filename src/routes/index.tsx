import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { analyzeWithGemini } from "@/lib/gemini.functions";
import { fetchIndodaxTicker, fetchIndodaxCandles } from "@/lib/indodax.functions";
import { LockScreen } from "@/components/LockScreen";
import { AUTH_TOKEN_KEY } from "@/lib/auth";
import { computeAnalysis, PARAMS, type Candle, type MarketAnalysis } from "@/lib/indicators";
import { checkSession } from "@/lib/lock.functions";
import { MarketSummary } from "@/components/MarketSummary";



export const Route = createFileRoute("/")({
  component: Gate,
  ssr: false,
});

function Gate() {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const verifySession = useServerFn(checkSession);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hasToken = false;
      try {
        hasToken = !!sessionStorage.getItem(AUTH_TOKEN_KEY);
      } catch {
        // ignore
      }
      if (hasToken) {
        try {
          // Server yang memutuskan: token harus valid dan belum kedaluwarsa.
          await verifySession();
          if (!cancelled) setUnlocked(true);
        } catch {
          try {
            sessionStorage.removeItem(AUTH_TOKEN_KEY);
          } catch {
            // ignore
          }
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [verifySession]);
  if (!ready) return null;
  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <Index />;
}

type PairKey = "bnbidr" | "btcidr" | "ethidr" | "solidr" | "xrpidr" | "hypeidr" | "dogeidr" | "beatidr" | "audioidr";

const PAIRS: { value: PairKey; label: string }[] = [
  { value: "bnbidr", label: "BNB / IDR" },
  { value: "btcidr", label: "BTC / IDR" },
  { value: "ethidr", label: "ETH / IDR" },
  { value: "solidr", label: "SOL / IDR" },
  { value: "xrpidr", label: "XRP / IDR" },
  { value: "hypeidr", label: "HYPE / IDR" },
  { value: "dogeidr", label: "DOGE / IDR" },
  { value: "beatidr", label: "BEAT / IDR" },
  { value: "audioidr", label: "AUDIO / IDR" },
];

type Ticker = {
  last: string;
  high: string;
  low: string;
  vol_idr?: string;
  buy?: string;
  sell?: string;
};

type GeminiAnalysis = {
  kesimpulan: string;
  rekomendasi: "BUY" | "HOLD" | "SELL" | string;
  alasan: string;
  support: string;
  resistance: string;
  confidence: "LOW" | "MEDIUM" | "HIGH" | string;
};

function formatIDR(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "-";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return String(n);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num);
}




function levelText(n: number | null): string {
  return n === null ? "Tidak terdeteksi" : formatIDR(n);
}

function recoStyle(reco: string): { bg: string; text: string; label: string } {

  const r = reco?.toUpperCase();
  if (r === "BUY") return { bg: "bg-emerald-500/20 border-emerald-400", text: "text-emerald-300", label: "BUY" };
  if (r === "SELL") return { bg: "bg-red-500/20 border-red-400", text: "text-red-300", label: "SELL" };
  return { bg: "bg-yellow-500/20 border-yellow-400", text: "text-yellow-200", label: "HOLD" };
}

function confidenceStyle(c: string): string {
  const v = c?.toUpperCase();
  if (v === "HIGH") return "bg-emerald-500/20 text-emerald-200 border-emerald-400/50";
  if (v === "LOW") return "bg-red-500/20 text-red-200 border-red-400/50";
  return "bg-yellow-500/20 text-yellow-200 border-yellow-400/50";
}

type StrategyKey = "trend" | "contrarian";

const STRATEGIES: { value: StrategyKey; label: string; desc: string }[] = [
  {
    value: "trend",
    label: "Trend Following",
    desc: "Ikuti arah tren — beli saat momentum naik, jual saat momentum melemah.",
  },
  {
    value: "contrarian",
    label: "Contrarian",
    desc: "Lawan arah tren — cari peluang beli saat harga jenuh turun, jual saat harga jenuh naik.",
  },
];

function Index() {
  const [tab, setTab] = useState<"analisis" | "pasar">("analisis");
  const [pair, setPair] = useState<PairKey>("bnbidr");
  const [strategy, setStrategy] = useState<StrategyKey>("trend");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [indicators, setIndicators] = useState<MarketAnalysis | null>(null);
  const [analysis, setAnalysis] = useState<GeminiAnalysis | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const analyze = useServerFn(analyzeWithGemini);
  const getTicker = useServerFn(fetchIndodaxTicker);
  const getCandles = useServerFn(fetchIndodaxCandles);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setTicker(null);
    setIndicators(null);
    try {
      setStage("Fetching ticker Indodax…");
      let t: Ticker;
      let candles: Candle[];
      try {
        const now = Math.floor(Date.now() / 1000);
        const from = now - 60 * 60 * 24 * 120;
        [t, candles] = await Promise.all([
          getTicker({ data: { pair } }) as Promise<Ticker>,
          getCandles({ data: { pair, from, to: now } }) as Promise<Candle[]>,
        ]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Gagal ambil data Indodax lewat proxy server. (${msg})`);
      }
      setTicker(t);
      const ind = computeAnalysis(candles, Number(t.last), Math.floor(Date.now() / 1000));
      setIndicators(ind);

      setStage("Meminta analisis Gemini…");
      const a = await analyze({
        data: {
          pair,
          strategy,
          ticker: { last: t.last, high: t.high, low: t.low, buy: t.buy, sell: t.sell },
          indicators: {
            rsi14: ind.rsi14,
            ma7: ind.ma7,
            ma25: ind.ma25,
            macd: ind.macd,
            atr14: ind.atr14,
            volumeRatio: ind.volumeRatio,
          },
          levels: {
            support: ind.levels.support,
            resistance: ind.levels.resistance,
            stopLoss: ind.plan?.stopLoss ?? null,
            target1: ind.plan?.target1 ?? null,
            target2: ind.plan?.target2 ?? null,
          },
        },
      });
      setAnalysis(a as GeminiAnalysis);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setStage("");
    }
  }, [pair, strategy, analyze, getTicker, getCandles]);


  const [hasRun, setHasRun] = useState(false);

  const handleRun = useCallback(() => {
    setHasRun(true);
    void run();
  }, [run]);

  const reco = analysis ? recoStyle(analysis.rekomendasi) : null;

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            <span className="text-neon-pink">Kripto</span>{" "}
            <span className="text-neon-orange">Analyzer</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Indodax ticker + RSI/MA hitung sendiri + rekomendasi Gemini. Read-only, no backend.
          </p>
        </div>

        <div className="mb-8 inline-flex w-full max-w-md rounded-lg border border-[color:var(--neon-violet)]/60 bg-black/30 p-1 sm:w-auto">
          {(
            [
              { value: "analisis", label: "Analisis Koin" },
              { value: "pasar", label: "Ringkasan Pasar" },
            ] as const
          ).map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-pressed={tab === t.value}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition ${
                tab === t.value
                  ? "bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] text-white"
                  : "text-white/70 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "pasar" ? (
          <MarketSummary />
        ) : (
        <>
        <header className="mb-8 flex flex-col gap-4 sm:mb-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="text-xs uppercase tracking-widest text-neon-orange">Pair</label>
            <select
              value={pair}
              onChange={(e) => setPair(e.target.value as PairKey)}
              disabled={loading}
              className="rounded-md border border-[color:var(--neon-magenta)] bg-[color:var(--neon-purple)]/60 px-4 py-2 text-sm font-medium text-white outline-none transition focus:border-[color:var(--neon-pink)] focus:ring-2 focus:ring-[color:var(--neon-pink)]/50 disabled:opacity-50"
            >
              {PAIRS.map((p) => (
                <option key={p.value} value={p.value} className="bg-[#1B1035]">
                  {p.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleRun}
              disabled={loading}
              className="neon-glow-pink rounded-md border border-[color:var(--neon-pink)] bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto"
            >
              {loading ? "Loading…" : "Refresh Analysis"}

            </button>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-widest text-neon-orange">
              Strategi Analisis
            </label>
            <div className="inline-flex w-full max-w-md rounded-lg border border-[color:var(--neon-violet)]/60 bg-black/30 p-1 sm:w-auto">
              {STRATEGIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStrategy(s.value)}
                  disabled={loading}
                  aria-pressed={strategy === s.value}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    strategy === s.value
                      ? "bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] text-white"
                      : "text-white/70 hover:text-white"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-white/60">
              {STRATEGIES.find((s) => s.value === strategy)?.desc}
            </p>
          </div>
        </header>

        {!hasRun && !loading && (
          <div className="neon-card-violet rounded-2xl p-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--neon-violet)]/60 bg-black/40 text-2xl">
              📊
            </div>
            <p className="text-sm font-medium text-white/80">
              Pilih pair dan strategi, lalu klik “Refresh Analysis” untuk memulai
            </p>
            <p className="mt-2 text-xs text-white/50">
              Tidak ada data yang diambil sebelum kamu klik tombolnya.
            </p>
          </div>
        )}

        {loading && (
          <div className="neon-card mb-6 rounded-xl p-6 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--neon-pink)] border-t-transparent" />
            <p className="text-sm text-white/80">{stage || "Loading…"}</p>
          </div>
        )}

        {error && !loading && (
          <div className="mb-6 rounded-xl border border-red-400/60 bg-red-500/15 p-5 text-sm text-red-100 shadow-[0_0_16px_rgba(239,68,68,0.35)]">
            <p className="mb-1 font-semibold uppercase tracking-wider text-red-300">Error</p>
            <p>{error}</p>
          </div>
        )}

        {ticker && !loading && (
          <section className="neon-card-violet mb-6 rounded-2xl p-5 sm:p-7">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-neon-orange">
              Market snapshot — {pair.toUpperCase()}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Harga sekarang" value={formatIDR(ticker.last)} accent />
              <Stat label="High 24h" value={formatIDR(ticker.high)} />
              <Stat label="Low 24h" value={formatIDR(ticker.low)} />
              <Stat label="RSI 14" value={indicators?.rsi14 != null ? indicators.rsi14.toFixed(2) : "-"} />
              <Stat label="MA 7" value={indicators?.ma7 != null ? formatIDR(indicators.ma7) : "-"} />
              <Stat label="MA 25" value={indicators?.ma25 != null ? formatIDR(indicators.ma25) : "-"} />
            </div>
          </section>
        )}



        {ticker && indicators && !loading && (
          <section className="neon-card-violet mb-6 rounded-2xl p-5 sm:p-7">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-neon-orange">
              Level &amp; rencana risiko — dihitung kode
            </h2>
            <p className="mb-4 text-xs text-white/60">
              Rencana HIPOTETIS jika membeli di harga sekarang (spot, tanpa short). Ini bukan rekomendasi: keputusan
              BUY/HOLD/SELL ada di analisis di bawah. R = jarak harga masuk ke stop-loss.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Support terdekat" value={levelText(indicators.levels.support)} />
              <Stat label="Resistance terdekat" value={levelText(indicators.levels.resistance)} />
              <Stat
                label="Risiko per transaksi"
                value={indicators.plan ? `${indicators.plan.riskPct.toFixed(2)}%` : "-"}
              />
              <Stat label="Stop-loss" value={indicators.plan ? formatIDR(indicators.plan.stopLoss) : "-"} />
              <Stat
                label={`Target 1 (${PARAMS.target1R}R)`}
                value={indicators.plan ? formatIDR(indicators.plan.target1) : "-"}
              />
              <Stat
                label={`Target 2 (${PARAMS.target2R}R)`}
                value={indicators.plan ? formatIDR(indicators.plan.target2) : "-"}
              />
              <Stat
                label="ATR 14 (gerak harian)"
                value={
                  indicators.atr14 != null
                    ? `${formatIDR(indicators.atr14)} (${indicators.atrPct?.toFixed(2)}%)`
                    : "-"
                }
              />
              <Stat
                label="MACD histogram"
                value={
                  indicators.macd
                    ? `${formatIDR(indicators.macd.hist)}${
                        indicators.macd.histPrev === null ? "" : indicators.macd.hist > indicators.macd.histPrev ? " ↑" : " ↓"
                      }`
                    : "-"
                }
              />
              <Stat
                label="Volume vs rata-rata"
                value={indicators.volumeRatio != null ? `${indicators.volumeRatio.toFixed(2)}x` : "-"}
              />
            </div>
            {indicators.warnings.length > 0 && (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-yellow-200">
                {indicators.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-white/45">
              Berdasarkan {indicators.closedCount} candle harian selesai (+ harga live). Candle hari ini yang belum
              selesai tidak dipakai untuk ATR, volume, dan level.
            </p>
          </section>
        )}

        {analysis && reco && !loading && (
          <section className="neon-card rounded-2xl p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div
                className={`rounded-lg border-2 px-5 py-2 text-2xl font-extrabold tracking-widest ${reco.bg} ${reco.text}`}
              >
                {reco.label}
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest ${confidenceStyle(analysis.confidence)}`}
              >
                Confidence: {analysis.confidence}
              </span>
              {updatedAt && (
                <span className="ml-auto text-xs text-white/60">
                  Updated {updatedAt.toLocaleString("id-ID")}
                </span>
              )}
            </div>

            <div className="mb-5 rounded-lg border border-[color:var(--neon-violet)]/50 bg-[color:var(--neon-violet)]/10 p-4">
              <p className="mb-1 text-xs uppercase tracking-widest text-neon-orange">Kesimpulan</p>
              <p className="text-base font-medium text-white">{analysis.kesimpulan}</p>
            </div>

            <div className="mb-5">
              <p className="mb-1 text-xs uppercase tracking-widest text-neon-orange">Alasan</p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-white/85">
                {analysis.alasan}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-widest text-emerald-300">Support</p>
                <p className="mt-1 text-lg font-bold text-emerald-100">{analysis.support}</p>
              </div>
              <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4">
                <p className="text-xs uppercase tracking-widest text-red-300">Resistance</p>
                <p className="mt-1 text-lg font-bold text-red-100">{analysis.resistance}</p>
              </div>
            </div>
          </section>
        )}
        </>
        )}

        <footer className="mt-10 text-center text-xs text-white/50">
          Personal tools · Data: Indodax public API · AI: Gemini 2.5 Flash · Bukan saran finansial.
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[color:var(--neon-magenta)]/30 bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/60">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent ? "text-neon-pink" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
