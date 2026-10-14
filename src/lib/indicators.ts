/**
 * Perhitungan indikator, level harga, dan rencana risiko — murni kode, tanpa AI.
 *
 * Aturan penting:
 *  - Candle harian Indodax dimulai 00:00 UTC. Candle HARI INI belum selesai (volume & high/low
 *    masih berjalan), jadi ATR, volume, dan level support/resistance hanya memakai candle yang
 *    sudah SELESAI.
 *  - Indikator berbasis harga penutupan (RSI, MA, MACD) memakai: penutupan candle selesai +
 *    harga live terbaru. Ini sama seperti perilaku aplikasi sebelumnya (RSI/MA ikut harga terkini).
 *  - Modul ini tidak punya efek samping dan tidak mengimpor apa pun, supaya bisa diuji dan
 *    dipakai ulang (mis. backtest di langkah berikutnya).
 */

export type Candle = {
  /** Unix detik, awal candle (00:00 UTC untuk candle harian). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const DAY_SECONDS = 86_400;

/** Parameter strategi. Nilai ini akan dioptimalkan lewat backtest di langkah berikutnya. */
export const PARAMS = {
  atrPeriod: 14,
  /** Jarak stop-loss dari harga masuk = stopAtrMultiple × ATR. */
  stopAtrMultiple: 1.5,
  /** Target = harga masuk + kelipatan R (R = jarak ke stop-loss). */
  target1R: 1.5,
  target2R: 3,
  /** Pivot swing: sebuah high/low harus ekstrem dibanding N candle di kiri dan kanannya. */
  swingWindow: 3,
  levelLookback: 90,
  rangeFallbackLookback: 30,
  volumeAvgPeriod: 20,
} as const;

// ---------------------------------------------------------------------------
// Parsing data Indodax
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Mengubah respons endpoint `tradingview/history_v2` Indodax menjadi Candle[].
 * Format yang diamati: [{ Time, Open, High, Low, Close, Volume }] — Volume berupa string.
 * Baris yang tidak valid dibuang (dihitung di `skipped`), hasil diurutkan naik menurut waktu,
 * dan waktu yang duplikat hanya dipakai sekali.
 */
export function parseIndodaxCandles(raw: unknown): { candles: Candle[]; skipped: number } {
  if (!Array.isArray(raw)) return { candles: [], skipped: 0 };
  const byTime = new Map<number, Candle>();
  let skipped = 0;
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    let time = num(r.Time);
    const open = num(r.Open);
    const high = num(r.High);
    const low = num(r.Low);
    const close = num(r.Close);
    const volume = num(r.Volume);
    if (
      time === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      volume < 0 ||
      high < low
    ) {
      skipped++;
      continue;
    }
    if (time > 1e11) time = Math.floor(time / 1000); // jaga-jaga kalau suatu saat berupa milidetik
    byTime.set(time, { time, open, high, low, close, volume });
  }
  return { candles: [...byTime.values()].sort((a, b) => a.time - b.time), skipped };
}

// ---------------------------------------------------------------------------
// Indikator dasar
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** RSI Wilder. Sama dengan perhitungan aplikasi sebelumnya. */
export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** EMA dengan seed = SMA dari `period` nilai pertama. Indeks sebelum seed bernilai null. */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export type Macd = { macd: number; signal: number; hist: number; histPrev: number | null };

/** MACD (12, 26, 9). Butuh minimal slow + signal - 1 = 34 nilai. */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): Macd | null {
  const f = emaSeries(values, fast);
  const s = emaSeries(values, slow);
  const line: number[] = [];
  for (let i = slow - 1; i < values.length; i++) {
    const fv = f[i];
    const sv = s[i];
    if (fv === null || sv === null) return null;
    line.push(fv - sv);
  }
  if (line.length < signalPeriod) return null;
  const sig = emaSeries(line, signalPeriod);
  const last = line.length - 1;
  const sigLast = sig[last];
  if (sigLast === null) return null;
  const sigPrev = last >= 1 ? sig[last - 1] : null;
  return {
    macd: line[last],
    signal: sigLast,
    hist: line[last] - sigLast,
    histPrev: sigPrev !== null ? line[last - 1] - sigPrev : null,
  };
}

/** ATR Wilder. Butuh minimal period + 1 candle. */
export function atr(candles: Candle[], period = PARAMS.atrPeriod): number | null {
  if (candles.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return a;
}

/**
 * Volume candle selesai terakhir dibanding rata-rata candle selesai sebelumnya.
 * Null kalau data pembanding kurang dari 5 candle atau rata-ratanya nol.
 */
export function volumeRatio(closed: Candle[], period = PARAMS.volumeAvgPeriod): number | null {
  if (closed.length < 6) return null;
  const last = closed[closed.length - 1];
  const prior = closed.slice(Math.max(0, closed.length - 1 - period), closed.length - 1);
  const avg = prior.reduce((a, c) => a + c.volume, 0) / prior.length;
  if (!(avg > 0)) return null;
  return last.volume / avg;
}

// ---------------------------------------------------------------------------
// Level support / resistance
// ---------------------------------------------------------------------------

export type Levels = {
  support: number | null;
  resistance: number | null;
  supportSource: "swing" | "range" | null;
  resistanceSource: "swing" | "range" | null;
};

/**
 * Support = swing low terdekat DI BAWAH harga; resistance = swing high terdekat DI ATAS harga.
 * Swing hanya terkonfirmasi setelah `swingWindow` candle berikutnya selesai (tanpa mengintip masa depan).
 * Kalau tidak ada swing, pakai low/high ekstrem dari `rangeFallbackLookback` candle terakhir
 * (hanya bila berada di sisi yang benar dari harga); kalau itu pun tidak ada, hasilnya null.
 */
export function findLevels(closed: Candle[], price: number): Levels {
  const k = PARAMS.swingWindow;
  const look = closed.slice(-PARAMS.levelLookback);
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = k; i < look.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (look[j].high >= look[i].high) isHigh = false;
      if (look[j].low <= look[i].low) isLow = false;
    }
    if (isHigh) swingHighs.push(look[i].high);
    if (isLow) swingLows.push(look[i].low);
  }

  const above = swingHighs.filter((h) => h > price);
  const below = swingLows.filter((l) => l < price);
  let resistance: number | null = above.length ? Math.min(...above) : null;
  let support: number | null = below.length ? Math.max(...below) : null;
  let resistanceSource: Levels["resistanceSource"] = resistance !== null ? "swing" : null;
  let supportSource: Levels["supportSource"] = support !== null ? "swing" : null;

  const recent = closed.slice(-PARAMS.rangeFallbackLookback);
  if (recent.length > 0) {
    if (resistance === null) {
      const maxHigh = Math.max(...recent.map((c) => c.high));
      if (maxHigh > price) {
        resistance = maxHigh;
        resistanceSource = "range";
      }
    }
    if (support === null) {
      const minLow = Math.min(...recent.map((c) => c.low));
      if (minLow < price) {
        support = minLow;
        supportSource = "range";
      }
    }
  }
  return { support, resistance, supportSource, resistanceSource };
}

// ---------------------------------------------------------------------------
// Rencana risiko (long saja — Indodax spot tidak bisa short)
// ---------------------------------------------------------------------------

export type TradePlan = {
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  /** Jarak entry ke stop-loss (R), dalam Rupiah. */
  riskPerUnit: number;
  /** R sebagai persen dari harga masuk. */
  riskPct: number;
  /** Jarak entry ke resistance terdekat dalam kelipatan R (null kalau tidak ada resistance). */
  resistanceInR: number | null;
};

export function buildPlan(entry: number, atr14: number | null, levels: Levels): TradePlan | null {
  if (atr14 === null || !(atr14 > 0) || !(entry > 0)) return null;
  const r = PARAMS.stopAtrMultiple * atr14;
  const stopLoss = entry - r;
  if (!(stopLoss > 0)) return null;
  return {
    entry,
    stopLoss,
    target1: entry + PARAMS.target1R * r,
    target2: entry + PARAMS.target2R * r,
    riskPerUnit: r,
    riskPct: (r / entry) * 100,
    resistanceInR: levels.resistance !== null ? (levels.resistance - entry) / r : null,
  };
}

// ---------------------------------------------------------------------------
// Gabungan
// ---------------------------------------------------------------------------

export type MarketAnalysis = {
  rsi14: number | null;
  ma7: number | null;
  ma25: number | null;
  macd: Macd | null;
  atr14: number | null;
  /** ATR sebagai persen dari harga. */
  atrPct: number | null;
  volumeRatio: number | null;
  levels: Levels;
  plan: TradePlan | null;
  /** Jumlah semua candle yang diterima. */
  candleCount: number;
  /** Jumlah candle yang sudah selesai (dipakai ATR/volume/level). */
  closedCount: number;
  /** Harga yang dipakai sebagai harga sekarang. */
  price: number | null;
  /** Jumlah hari tanpa transaksi (volume 0) di 30 candle selesai terakhir. */
  zeroVolumeDays: number;
  warnings: string[];
};

export function computeAnalysis(
  candles: Candle[],
  livePrice: number,
  nowSec: number,
): MarketAnalysis {
  const warnings: string[] = [];
  const closed = candles.filter((c) => c.time + DAY_SECONDS <= nowSec);
  const lastClosed = closed.length ? closed[closed.length - 1] : null;

  let price: number | null = null;
  if (Number.isFinite(livePrice) && livePrice > 0) price = livePrice;
  else if (lastClosed) {
    price = lastClosed.close;
    warnings.push("Harga live tidak valid, memakai harga penutupan candle terakhir.");
  }

  if (lastClosed && nowSec - (lastClosed.time + DAY_SECONDS) > 2 * DAY_SECONDS) {
    warnings.push("Data candle terbaru sudah lebih dari 2 hari lalu — sumber data mungkin macet.");
  }

  const closes = closed.map((c) => c.close);
  if (price !== null) closes.push(price);

  const rsi14 = rsi(closes, 14);
  const ma7 = sma(closes, 7);
  const ma25 = sma(closes, 25);
  const macdVal = macd(closes);
  const atr14 = atr(closed);
  const vr = volumeRatio(closed);
  const levels: Levels =
    price !== null
      ? findLevels(closed, price)
      : { support: null, resistance: null, supportSource: null, resistanceSource: null };
  const plan = price !== null ? buildPlan(price, atr14, levels) : null;
  const recent30 = closed.slice(-30);
  const zeroVolumeDays = recent30.filter((c) => c.volume === 0).length;

  if (zeroVolumeDays >= 3) {
    warnings.push(
      `${zeroVolumeDays} dari ${recent30.length} hari terakhir tanpa transaksi sama sekali: datanya jarang, indikator kurang bisa dipercaya.`,
    );
  }
  if (rsi14 === null) warnings.push("Data kurang untuk RSI 14 (butuh minimal 15 harga).");
  if (ma25 === null) warnings.push("Data kurang untuk MA 25 (butuh minimal 25 harga).");
  if (macdVal === null) warnings.push("Data kurang untuk MACD (butuh minimal 34 harga).");
  if (atr14 === null)
    warnings.push(
      "Data kurang untuk ATR 14 (butuh minimal 15 candle selesai), stop-loss & target tidak bisa dihitung.",
    );
  if (price !== null && atr14 !== null && plan === null) {
    warnings.push(
      "Stop-loss jatuh di bawah nol (volatilitas terlalu besar dibanding harga), rencana tidak dibuat.",
    );
  }

  return {
    rsi14,
    ma7,
    ma25,
    macd: macdVal,
    atr14,
    atrPct: atr14 !== null && price !== null ? (atr14 / price) * 100 : null,
    volumeRatio: vr,
    levels,
    plan,
    candleCount: candles.length,
    closedCount: closed.length,
    price,
    zeroVolumeDays,
    warnings,
  };
}
