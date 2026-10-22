import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { fetchIndodaxCandles } from "@/lib/indodax.functions";
import {
  buyHoldCurve,
  DEFAULT_BACKTEST,
  dropPartialCandle,
  runBacktest,
  type BacktestConfig,
  type BacktestResult,
  type ExitConfig,
  type ExitReason,
} from "@/lib/backtest";
import type { Candle } from "@/lib/indicators";
import { formatIdr } from "@/lib/format";
import { isStablecoin, type Strategy } from "@/lib/signals";
import { evidenceFor } from "@/lib/evidence";
import type { PairInfo } from "@/lib/pairs";

const EXITS: { key: string; label: string; exit: ExitConfig }[] = [
  {
    key: "T2",
    label: "Target 2 + stop-loss + sinyal SELL (aturan sekarang)",
    exit: { target: "T2", exitOnSellSignal: true, maxHoldDays: null, trailR: null },
  },
  {
    key: "T1",
    label: "Target 1 + stop-loss + sinyal SELL",
    exit: { target: "T1", exitOnSellSignal: true, maxHoldDays: null, trailR: null },
  },
  {
    key: "NONE",
    label: "Tanpa target: hanya stop-loss atau sinyal SELL",
    exit: { target: null, exitOnSellSignal: true, maxHoldDays: null, trailR: null },
  },
  {
    key: "TRAIL2",
    label: "Trailing stop 2R + sinyal SELL (belum teruji tuntas)",
    exit: { target: null, exitOnSellSignal: true, maxHoldDays: null, trailR: 2 },
  },
];

const REASON_LABEL: Record<ExitReason, string> = {
  stop: "Stop-loss",
  trail: "Trailing stop",
  target: "Target",
  signal: "Sinyal SELL",
  time: "Batas waktu",
  end: "Akhir data",
};

const HISTORY_FROM = 1483228800; // 1 Jan 2017 (UTC)

type Done = {
  result: BacktestResult;
  candles: Candle[];
  cfg: BacktestConfig;
  bh: number[];
  elapsedMs: number;
  fetched: number;
};

const num = (s: string) => Number(s.replace(",", "."));
const fmt = (n: number | null | undefined, d = 1, sign = false) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "-"
    : `${sign && n > 0 ? "+" : ""}${new Intl.NumberFormat("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)}`;
const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

function Box({
  id,
  label,
  value,
  tone,
}: {
  id: string;
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-[color:var(--neon-magenta)]/30 bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/60">{label}</p>
      <p
        data-testid={id}
        className={`mt-1 text-base font-bold ${tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-white"}`}
      >
        {value}
      </p>
    </div>
  );
}

function EquityChart({ done, mode }: { done: Done; mode: "compare" | "strategy" }) {
  const { result, candles, bh } = done;
  const first = result.startIndex;
  const s0 = done.cfg.startEquity;
  const log = mode === "compare";
  const tf = (v: number) => (log ? Math.log(Math.max(v, 1e-9)) : v);
  const pts = (vals: number[], from: number) => vals.map((v, k) => ({ x: from + k, y: tf(v) }));
  const a = [{ x: first, y: tf(s0) }, ...pts(result.equity, first)];
  const b = log ? [{ x: first, y: tf(s0) }, ...pts(bh, first + 1)] : [];
  const xs = [first, candles.length - 1];
  const ys = [...a, ...b].map((q) => q.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const W = 640;
  const H = 220;
  const L = 44;
  const R = 8;
  const T = 8;
  const B = 22;
  const px = (x: number) => L + ((x - xs[0]) / Math.max(1, xs[1] - xs[0])) * (W - L - R);
  const py = (y: number) => T + (1 - (y - yMin) / Math.max(1e-9, yMax - yMin)) * (H - T - B);
  const path = (p: { x: number; y: number }[]) =>
    p.map((q, i) => `${i === 0 ? "M" : "L"}${px(q.x).toFixed(1)},${py(q.y).toFixed(1)}`).join(" ");
  const yearTicks: { x: number; label: string }[] = [];
  for (let i = first; i < candles.length; i++) {
    const d = new Date(candles[i].time * 1000);
    if (d.getUTCMonth() === 0 && d.getUTCDate() === 1)
      yearTicks.push({ x: i, label: String(d.getUTCFullYear()) });
  }
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  return (
    <svg
      data-testid={log ? "bt-chart" : "bt-chart-strategy"}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={log ? "Kurva modal strategi dan buy and hold" : "Kurva modal strategi saja"}
    >
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="rgba(255,255,255,0.1)" />
          <text x={L - 4} y={py(t) + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.6)">
            {fmt(log ? Math.exp(t) : t, (log ? Math.exp(t) : t) < 10 ? 1 : 0)}
          </text>
        </g>
      ))}
      {yearTicks.map((t) => (
        <text
          key={t.label}
          x={px(t.x)}
          y={H - 6}
          textAnchor="middle"
          fontSize="9"
          fill="rgba(255,255,255,0.6)"
        >
          {t.label}
        </text>
      ))}
      {log && <path d={path(b)} fill="none" stroke="#FF8A3D" strokeWidth="1.5" opacity="0.9" />}
      <path d={path(a)} fill="none" stroke="#6EE7B7" strokeWidth="2" />
    </svg>
  );
}

export function BacktestPanel({ pairs, defaultPair }: { pairs: PairInfo[]; defaultPair: string }) {
  const getCandles = useServerFn(fetchIndodaxCandles);
  const [pair, setPair] = useState(defaultPair);
  const [strategy, setStrategy] = useState<Strategy>("trend");
  const [exitKey, setExitKey] = useState("T2");
  const [feeText, setFeeText] = useState("");
  const [slipText, setSlipText] = useState(String(DEFAULT_BACKTEST.slippagePctPerSide));
  const [riskText, setRiskText] = useState(String(DEFAULT_BACKTEST.riskPct));
  const [status, setStatus] = useState<"idle" | "loading" | "computing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [showAll, setShowAll] = useState(false);

  const pairInfo = useMemo(() => pairs.find((p) => p.id === pair), [pairs, pair]);
  const feeShown =
    feeText !== "" ? feeText : String(pairInfo?.takerFeePct ?? DEFAULT_BACKTEST.feePctPerSide);

  const run = async () => {
    setError(null);
    setDone(null);
    setShowAll(false);
    const fee = num(feeShown);
    const slip = num(slipText);
    const risk = num(riskText);
    if (!Number.isFinite(fee) || fee < 0 || fee > 2)
      return fail("Biaya per sisi harus antara 0 dan 2%.");
    if (!Number.isFinite(slip) || slip < 0 || slip > 2)
      return fail("Slippage harus antara 0 dan 2%.");
    if (!Number.isFinite(risk) || risk <= 0 || risk > 10)
      return fail("Risiko per transaksi harus antara 0 dan 10%.");
    if (isStablecoin(pair))
      return fail(
        "Stablecoin tidak dianalisis: harganya sengaja dipatok, jadi backtest tidak bermakna.",
      );
    try {
      setStatus("loading");
      const now = Math.floor(Date.now() / 1000);
      const raw = (await getCandles({ data: { pair, from: HISTORY_FROM, to: now } })) as Candle[];
      const candles = dropPartialCandle(raw, now);
      if (candles.length < 150) {
        return fail(
          `Riwayat koin ini baru ${candles.length} hari. Backtest butuh minimal 150 hari supaya hasilnya berarti.`,
        );
      }
      setStatus("computing");
      await new Promise((r) => setTimeout(r, 40)); // beri kesempatan layar menampilkan "Menghitung…"
      const cfg: BacktestConfig = {
        ...DEFAULT_BACKTEST,
        strategy,
        pairId: pair,
        feePctPerSide: fee,
        slippagePctPerSide: slip,
        riskPct: risk,
        exit: EXITS.find((x) => x.key === exitKey)!.exit,
      };
      const t0 = performance.now();
      const result = runBacktest(candles, cfg);
      const bh = buyHoldCurve(candles, result.startIndex, cfg.startEquity, fee, slip);
      setDone({ result, candles, cfg, bh, elapsedMs: performance.now() - t0, fetched: raw.length });
      setStatus("done");
    } catch (e) {
      fail(`Gagal mengambil atau menghitung data: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const fail = (msg: string) => {
    setError(msg);
    setStatus("error");
  };

  const s = done?.result.summary;
  const warnings: string[] = [];
  if (done && s) {
    if (s.trades < 30)
      warnings.push(
        `Hanya ${s.trades} transaksi: sampel terlalu kecil untuk menyimpulkan apa pun.`,
      );
    if (s.years < 2)
      warnings.push(
        `Riwayat hanya ${fmt(s.years, 1)} tahun: belum mencakup beragam kondisi pasar (naik, turun, datar).`,
      );
    if (done.cfg.strategy === "contrarian")
      warnings.push(
        `${evidenceFor("contrarian").title}: di uji 8 koin selama 9,8 tahun, rata-ratanya -0,07R per transaksi.`,
      );
    if (done.cfg.exit.trailR != null)
      warnings.push("Trailing stop belum teruji tuntas pada data lama yang terpisah.");
    warnings.push(
      "Hasil satu koin saja mudah menyesatkan. Uji beberapa koin dan beberapa periode sebelum percaya pada hasilnya.",
    );
  }
  const trades = done?.result.trades ?? [];
  const shownTrades = showAll ? trades : trades.slice(-25);

  return (
    <section className="neon-card rounded-2xl p-5 sm:p-7" aria-label="Backtest">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-neon-orange">
        Backtest — uji aturan di data lama
      </h2>
      <p className="mb-5 text-sm text-white/70">
        Memutar ulang aturan sinyal yang sama dengan analisis live, hari demi hari, pada riwayat
        harian Indodax (sejak 2017 bila tersedia). Masuk di harga buka hari berikutnya, stop-loss
        didahulukan kalau stop dan target tersentuh di hari yang sama, dan biaya serta slippage
        dikenakan di kedua sisi. Posisi dibuka satu per satu tanpa leverage.
      </p>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
          Koin
          <select
            aria-label="Koin backtest"
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            disabled={status === "loading" || status === "computing"}
            className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white"
          >
            {(pairs.some((p) => p.id === pair)
              ? pairs
              : [
                  {
                    id: pair,
                    label: pair.toUpperCase(),
                    volIdr: null,
                    takerFeePct: null,
                    minOrderIdr: null,
                  },
                  ...pairs,
                ]
            ).map((p) => (
              <option key={p.id} value={p.id} className="bg-[#1B1035]">
                {p.label}
                {isStablecoin(p.id) ? " · stablecoin" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
          Strategi
          <div className="inline-flex rounded-md border border-[color:var(--neon-violet)]/60 bg-black/30 p-1">
            {(
              [
                ["trend", "Trend Following"],
                ["contrarian", "Contrarian"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={strategy === k}
                onClick={() => setStrategy(k)}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold normal-case tracking-normal ${strategy === k ? "bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] text-white" : "text-white/70"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60 sm:col-span-2">
          Cara keluar
          <select
            aria-label="Cara keluar"
            value={exitKey}
            onChange={(e) => setExitKey(e.target.value)}
            className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white"
          >
            {EXITS.map((x) => (
              <option key={x.key} value={x.key} className="bg-[#1B1035]">
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["Biaya per sisi (%)", "Biaya per sisi", feeShown, setFeeText],
            ["Slippage per sisi (%)", "Slippage per sisi", slipText, setSlipText],
            ["Risiko per transaksi (% modal)", "Risiko backtest", riskText, setRiskText],
          ] as const
        ).map(([label, aria, value, set]) => (
          <label
            key={aria}
            className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60"
          >
            {label}
            <input
              aria-label={aria}
              inputMode="decimal"
              value={value}
              onChange={(e) => set(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
              className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white"
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={run}
        disabled={status === "loading" || status === "computing"}
        className="rounded-lg bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] px-5 py-2.5 text-sm font-bold text-white shadow-lg disabled:opacity-50"
      >
        Jalankan backtest
      </button>
      <span data-testid="bt-status" className="ml-3 text-xs text-white/60">
        {status === "loading" && "Mengambil riwayat harga…"}
        {status === "computing" && "Menghitung…"}
      </span>

      {error && (
        <div
          data-testid="bt-error"
          className="mt-4 rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100"
        >
          {error}
        </div>
      )}

      {done && s && (
        <div className="mt-6" data-testid="bt-result">
          <p className="mb-3 text-xs text-white/60" data-testid="bt-data-info">
            Data: {done.candles.length} candle harian ({day(done.candles[0].time)} sampai{" "}
            {day(done.candles[done.candles.length - 1].time)}), transaksi dihitung mulai{" "}
            {day(done.candles[done.result.startIndex].time)}. Dihitung dalam{" "}
            <span data-testid="bt-elapsed">{Math.round(done.elapsedMs)}</span> ms.
          </p>

          <ul
            data-testid="bt-warnings"
            className="mb-4 list-disc space-y-1 pl-5 text-xs text-yellow-200"
          >
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Box id="bt-trades" label="Jumlah transaksi" value={String(s.trades)} />
            <Box
              id="bt-win"
              label="Persen menang"
              value={s.winRatePct === null ? "-" : `${fmt(s.winRatePct, 0)}%`}
            />
            <Box
              id="bt-meanr"
              label="Rata-rata per transaksi"
              value={s.expectancyR === null ? "-" : `${fmt(s.expectancyR, 2, true)}R`}
              tone={s.expectancyR === null ? undefined : s.expectancyR > 0 ? "good" : "bad"}
            />
            <Box
              id="bt-return"
              label="Total hasil strategi"
              value={`${fmt(s.totalReturnPct, 1, true)}%`}
              tone={s.totalReturnPct > 0 ? "good" : "bad"}
            />
            <Box
              id="bt-dd"
              label="Kerugian terdalam (max drawdown)"
              value={`${fmt(s.maxDrawdownPct, 1)}%`}
            />
            <Box id="bt-expo" label="Waktu memegang posisi" value={`${fmt(s.exposurePct, 0)}%`} />
            <Box
              id="bt-pf"
              label="Faktor profit"
              value={
                s.profitFactor === null
                  ? s.trades > 0 && s.wins > 0
                    ? "tanpa rugi"
                    : "-"
                  : fmt(s.profitFactor, 2)
              }
            />
            <Box
              id="bt-bh"
              label="Buy & hold (pembanding)"
              value={s.buyHoldReturnPct === null ? "-" : `${fmt(s.buyHoldReturnPct, 0, true)}%`}
            />
            <Box
              id="bt-bhdd"
              label="Drawdown buy & hold"
              value={s.buyHoldMaxDrawdownPct === null ? "-" : `${fmt(s.buyHoldMaxDrawdownPct, 0)}%`}
            />
          </div>
          <p className="mb-4 text-[11px] text-white/50">
            1R = untung atau rugi sebesar risiko awal (jarak harga masuk ke stop-loss). Hasil
            strategi memakai risiko {fmt(done.cfg.riskPct, 1)}% modal per transaksi dan hanya
            memegang posisi sebagian waktu, jadi hasil mentahnya tidak sebanding langsung dengan buy
            &amp; hold. Bandingkan juga kerugian terdalamnya.
          </p>

          <div className="mb-5 rounded-lg border border-white/15 bg-black/20 p-3">
            <p className="mb-2 text-[11px] uppercase tracking-widest text-white/60">
              Kurva modal (skala logaritmik): <span className="text-emerald-300">strategi</span> vs{" "}
              <span className="text-orange-300">buy &amp; hold</span>, keduanya mulai dari 100
            </p>
            <EquityChart done={done} mode="compare" />
          </div>

          <div className="mb-5 rounded-lg border border-white/15 bg-black/20 p-3">
            <p className="mb-2 text-[11px] uppercase tracking-widest text-white/60">
              Kurva modal <span className="text-emerald-300">strategi saja</span> (skala biasa,
              mulai dari 100), supaya naik-turunnya terlihat jelas
            </p>
            <EquityChart done={done} mode="strategy" />
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neon-orange">
            Hasil per tahun
          </h3>
          <div className="mb-5 overflow-x-auto">
            <table data-testid="bt-years" className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-white/60">
                <tr>
                  <th className="py-1 pr-4">Tahun</th>
                  <th className="py-1 pr-4">Strategi</th>
                  <th className="py-1">Buy &amp; hold</th>
                </tr>
              </thead>
              <tbody>
                {s.byYear.map((y) => (
                  <tr key={y.year} className="border-t border-white/10">
                    <td className="py-1 pr-4">{y.year}</td>
                    <td
                      className={`py-1 pr-4 ${y.strategyPct >= 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {fmt(y.strategyPct, 1, true)}%
                    </td>
                    <td className="py-1 text-white/80">{fmt(y.buyHoldPct, 1, true)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neon-orange">
            Daftar transaksi ({showAll ? "semua" : "25 terakhir"} dari {trades.length})
          </h3>
          <div className="overflow-x-auto">
            <table
              data-testid="bt-trades-table"
              className="w-full whitespace-nowrap text-left text-xs"
            >
              <thead className="text-[10px] uppercase tracking-widest text-white/60">
                <tr>
                  <th className="py-1 pr-3">Masuk</th>
                  <th className="py-1 pr-3">Keluar</th>
                  <th className="py-1 pr-3">Harga masuk</th>
                  <th className="py-1 pr-3">Harga keluar</th>
                  <th className="py-1 pr-3">Alasan keluar</th>
                  <th className="py-1 pr-3">Hasil</th>
                  <th className="py-1">Hari</th>
                </tr>
              </thead>
              <tbody>
                {shownTrades.map((t) => (
                  <tr key={`${t.entryIndex}-${t.exitIndex}`} className="border-t border-white/10">
                    <td className="py-1 pr-3">{day(done.candles[t.entryIndex].time)}</td>
                    <td className="py-1 pr-3">{day(done.candles[t.exitIndex].time)}</td>
                    <td className="py-1 pr-3">{formatIdr(t.entryPrice)}</td>
                    <td className="py-1 pr-3">{formatIdr(t.exitPrice)}</td>
                    <td className="py-1 pr-3">{REASON_LABEL[t.reason]}</td>
                    <td
                      className={`py-1 pr-3 font-semibold ${t.rMultiple > 0 ? "text-emerald-300" : "text-red-300"}`}
                    >
                      {fmt(t.rMultiple, 2, true)}R
                    </td>
                    <td className="py-1">{t.holdDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trades.length > 25 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-xs text-white/70 underline"
            >
              {showAll
                ? "Tampilkan 25 terakhir saja"
                : `Tampilkan semua ${trades.length} transaksi`}
            </button>
          )}
          <p className="mt-5 text-[11px] text-white/45">
            Hasil masa lalu tidak menjamin hasil ke depan. Biaya yang dipakai hanyalah perkiraan;
            cek tarif Indodax yang berlaku untukmu. Koin yang sudah tidak ada tidak ikut teruji,
            jadi hasilnya cenderung lebih bagus dari kenyataan. Bukan saran finansial.
          </p>
        </div>
      )}
    </section>
  );
}
