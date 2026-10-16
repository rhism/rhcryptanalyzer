import { compactIdr } from "./format";

/** Satu pair yang bisa dipilih di aplikasi. Hanya pasangan IDR untuk saat ini. */
export type PairInfo = {
  /** Contoh: "btcidr" (format yang dipakai fungsi candle & ticker). */
  id: string;
  /** Contoh: "BTC / IDR". */
  label: string;
  /** Volume transaksi 24 jam dalam Rupiah; null kalau tidak diketahui. */
  volIdr: number | null;
  /** Biaya taker dalam persen (untuk backtest nanti); null kalau tidak ada. */
  takerFeePct: number | null;
  /** Nilai order minimum di Indodax dalam Rupiah (trade_min_base_currency); null kalau tidak ada. */
  minOrderIdr: number | null;
};

/** Di bawah ini dianggap koin sepi. Ambang awal; bisa disetel lewat backtest/pengalaman. */
export const LOW_LIQUIDITY_IDR = 100_000_000;

/** Daftar cadangan kalau /api/pairs gagal diambil, agar aplikasi tetap bisa dipakai. */
export const FALLBACK_PAIRS: PairInfo[] = [
  ["bnbidr", "BNB"],
  ["btcidr", "BTC"],
  ["ethidr", "ETH"],
  ["solidr", "SOL"],
  ["xrpidr", "XRP"],
  ["hypeidr", "HYPE"],
  ["dogeidr", "DOGE"],
  ["beatidr", "BEAT"],
  ["audioidr", "AUDIO"],
].map(([id, sym]) => ({
  id,
  label: `${sym} / IDR`,
  volIdr: null,
  takerFeePct: null,
  minOrderIdr: null,
}));

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Menggabungkan /api/pairs (daftar pair) dan /api/summaries (volume) menjadi daftar yang siap dipilih.
 * Hanya pair IDR yang tidak sedang maintenance / ditangguhkan. Urut dari volume terbesar.
 */
export function parsePairs(pairsJson: unknown, summariesJson: unknown): PairInfo[] {
  if (!Array.isArray(pairsJson)) return [];
  const tickers = ((summariesJson as { tickers?: Record<string, { vol_idr?: unknown }> } | null)
    ?.tickers ?? {}) as Record<string, { vol_idr?: unknown }>;
  const seen = new Set<string>();
  const out: PairInfo[] = [];
  for (const raw of pairsJson) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id.toLowerCase() : "";
    if (!/^[a-z0-9]+idr$/.test(id) || seen.has(id)) continue;
    if (String(p.base_currency ?? "").toLowerCase() !== "idr") continue;
    if (truthy(p.is_maintenance) || truthy(p.is_market_suspended)) continue;
    seen.add(id);
    const base = id.slice(0, -3);
    const unit =
      typeof p.traded_currency_unit === "string" && p.traded_currency_unit
        ? p.traded_currency_unit
        : base.toUpperCase();
    const tickerId = typeof p.ticker_id === "string" && p.ticker_id ? p.ticker_id : `${base}_idr`;
    out.push({
      id,
      label: `${unit.toUpperCase()} / IDR`,
      volIdr: num(tickers[tickerId]?.vol_idr),
      takerFeePct: num(p.trade_fee_percent_taker) ?? num(p.trade_fee_percent),
      minOrderIdr: num(p.trade_min_base_currency),
    });
  }
  return out.sort((a, b) => {
    const av = a.volIdr ?? -1;
    const bv = b.volIdr ?? -1;
    return bv - av || a.label.localeCompare(b.label);
  });
}

/** Peringatan likuiditas untuk volume 24 jam; null kalau volumenya cukup. */
export function liquidityWarning(volIdr: number | null): string | null {
  if (volIdr === null)
    return "Volume 24 jam tidak diketahui, jadi likuiditas koin ini tidak bisa dinilai.";
  if (volIdr < LOW_LIQUIDITY_IDR) {
    return `Volume 24 jam hanya ${compactIdr(volIdr)} (koin sepi): harga bisa melompat dan stop-loss bisa tereksekusi jauh dari angka yang dihitung.`;
  }
  return null;
}
