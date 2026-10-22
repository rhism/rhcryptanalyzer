import { DAY_SECONDS, type Candle } from "./indicators";
import type { SignalAction, Strategy } from "./signals";

/**
 * Jurnal: mencatat sinyal sistem dan tebakan pribadi, lalu menilainya dengan data harga SESUDAH pencatatan.
 * Tujuannya satu: mengumpulkan bukti masa depan yang bersih (bukan data lama) tentang siapa yang lebih akurat.
 *
 * Aturan penilaian (konservatif dan ditulis eksplisit supaya bisa diuji):
 *  - Hari pencatatan (hari ke-0) tidak dipakai untuk menilai pergerakan; penilaian mulai dari candle hari ke-1.
 *  - Hanya candle yang sudah SELESAI yang dipakai.
 *  - Sinyal BUY: dinilai seperti transaksi: keluar di stop-loss atau Target 2 (stop didahulukan kalau keduanya
 *    tersentuh di hari yang sama; gap melewati stop = keluar di harga buka), maksimal 30 hari lalu ditutup di
 *    harga penutupan hari ke-30. Hasilnya dalam R (untung/rugi dibagi jarak entry ke stop), tanpa biaya.
 *  - Sinyal SELL: benar kalau harga penutupan hari ke-7 lebih rendah dari harga saat dicatat.
 *  - Sinyal HOLD: tidak dinilai (hanya dicatat perubahan harganya).
 *  - Tebakan: benar kalau pada hari ke-horizon harga penutupan searah tebakan; kalau ada harga target, benar
 *    juga bila target tersentuh lebih dulu (high untuk naik, low untuk turun) dalam horizon itu.
 */

export const JOURNAL_MAX_ENTRIES = 2000;
export const BUY_MAX_DAYS = 30;

export type JournalEntry = {
  id: string;
  /** Detik UTC saat dicatat. */
  createdAt: number;
  kind: "signal" | "guess";
  pairId: string;
  /** Harga saat dicatat. */
  price0: number;
  // --- sinyal sistem ---
  strategy?: Strategy;
  action?: SignalAction;
  stop?: number | null;
  target1?: number | null;
  target2?: number | null;
  // --- tebakan pribadi ---
  direction?: "naik" | "turun";
  targetPrice?: number | null;
  horizonDays?: number;
  // --- umum ---
  /** Ada narasi/hype di sosial media yang melatarbelakangi catatan ini. */
  hype?: boolean;
  source?: string;
  note?: string;
};

export type Verdict = "benar" | "salah" | "menunggu" | "tidak dinilai";

export type Outcome = {
  /** Perubahan harga (%) dari price0 ke penutupan hari ke-3/7/14; null = belum waktunya atau data kurang. */
  pct3: number | null;
  pct7: number | null;
  pct14: number | null;
  verdict: Verdict;
  detail: string;
  /** Hanya untuk sinyal BUY yang sudah selesai. */
  rMultiple: number | null;
  exit: "stop" | "target" | "waktu habis" | null;
};

const d0Of = (e: JournalEntry) => Math.floor(e.createdAt / DAY_SECONDS) * DAY_SECONDS;
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export function evaluateEntry(e: JournalEntry, candles: Candle[], nowSec: number): Outcome {
  const d0 = d0Of(e);
  const byTime = new Map(candles.map((c) => [c.time, c]));
  const day = (n: number): Candle | undefined => {
    const c = byTime.get(d0 + n * DAY_SECONDS);
    return c && c.time + DAY_SECONDS <= nowSec ? c : undefined; // hanya candle yang sudah selesai
  };
  const pct = (n: number) => {
    const c = day(n);
    return c ? (c.close / e.price0 - 1) * 100 : null;
  };
  const base = { pct3: pct(3), pct7: pct(7), pct14: pct(14), rMultiple: null, exit: null } as const;
  const wait = (detail: string): Outcome => ({ ...base, verdict: "menunggu", detail });

  if (e.kind === "signal") {
    if (e.action === "BUY" && e.stop != null && e.stop < e.price0) {
      const risk = e.price0 - e.stop;
      const target = e.target2 ?? null;
      for (let n = 1; n <= BUY_MAX_DAYS; n++) {
        const c = day(n);
        if (!c)
          return wait(
            `Transaksi masih berjalan atau datanya belum lengkap (terpantau ${n - 1} hari).`,
          );
        if (c.low <= e.stop) {
          const exit = Math.min(e.stop, c.open);
          const r = (exit - e.price0) / risk;
          return {
            ...base,
            verdict: r > 0 ? "benar" : "salah",
            rMultiple: r,
            exit: "stop",
            detail: `Kena stop-loss di hari ke-${n}: ${r.toFixed(2)}R.`,
          };
        }
        if (target !== null && c.high >= target) {
          const exit = Math.max(target, c.open);
          const r = (exit - e.price0) / risk;
          return {
            ...base,
            verdict: r > 0 ? "benar" : "salah",
            rMultiple: r,
            exit: "target",
            detail: `Mencapai Target 2 di hari ke-${n}: ${r >= 0 ? "+" : ""}${r.toFixed(2)}R.`,
          };
        }
      }
      const last = day(BUY_MAX_DAYS);
      if (!last) return wait("Transaksi masih berjalan.");
      const r = (last.close - e.price0) / risk;
      return {
        ...base,
        verdict: r > 0 ? "benar" : "salah",
        rMultiple: r,
        exit: "waktu habis",
        detail: `Tidak kena stop atau target dalam ${BUY_MAX_DAYS} hari; ditutup di harga penutupan: ${r >= 0 ? "+" : ""}${r.toFixed(2)}R.`,
      };
    }
    if (e.action === "SELL") {
      if (base.pct7 === null) return wait("Menunggu penutupan hari ke-7.");
      return {
        ...base,
        verdict: base.pct7 < 0 ? "benar" : "salah",
        detail: `Setelah 7 hari harga ${fmtPct(base.pct7)}; sinyal SELL benar kalau harga turun.`,
      };
    }
    return {
      ...base,
      verdict: "tidak dinilai",
      detail: "Sinyal ini tidak dinilai (hanya perubahan harganya yang dicatat).",
    };
  }

  // ---- tebakan pribadi ----
  const h = Math.min(Math.max(Math.round(e.horizonDays ?? 7), 1), BUY_MAX_DAYS);
  const up = e.direction !== "turun";
  for (let n = 1; n <= h; n++) {
    const c = day(n);
    if (!c) return wait(`Menunggu hari ke-${n} dari ${h}.`);
    if (e.targetPrice != null && (up ? c.high >= e.targetPrice : c.low <= e.targetPrice)) {
      return { ...base, verdict: "benar", detail: `Target tebakan tersentuh di hari ke-${n}.` };
    }
  }
  const end = day(h);
  if (!end) return wait(`Menunggu hari ke-${h}.`);
  const p = (end.close / e.price0 - 1) * 100;
  const ok = up ? p > 0 : p < 0;
  return {
    ...base,
    verdict: ok ? "benar" : "salah",
    detail: `Setelah ${h} hari harga ${fmtPct(p)}; tebakanmu ${up ? "naik" : "turun"}.`,
  };
}

export type Tally = { n: number; wins: number; pending: number };
export type Summary = {
  buy: Tally & { avgR: number | null };
  sell: Tally;
  guess: Tally;
  guessHype: Tally;
  guessNoHype: Tally;
};

export function summarizeJournal(
  entries: JournalEntry[],
  outcomes: Record<string, Outcome | undefined>,
): Summary {
  const tally = (): Tally => ({ n: 0, wins: 0, pending: 0 });
  const buy = { ...tally(), avgR: null as number | null };
  const sell = tally();
  const guess = tally();
  const guessHype = tally();
  const guessNoHype = tally();
  const rs: number[] = [];
  const add = (t: Tally, o: Outcome) => {
    if (o.verdict === "menunggu") t.pending++;
    else if (o.verdict === "benar" || o.verdict === "salah") {
      t.n++;
      if (o.verdict === "benar") t.wins++;
    }
  };
  for (const e of entries) {
    const o = outcomes[e.id];
    if (!o) continue;
    if (e.kind === "signal" && e.action === "BUY") {
      add(buy, o);
      if (o.rMultiple !== null) rs.push(o.rMultiple);
    } else if (e.kind === "signal" && e.action === "SELL") add(sell, o);
    else if (e.kind === "guess") {
      add(guess, o);
      add(e.hype ? guessHype : guessNoHype, o);
    }
  }
  buy.avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  return { buy, sell, guess, guessHype, guessNoHype };
}

// ---------------------------------------------------------------------------
// Ekspor / impor (cadangan karena data hanya tersimpan di browser)
// ---------------------------------------------------------------------------

export function exportJournal(entries: JournalEntry[]): string {
  return JSON.stringify({ app: "rhcryptanalyzer-journal", version: 1, entries }, null, 2);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function sanitizeEntry(raw: unknown): JournalEntry | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 80) return null;
  if (!isNum(r.createdAt) || r.createdAt <= 0) return null;
  if (r.kind !== "signal" && r.kind !== "guess") return null;
  if (typeof r.pairId !== "string" || !/^[a-z0-9]+idr$/.test(r.pairId)) return null;
  if (!isNum(r.price0) || r.price0 <= 0) return null;
  const e: JournalEntry = {
    id: r.id,
    createdAt: Math.floor(r.createdAt),
    kind: r.kind,
    pairId: r.pairId,
    price0: r.price0,
  };
  if (r.kind === "signal") {
    if (r.strategy === "trend" || r.strategy === "contrarian") e.strategy = r.strategy;
    if (r.action === "BUY" || r.action === "SELL" || r.action === "HOLD" || r.action === "NA")
      e.action = r.action;
    for (const k of ["stop", "target1", "target2"] as const) {
      const v = r[k];
      e[k] = isNum(v) && v > 0 ? v : null;
    }
  } else {
    e.direction = r.direction === "turun" ? "turun" : "naik";
    e.targetPrice = isNum(r.targetPrice) && r.targetPrice > 0 ? r.targetPrice : null;
    e.horizonDays = isNum(r.horizonDays)
      ? Math.min(Math.max(Math.round(r.horizonDays), 1), BUY_MAX_DAYS)
      : 7;
  }
  if (typeof r.hype === "boolean") e.hype = r.hype;
  if (typeof r.source === "string") e.source = r.source.slice(0, 40);
  if (typeof r.note === "string") e.note = r.note.slice(0, 500);
  return e;
}

export function parseJournal(text: string): {
  entries: JournalEntry[];
  skipped: number;
  error: string | null;
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { entries: [], skipped: 0, error: "Teks bukan JSON yang valid." };
  }
  const list = Array.isArray(data) ? data : (data as { entries?: unknown })?.entries;
  if (!Array.isArray(list))
    return {
      entries: [],
      skipped: 0,
      error: "Format jurnal tidak dikenali (tidak ada daftar entries).",
    };
  const seen = new Set<string>();
  const entries: JournalEntry[] = [];
  let skipped = 0;
  for (const raw of list.slice(0, JOURNAL_MAX_ENTRIES)) {
    const e = sanitizeEntry(raw);
    if (!e || seen.has(e.id)) {
      skipped++;
      continue;
    }
    seen.add(e.id);
    entries.push(e);
  }
  skipped += Math.max(0, list.length - JOURNAL_MAX_ENTRIES);
  return { entries, skipped, error: null };
}
