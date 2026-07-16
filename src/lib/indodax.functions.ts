import { createServerFn } from "@tanstack/react-start";

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
    return (json as Array<{ Close: number | string }>)
      .map((c) => Number(c?.Close))
      .filter((n) => Number.isFinite(n));
  });
