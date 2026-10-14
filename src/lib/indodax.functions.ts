import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./auth";
import { parseIndodaxCandles, type Candle } from "./indicators";
import { parsePairs, type PairInfo } from "./pairs";

export type IndodaxTicker = {
  last: string;
  high: string;
  low: string;
  vol_idr?: string;
  buy?: string;
  sell?: string;
};

// Accept either "bnbidr" or "bnb_idr". Normalize to "bnb_idr" (official docs format).
function normalizePair(pair: string): { underscore: string; upper: string } {
  if (!pair || !/^[a-z0-9_]+$/i.test(pair)) throw new Error("Invalid pair");
  const lower = pair.toLowerCase();
  const underscore = lower.includes("_")
    ? lower
    : lower.endsWith("idr")
      ? `${lower.slice(0, -3)}_idr`
      : lower.endsWith("usdt")
        ? `${lower.slice(0, -4)}_usdt`
        : lower;
  const upper = underscore.replace("_", "").toUpperCase();
  return { underscore, upper };
}

export const fetchIndodaxTicker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((input: { pair: string }) => ({ pair: input.pair }))
  .handler(async ({ data }) => {
    const { underscore } = normalizePair(data.pair);
    // Official docs: https://indodax.com/api/{pair_id}/ticker  (pair_id uses underscore)
    const url = `https://indodax.com/api/${underscore}/ticker`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Indodax ticker HTTP ${res.status}`);
    const json = await res.json();
    const t = json?.ticker;
    if (!t) throw new Error("Indodax ticker response invalid");
    return t as IndodaxTicker;
  });

export const fetchIndodaxCandles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((input: { pair: string; from: number; to: number }) => {
    if (!Number.isFinite(input.from) || !Number.isFinite(input.to)) {
      throw new Error("Invalid range");
    }
    return { pair: input.pair, from: input.from, to: input.to };
  })
  .handler(async ({ data }) => {
    const { upper } = normalizePair(data.pair);
    // Unofficial TradingView-style endpoint. Correct form (probed): history_v2 with `tf`
    // (not `resolution`). Valid tf values include 1,5,15,30,60,240,1D.
    const url = `https://indodax.com/tradingview/history_v2?symbol=${upper}&tf=1D&from=${data.from}&to=${data.to}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      console.error("[indodax candles] HTTP", res.status, "url:", url, "body:", text.slice(0, 500));
      throw new Error(`Indodax candles HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.error("[indodax candles] non-JSON response. url:", url, "body:", text.slice(0, 500));
      throw new Error(`Indodax candles non-JSON response: ${text.slice(0, 200)}`);
    }
    if (!Array.isArray(json)) {
      console.error("[indodax candles] unexpected shape. url:", url, "body:", text.slice(0, 500));
      throw new Error("Indodax candles response invalid");
    }
    const { candles, skipped } = parseIndodaxCandles(json);
    if (candles.length === 0) {
      console.error("[indodax candles] tidak ada candle valid. url:", url, "body:", text.slice(0, 500));
      throw new Error(
        json.length === 0
          ? "Indodax tidak mengirim candle untuk rentang ini."
          : "Format candle Indodax berubah (field Time/Open/High/Low/Close/Volume tidak terbaca).",
      );
    }
    if (skipped > 0) console.warn(`[indodax candles] ${skipped} baris candle tidak valid dibuang`);
    return candles satisfies Candle[];
  });

/** Daftar semua pair IDR yang aktif + volume 24 jam (endpoint resmi /api/pairs dan /api/summaries). */
export const fetchIndodaxPairs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<PairInfo[]> => {
    const [pairsRes, summariesRes] = await Promise.all([
      fetch("https://indodax.com/api/pairs"),
      fetch("https://indodax.com/api/summaries"),
    ]);
    if (!pairsRes.ok) throw new Error(`Indodax /api/pairs HTTP ${pairsRes.status}`);
    const pairsJson: unknown = await pairsRes.json();
    // Volume hanya pelengkap: kalau /api/summaries gagal, daftar pair tetap dipakai.
    const summariesJson: unknown = summariesRes.ok ? await summariesRes.json().catch(() => null) : null;
    const list = parsePairs(pairsJson, summariesJson);
    if (list.length === 0) throw new Error("Daftar pair dari Indodax tidak bisa dibaca.");
    return list;
  });
