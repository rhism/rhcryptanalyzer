import { computeAnalysis, DAY_SECONDS, type Candle } from "./indicators";
import { computeSignal, type SignalAction, type Strategy } from "./signals";

/**
 * Backtest: memutar ulang aturan sinyal yang SAMA dengan aplikasi live pada data harian lama.
 *
 * Aturan simulasi (semuanya konservatif dan tanpa mengintip masa depan):
 *  - Keputusan pada hari i memakai candle SELESAI sampai hari i-1 + harga penutupan hari i sebagai
 *    "harga live" (persis seperti analisis live). Candle hari i sendiri tidak dipakai ATR/level/volume.
 *  - Order dieksekusi pada HARGA BUKA hari i+1 (bukan harga penutupan hari keputusan).
 *  - Entry dilewati kalau harga buka sudah di bawah stop-loss atau di atas target (setup sudah lewat).
 *  - Stop-loss dan target diperiksa tiap hari dengan high/low. Kalau keduanya tersentuh di hari yang
 *    sama, dianggap STOP yang kena duluan. Gap melewati stop = keluar di harga buka (rugi lebih besar).
 *  - Biaya (fee) dan slippage dikenakan di setiap sisi, merugikan kita.
 *  - Satu posisi per koin, tanpa pyramiding, tanpa leverage (spot).
 *  - Posisi yang masih terbuka di akhir data ditutup di harga penutupan terakhir.
 */

export type ExitConfig = {
  /** Ambil untung di Target 1 / Target 2 dari rencana risiko; null = tanpa target (hanya stop atau sinyal). */
  target: "T1" | "T2" | null;
  /** Keluar kalau sinyal berubah jadi SELL (dieksekusi di buka hari berikutnya). */
  exitOnSellSignal: boolean;
  /** Keluar paksa setelah N hari (dieksekusi di buka hari berikutnya); null = tanpa batas waktu. */
  maxHoldDays: number | null;
  /**
   * Trailing stop: stop-loss dinaikkan mengikuti harga tertinggi sejak entry, berjarak trailR × R di bawahnya
   * (R = jarak entry ke stop awal). Stop hanya boleh naik, tidak pernah turun. Pembaruan memakai high hari i
   * dan baru berlaku mulai hari i+1 (tanpa mengintip). null/kosong = tanpa trailing stop.
   */
  trailR?: number | null;
};

export type BacktestConfig = {
  strategy: Strategy;
  pairId: string;
  /** Hari pertama yang boleh jadi hari keputusan (indeks candle). */
  warmupDays: number;
  /** Biaya per sisi (beli dan jual), dalam persen. Contoh dokumentasi Indodax: 0,2. */
  feePctPerSide: number;
  /** Selisih harga eksekusi per sisi, dalam persen. */
  slippagePctPerSide: number;
  /** Risiko per transaksi sebagai persen dari ekuitas. */
  riskPct: number;
  startEquity: number;
  exit: ExitConfig;
};

export const DEFAULT_BACKTEST: Omit<BacktestConfig, "strategy" | "pairId"> = {
  warmupDays: 40,
  feePctPerSide: 0.2,
  slippagePctPerSide: 0.1,
  riskPct: 1,
  startEquity: 100,
  exit: { target: "T2", exitOnSellSignal: true, maxHoldDays: null },
};

export type ExitReason = "stop" | "trail" | "target" | "signal" | "time" | "end";

export type Trade = {
  signalIndex: number;
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  stop: number;
  target: number | null;
  units: number;
  pnl: number;
  /** Untung/rugi dibagi risiko awal (jarak entry ke stop × unit). 1R = untung sebesar risiko. */
  rMultiple: number;
  reason: ExitReason;
  holdDays: number;
};

export type PeriodStat = { year: number; strategyPct: number; buyHoldPct: number };

export type BacktestSummary = {
  trades: number;
  wins: number;
  winRatePct: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Rata-rata R per transaksi, sudah termasuk biaya dan slippage. */
  expectancyR: number | null;
  profitFactor: number | null;
  totalReturnPct: number;
  cagrPct: number | null;
  maxDrawdownPct: number;
  exposurePct: number;
  years: number;
  buyHoldReturnPct: number | null;
  buyHoldMaxDrawdownPct: number | null;
  byYear: PeriodStat[];
};

export type BacktestResult = {
  trades: Trade[];
  /** Ekuitas (mark-to-market harian) mulai dari indeks `startIndex`. */
  equity: number[];
  startIndex: number;
  summary: BacktestSummary;
};

export type SignalProbe = {
  action: SignalAction;
  stop: number | null;
  target1: number | null;
  target2: number | null;
};
export type SignalFn = (i: number) => SignalProbe;

/** Sinyal persis seperti live: 120 candle selesai + harga penutupan hari i sebagai harga live. */
export function liveSignalFn(
  candles: Candle[],
  cfg: Pick<BacktestConfig, "strategy" | "pairId">,
): SignalFn {
  return (i) => {
    const window = candles.slice(Math.max(0, i - 120), i + 1);
    const c = candles[i];
    // now = detik terakhir hari i: candle hari i belum "selesai", candle sebelumnya sudah.
    const a = computeAnalysis(window, c.close, c.time + DAY_SECONDS - 1);
    const s = computeSignal(a, cfg.strategy, cfg.pairId);
    return {
      action: s.action,
      stop: a.plan?.stopLoss ?? null,
      target1: a.plan?.target1 ?? null,
      target2: a.plan?.target2 ?? null,
    };
  };
}

/** Membuang candle hari ini yang belum selesai (supaya backtest hanya memakai data final). */
export function dropPartialCandle(candles: Candle[], nowSec: number): Candle[] {
  return candles.filter((c) => c.time + DAY_SECONDS <= nowSec);
}

type Pos = {
  entryIndex: number;
  signalIndex: number;
  entryPrice: number;
  units: number;
  /** Stop awal (tetap) dipakai untuk menghitung R; `stop` bisa naik karena trailing. */
  initialStop: number;
  stop: number;
  target: number | null;
  highest: number;
};

export function runBacktest(
  candles: Candle[],
  cfg: BacktestConfig,
  signalFn?: SignalFn,
): BacktestResult {
  const n = candles.length;
  const sig = signalFn ?? liveSignalFn(candles, cfg);
  const fee = cfg.feePctPerSide / 100;
  const slip = cfg.slippagePctPerSide / 100;
  const first = Math.min(Math.max(cfg.warmupDays, 0), n);

  let cash = cfg.startEquity;
  let pos: Pos | null = null;
  let pendingEntry: { signalIndex: number; stop: number; target: number | null } | null = null;
  let pendingExit: ExitReason | null = null;
  let daysInPos = 0;
  const trades: Trade[] = [];
  const equity: number[] = [];

  const closePosition = (i: number, rawPrice: number, reason: ExitReason) => {
    if (!pos) return;
    const exitPrice = rawPrice * (1 - slip);
    const proceeds = pos.units * exitPrice * (1 - fee);
    const cost = pos.units * pos.entryPrice * (1 + fee);
    const pnl = proceeds - cost;
    const riskAmount = pos.units * (pos.entryPrice - pos.initialStop);
    cash += proceeds;
    trades.push({
      signalIndex: pos.signalIndex,
      entryIndex: pos.entryIndex,
      exitIndex: i,
      entryPrice: pos.entryPrice,
      exitPrice,
      stop: pos.initialStop,
      target: pos.target,
      units: pos.units,
      pnl,
      rMultiple: riskAmount > 0 ? pnl / riskAmount : 0,
      reason: reason === "stop" && pos.stop > pos.initialStop ? "trail" : reason,
      holdDays: i - pos.entryIndex,
    });
    pos = null;
  };

  for (let i = first; i < n; i++) {
    const c = candles[i];

    // 1) Eksekusi entry yang diputuskan kemarin, di harga buka hari ini.
    if (pendingEntry && !pos) {
      const entryPrice = c.open * (1 + slip);
      const { stop, target } = pendingEntry;
      const invalid = entryPrice <= stop || (target !== null && entryPrice >= target);
      if (!invalid) {
        const riskAmount = (cash * cfg.riskPct) / 100;
        let units = riskAmount / (entryPrice - stop);
        units = Math.min(units, cash / (entryPrice * (1 + fee)));
        if (units > 0 && Number.isFinite(units)) {
          cash -= units * entryPrice * (1 + fee);
          pos = {
            entryIndex: i,
            signalIndex: pendingEntry.signalIndex,
            entryPrice,
            units,
            initialStop: stop,
            stop,
            target,
            highest: -Infinity,
          };
        }
      }
    }
    pendingEntry = null;

    // 2) Eksekusi exit yang diputuskan kemarin (sinyal / batas waktu), di harga buka.
    if (pos && pendingExit) {
      closePosition(i, c.open, pendingExit);
    }
    pendingExit = null;

    // 3) Stop-loss / target selama hari ini (stop didahulukan kalau keduanya tersentuh).
    if (pos) {
      daysInPos++;
      if (c.low <= pos.stop) {
        closePosition(i, Math.min(pos.stop, c.open), "stop");
      } else if (pos.target !== null && c.high >= pos.target) {
        closePosition(i, Math.max(pos.target, c.open), "target");
      }
    }

    // 3b) Trailing stop: naikkan stop berdasarkan high hari ini; berlaku mulai besok.
    if (pos && cfg.exit.trailR != null) {
      pos.highest = Math.max(pos.highest, c.high);
      const candidate = pos.highest - cfg.exit.trailR * (pos.entryPrice - pos.initialStop);
      if (candidate > pos.stop) pos.stop = candidate;
    }

    // 4) Catat ekuitas penutupan hari ini.
    equity.push(cash + (pos ? pos.units * c.close : 0));

    // 5) Keputusan akhir hari (dieksekusi di buka hari berikutnya).
    if (i < n - 1) {
      if (pos) {
        const held = i - pos.entryIndex + 1;
        if (cfg.exit.exitOnSellSignal && sig(i).action === "SELL") pendingExit = "signal";
        else if (cfg.exit.maxHoldDays !== null && held >= cfg.exit.maxHoldDays)
          pendingExit = "time";
      } else {
        const s = sig(i);
        if (s.action === "BUY" && s.stop !== null) {
          const target =
            cfg.exit.target === "T1" ? s.target1 : cfg.exit.target === "T2" ? s.target2 : null;
          pendingEntry = { signalIndex: i, stop: s.stop, target };
        }
      }
    }
  }

  // Posisi yang masih terbuka di akhir data ditutup di harga penutupan terakhir.
  if (pos && n > 0) {
    closePosition(n - 1, candles[n - 1].close, "end");
    equity[equity.length - 1] = cash;
  }

  return {
    trades,
    equity,
    startIndex: first,
    summary: summarize(candles, cfg, first, trades, equity, daysInPos),
  };
}

/**
 * Nilai portofolio buy-and-hold untuk indeks first+1 .. n-1: beli di harga buka hari first+1 (dengan biaya dan
 * slippage yang sama), nilai tiap hari = unit × harga penutupan. Dipakai untuk pembanding dan grafik.
 */
export function buyHoldCurve(
  candles: Candle[],
  first: number,
  startEquity: number,
  feePct: number,
  slipPct: number,
): number[] {
  const n = candles.length;
  if (first + 1 >= n) return [];
  const entry = candles[first + 1].open * (1 + slipPct / 100);
  const units = startEquity / (entry * (1 + feePct / 100));
  const out: number[] = [];
  for (let i = first + 1; i < n; i++) out.push(units * candles[i].close);
  return out;
}

function maxDrawdownPct(values: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.min(worst, (v - peak) / peak);
  }
  return worst * 100;
}

function summarize(
  candles: Candle[],
  cfg: BacktestConfig,
  first: number,
  trades: Trade[],
  equity: number[],
  daysInPos: number,
): BacktestSummary {
  const n = candles.length;
  const fee = cfg.feePctPerSide / 100;
  const slip = cfg.slippagePctPerSide / 100;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const finalEquity = equity.length ? equity[equity.length - 1] : cfg.startEquity;
  const spanDays = equity.length > 0 ? candles[n - 1].time - candles[first].time : 0;
  const years = spanDays / (365.25 * DAY_SECONDS);

  // Pembanding: beli di buka hari pertama yang mungkin, tahan sampai akhir (dengan biaya & slippage yang sama).
  let buyHoldReturnPct: number | null = null;
  let buyHoldMaxDrawdownPct: number | null = null;
  const bhValues: number[] = [];
  if (first + 1 < n) {
    const entry = candles[first + 1].open * (1 + slip);
    const units = cfg.startEquity / (entry * (1 + fee));
    bhValues.push(
      ...buyHoldCurve(candles, first, cfg.startEquity, cfg.feePctPerSide, cfg.slippagePctPerSide),
    );
    const exit = candles[n - 1].close * (1 - slip) * (1 - fee) * units;
    buyHoldReturnPct = (exit / cfg.startEquity - 1) * 100;
    buyHoldMaxDrawdownPct = maxDrawdownPct([cfg.startEquity, ...bhValues]);
  }

  // Hasil per tahun kalender (UTC), strategi vs buy and hold.
  const byYear: PeriodStat[] = [];
  const year = (i: number) => new Date(candles[i].time * 1000).getUTCFullYear();
  let startYearIdx = first;
  for (let i = first; i < n; i++) {
    const last = i === n - 1 || year(i + 1) !== year(i);
    if (!last) continue;
    const prevEq = startYearIdx === first ? cfg.startEquity : equity[startYearIdx - first - 1];
    const curEq = equity[i - first];
    const bhPrev =
      startYearIdx === first
        ? candles[Math.min(first + 1, n - 1)].open
        : candles[startYearIdx - 1].close;
    const bhCur = candles[i].close;
    byYear.push({
      year: year(i),
      strategyPct: (curEq / prevEq - 1) * 100,
      buyHoldPct: (bhCur / bhPrev - 1) * 100,
    });
    startYearIdx = i + 1;
  }

  return {
    trades: trades.length,
    wins: wins.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    avgWinR: mean(wins.map((t) => t.rMultiple)),
    avgLossR: mean(losses.map((t) => t.rMultiple)),
    expectancyR: mean(trades.map((t) => t.rMultiple)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    totalReturnPct: (finalEquity / cfg.startEquity - 1) * 100,
    cagrPct:
      years > 0 && finalEquity > 0
        ? (Math.pow(finalEquity / cfg.startEquity, 1 / years) - 1) * 100
        : null,
    maxDrawdownPct: maxDrawdownPct([cfg.startEquity, ...equity]),
    exposurePct: equity.length ? (daysInPos / equity.length) * 100 : 0,
    years,
    buyHoldReturnPct,
    buyHoldMaxDrawdownPct,
    byYear,
  };
}
