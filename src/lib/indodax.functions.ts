import { createServerFn } from "@tanstack/react-start";

export type IndodaxTicker = {
  last: string;
  high: string;
  low: string;
  vol_idr?: string;
  buy?: string;
  sell?: string;
};

export const fetchIndodaxTicker = createServerFn({ method: "POST" })
  .inputValidator((input: { pair: string }) => {
    if (!input?.pair || !/^[a-z0-9]+$/i.test(input.pair)) {
      throw new Error("Invalid pair");
    }
    return { pair: input.pair.toLowerCase() };
  })
  .handler(async ({ data }) => {
    const res = await fetch(`https://indodax.com/api/ticker/${data.pair}`);
    if (!res.ok) throw new Error(`Indodax ticker HTTP ${res.status}`);
    const json = await res.json();
    const t = json?.ticker;
    if (!t) throw new Error("Indodax ticker response invalid");
    return t as IndodaxTicker;
  });

export const fetchIndodaxCandles = createServerFn({ method: "POST" })
  .inputValidator((input: { pair: string; from: number; to: number }) => {
    if (!input?.pair || !/^[a-z0-9]+$/i.test(input.pair)) {
      throw new Error("Invalid pair");
    }
    if (!Number.isFinite(input.from) || !Number.isFinite(input.to)) {
      throw new Error("Invalid range");
    }
    return { pair: input.pair.toLowerCase(), from: input.from, to: input.to };
  })
  .handler(async ({ data }) => {
    const symbol = data.pair.toUpperCase();
    const url = `https://indodax.com/tradingview/history?symbol=${symbol}&resolution=1D&from=${data.from}&to=${data.to}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Indodax candles HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.c || !Array.isArray(json.c)) throw new Error("Indodax candles response invalid");
    return (json.c as unknown[])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n)) as number[];
  });
