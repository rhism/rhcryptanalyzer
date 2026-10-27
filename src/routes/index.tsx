import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { analyzeWithGemini } from "@/lib/gemini.functions";
import { fetchIndodaxTicker, fetchIndodaxCandles, fetchIndodaxPairs } from "@/lib/indodax.functions";
import { LockScreen } from "@/components/LockScreen";
import { AUTH_TOKEN_KEY } from "@/lib/auth";
import { computeAnalysis, PARAMS, type Candle, type MarketAnalysis } from "@/lib/indicators";
import { compactIdr, formatIdr } from "@/lib/format";
import { FALLBACK_PAIRS, liquidityWarning, type PairInfo } from "@/lib/pairs";
import { computeSignal, isStablecoin, type Signal } from "@/lib/signals";
import { computeSizing, SIZING_PARAMS, type Sizing } from "@/lib/sizing";
import { explainAiError, type AiErrorInfo } from "@/lib/ai-errors";
import { exitNote } from "@/lib/evidence";
import { SignalCard } from "@/components/SignalCard";
import { checkSession } from "@/lib/lock.functions";
import { MarketSummary } from "@/components/MarketSummary";
import { BacktestPanel } from "@/components/BacktestPanel";
import { JournalPanel } from "@/components/JournalPanel";
import { parseJournal, exportJournal, JOURNAL_MAX_ENTRIES, type JournalEntry } from "@/lib/journal";



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
  provider?: string;
};

function formatIDR(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "-";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return String(n);
  return formatIdr(num);
}




function levelText(n: number | null): string {
  return n === null ? "Tidak terdeteksi" : formatIDR(n);
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
  const [tab, setTab] = useState<"analisis" | "pasar" | "backtest" | "jurnal">("analisis");
  const [pair, setPair] = useState<string>("bnbidr");
  const [pairs, setPairs] = useState<PairInfo[]>(FALLBACK_PAIRS);
  const [pairsSource, setPairsSource] = useState<"loading" | "live" | "fallback">("loading");
  const [pairSearch, setPairSearch] = useState("");
  const getPairs = useServerFn(fetchIndodaxPairs);
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
    setSignal(null);
    setRunInfo(null);
    setAiError(null);
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
      const computed = computeAnalysis(candles, Number(t.last), Math.floor(Date.now() / 1000));
      const volIdr = Number.isFinite(Number(t.vol_idr)) && t.vol_idr !== undefined && t.vol_idr !== ""
        ? Number(t.vol_idr)
        : (pairs.find((p) => p.id === pair)?.volIdr ?? null);
      const liqWarn = liquidityWarning(volIdr);
      const ind: MarketAnalysis = liqWarn
        ? { ...computed, warnings: [liqWarn, ...computed.warnings] }
        : computed;
      setIndicators(ind);

      // Keputusan BUY/HOLD/SELL dihitung kode; AI hanya menjelaskan.
      const pairInfo = pairs.find((p) => p.id === pair);
      const sig = computeSignal(ind, strategy, pair);
      setSignal(sig);
      setRunInfo({
        volIdr,
        takerFeePct: pairInfo?.takerFeePct ?? null,
        minOrderIdr: pairInfo?.minOrderIdr ?? null,
        strategy,
        pairId: pair,
      });
      setLoggedSignal(false);
      if (sig.action === "NA") {
        setUpdatedAt(new Date());
        return;
      }

      setStage("Meminta penjelasan AI…");
      try {
      const a = await analyze({
        data: {
          pair,
          strategy,
          signal: { action: sig.action, reasons: sig.reasons, blockedBy: sig.blockedBy },
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
      } catch (e) {
        // Gangguan AI tidak boleh menyembunyikan sinyal kode.
        setAiError(explainAiError(e instanceof Error ? e.message : String(e)));
      }
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setStage("");
    }
  }, [pair, pairs, strategy, analyze, getTicker, getCandles]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await getPairs()) as PairInfo[];
        if (!cancelled && list.length > 0) {
          setPairs(list);
          setPairsSource("live");
          // Kalau pair yang sedang dipilih tidak ada di daftar langsung (mis. sedang maintenance),
          // pindah ke koin biasa dengan volume terbesar (bukan stablecoin, yang tidak bisa dianalisis)
          // supaya tampilan dan yang dianalisis selalu sama.
          setPair((cur) =>
            list.some((p) => p.id === cur) ? cur : (list.find((p) => !isStablecoin(p.id)) ?? list[0]).id,
          );
        }
      } catch {
        if (!cancelled) setPairsSource("fallback");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getPairs]);

  const visiblePairs = useMemo(() => {
    const q = pairSearch.trim().toLowerCase();
    const base = q
      ? pairs.filter((p) => p.id.includes(q) || p.label.toLowerCase().includes(q))
      : pairs;
    // pair yang sedang dipilih selalu tetap ada di daftar
    return base.some((p) => p.id === pair) ? base : [...(pairs.filter((p) => p.id === pair)), ...base];
  }, [pairs, pairSearch, pair]);

  const [hasRun, setHasRun] = useState(false);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [runInfo, setRunInfo] = useState<{
    volIdr: number | null;
    takerFeePct: number | null;
    minOrderIdr: number | null;
    strategy: StrategyKey;
    pairId: string;
  } | null>(null);
  const [aiError, setAiError] = useState<AiErrorInfo | null>(null);
  const [capitalText, setCapitalText] = useState("");
  const [riskText, setRiskText] = useState(String(SIZING_PARAMS.defaultRiskPct));
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [storageOk, setStorageOk] = useState(true);
  const [loggedSignal, setLoggedSignal] = useState(false);

  // Modal & persen risiko disimpan di browser ini saja (tidak dikirim ke server).
  useEffect(() => {
    try {
      const c = localStorage.getItem("rhc_capital_v1");
      if (c && /^\d+$/.test(c)) setCapitalText(c);
      const r = localStorage.getItem("rhc_riskpct_v1");
      if (r && Number.isFinite(Number(r.replace(",", ".")))) setRiskText(r);
      const j = localStorage.getItem("rhc_journal_v1");
      if (j) {
        const parsed = parseJournal(j);
        if (!parsed.error) setJournal(parsed.entries);
      }
    } catch {
      setStorageOk(false);
    }
    setPrefsLoaded(true);
  }, []);
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem("rhc_capital_v1", capitalText);
      localStorage.setItem("rhc_riskpct_v1", riskText);
    } catch {
      // ignore
    }
  }, [prefsLoaded, capitalText, riskText]);
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem("rhc_journal_v1", exportJournal(journal));
    } catch {
      setStorageOk(false);
    }
  }, [prefsLoaded, journal]);

  // Hasil di layar milik analisis TERAKHIR. Kalau pilihan koin atau strategi berubah, hasilnya usang sampai Refresh ditekan.
  const stale = runInfo !== null && (runInfo.pairId !== pair || runInfo.strategy !== strategy);

  const logSignal = (opts: { hype: boolean; note: string }) => {
    if (!signal || !runInfo || !ticker || signal.action === "NA") return;
    if (journal.length >= JOURNAL_MAX_ENTRIES) return;
    const price0 = Number(ticker.last);
    if (!Number.isFinite(price0) || price0 <= 0) return;
    const createdAt = Math.floor(Date.now() / 1000);
    const entry: JournalEntry = {
      id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      kind: "signal",
      pairId: runInfo.pairId,
      price0,
      strategy: signal.strategy,
      action: signal.action,
      stop: indicators?.plan?.stopLoss ?? null,
      target1: indicators?.plan?.target1 ?? null,
      target2: indicators?.plan?.target2 ?? null,
      hype: opts.hype,
      source: "Sistem",
      note: opts.note.trim() || undefined,
    };
    setJournal([entry, ...journal]);
    setLoggedSignal(true);
  };

  const sizing = useMemo<Sizing>(
    () =>
      computeSizing({
        capital: Number(capitalText),
        riskPct: Number(riskText.replace(",", ".")),
        plan: indicators?.plan ?? null,
        volIdr: runInfo?.volIdr ?? null,
        takerFeePct: runInfo?.takerFeePct ?? null,
        minOrderIdr: runInfo?.minOrderIdr ?? null,
      }),
    [capitalText, riskText, indicators, runInfo],
  );

  const handleRun = useCallback(() => {
    setHasRun(true);
    void run();
  }, [run]);


  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            <span className="text-neon-pink">Kripto</span>{" "}
            <span className="text-neon-orange">Analyzer</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Data Indodax + indikator & sinyal dihitung kode + penjelasan AI. Tidak ada transaksi otomatis.
          </p>
        </div>

        <div className="mb-8 inline-flex w-full max-w-xl rounded-lg border border-[color:var(--neon-violet)]/60 bg-black/30 p-1 sm:w-auto">
          {(
            [
              { value: "analisis", label: "Analisis Koin" },
              { value: "pasar", label: "Ringkasan Pasar" },
              { value: "backtest", label: "Backtest" },
              { value: "jurnal", label: "Jurnal" },
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
        ) : tab === "backtest" ? (
          <BacktestPanel pairs={pairs} defaultPair={pair} />
        ) : tab === "jurnal" ? (
          <JournalPanel
            entries={journal}
            onChange={setJournal}
            pairs={pairs}
            defaultPair={pair}
            storageOk={storageOk}
          />
        ) : (
        <>
        <header className="mb-8 flex flex-col gap-4 sm:mb-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="text-xs uppercase tracking-widest text-neon-orange">Pair</label>
            <input
              type="search"
              value={pairSearch}
              onChange={(e) => setPairSearch(e.target.value)}
              placeholder="Cari koin (mis. sol, doge)"
              aria-label="Cari koin"
              disabled={loading}
              className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-[color:var(--neon-pink)] disabled:opacity-50 sm:w-52"
            />
            <select
              value={pair}
              onChange={(e) => setPair(e.target.value)}
              disabled={loading}
              className="rounded-md border border-[color:var(--neon-magenta)] bg-[color:var(--neon-purple)]/60 px-4 py-2 text-sm font-medium text-white outline-none transition focus:border-[color:var(--neon-pink)] focus:ring-2 focus:ring-[color:var(--neon-pink)]/50 disabled:opacity-50"
            >
              {visiblePairs.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#1B1035]">
                  {p.volIdr !== null ? `${p.label} · ${compactIdr(p.volIdr)}/24j` : p.label}
                  {isStablecoin(p.id) ? " · stablecoin" : ""}
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

          <p className="-mt-2 text-[11px] text-white/50">
            {pairsSource === "loading" && "Memuat daftar pair dari Indodax…"}
            {pairsSource === "live" &&
              `${pairs.length} pair IDR aktif dari Indodax, diurutkan dari volume 24 jam terbesar.`}
            {pairsSource === "fallback" &&
              "Daftar pair Indodax gagal dimuat, memakai daftar cadangan (9 koin). Coba muat ulang halaman."}
          </p>

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

        {stale && runInfo && !loading && (
          <div
            data-testid="stale-banner"
            className="mb-6 rounded-xl border-2 border-yellow-400/70 bg-yellow-500/15 p-4 text-sm text-yellow-50"
          >
            <p className="font-semibold">Hasil di bawah sudah usang</p>
            <p className="mt-1">
              Hasil ini untuk <strong>{runInfo.pairId.toUpperCase()}</strong> dengan strategi{" "}
              <strong>{STRATEGIES.find((x) => x.value === runInfo.strategy)?.label}</strong>, sedangkan pilihanmu sekarang{" "}
              <strong>{pair.toUpperCase()}</strong> dengan strategi{" "}
              <strong>{STRATEGIES.find((x) => x.value === strategy)?.label}</strong>. Tekan Refresh Analysis supaya hasilnya sesuai, dan
              jangan bertindak berdasarkan hasil lama ini.
            </p>
          </div>
        )}

        {ticker && !loading && (
          <section className="neon-card-violet mb-6 rounded-2xl p-5 sm:p-7">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-neon-orange">
              Market snapshot — {(runInfo?.pairId ?? pair).toUpperCase()}
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



        {signal && runInfo && !loading && (
          <SignalCard
            signal={signal}
            strategyLabel={STRATEGIES.find((x) => x.value === runInfo.strategy)?.label ?? ""}
            sizing={sizing}
            capitalText={capitalText}
            onCapitalChange={setCapitalText}
            riskText={riskText}
            onRiskChange={setRiskText}
            onLog={logSignal}
            logged={loggedSignal}
          />
        )}

        {aiError && !loading && (
          <div className="mb-6 rounded-xl border border-yellow-400/50 bg-yellow-500/10 p-4 text-sm text-yellow-100">
            <p className="font-semibold">Penjelasan AI belum tersedia</p>
            <p className="mt-1" data-testid="ai-error-summary">
              {aiError.summary}
            </p>
            <p className="mt-1 text-xs text-yellow-100/70">
              Sinyal dan angka di atas dihitung kode dan tidak terpengaruh. Tekan Refresh Analysis untuk mencoba lagi.
            </p>
            {aiError.detail && (
              <details className="mt-2 text-xs text-yellow-100/70">
                <summary className="cursor-pointer">Detail teknis (untuk dikirim ke pembuat aplikasi)</summary>
                <pre data-testid="ai-error-detail" className="mt-1 whitespace-pre-wrap break-words">
                  {aiError.detail}
                </pre>
              </details>
            )}
          </div>
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
            <p data-testid="stop-explain" className="mb-4 text-xs text-white/60">
              &quot;Jarak ke stop-loss&quot; adalah berapa persen harga koin boleh turun sebelum stop-loss kena. Ini
              BUKAN persen risiko dari modalmu (yang itu kamu atur di bagian Ukuran posisi, mis. 1%). Makin jauh
              stop-loss-nya, makin kecil posisi yang dibeli.
            </p>
            {runInfo && (
              <p data-testid="exit-note" className="mb-4 text-xs text-yellow-100/80">
                {exitNote(runInfo.strategy)}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Support terdekat" value={levelText(indicators.levels.support)} />
              <Stat label="Resistance terdekat" value={levelText(indicators.levels.resistance)} />
              <Stat
                label="Jarak ke stop-loss (% harga)"
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

        {analysis && !loading && (
          <section className="neon-card rounded-2xl p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-neon-orange">
                Penjelasan AI — keputusan tetap dari aturan kode di atas
              </h2>
              {analysis.provider && (
                <span className="rounded-full border border-white/25 px-3 py-1 text-[10px] uppercase tracking-widest text-white/70">
                  {analysis.provider}
                </span>
              )}
              {updatedAt && (
                <span className="ml-auto text-xs text-white/60">Updated {updatedAt.toLocaleString("id-ID")}</span>
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
