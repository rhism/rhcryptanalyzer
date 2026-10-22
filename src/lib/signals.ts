import { formatIdr } from "./format";
import type { MarketAnalysis } from "./indicators";

/**
 * Mesin sinyal berbasis kode (tanpa AI). Menerapkan aturan strategi yang SAMA dengan pedoman
 * yang selama ini dijalankan lewat prompt, tetapi hasilnya pasti (data sama = sinyal sama),
 * sehingga bisa diuji ulang di data lama (backtest).
 *
 * Aturan inti:
 *  - TREND  : BUY  = MA7 > MA25 DAN harga di atas keduanya. SELL = kebalikannya. Selain itu HOLD.
 *  - CONTRARIAN: BUY = RSI14 <= 30 (jenuh jual). SELL = RSI14 >= 70 (jenuh beli). Selain itu HOLD.
 * Lalu ada saringan risiko:
 *  - BUY tanpa stop-loss yang bisa dihitung (data ATR kurang) dibatalkan menjadi HOLD.
 *  - BUY dibatalkan menjadi HOLD kalau ruang naik ke resistance terdekat < minRoomToResistanceR.
 *  - Stablecoin tidak dianalisis (NA).
 * Spot Indodax tidak bisa short: SELL berarti "keluar / jangan masuk", bukan "buka posisi jual".
 */

export type Strategy = "trend" | "contrarian";
export type SignalAction = "BUY" | "HOLD" | "SELL" | "NA";

export const SIGNAL_PARAMS = {
  /** Contrarian: batas RSI jenuh jual / jenuh beli. */
  rsiBuyMax: 30,
  rsiSellMin: 70,
  /** BUY dibatalkan kalau jarak ke resistance (dalam kelipatan R) kurang dari ini. */
  minRoomToResistanceR: 1,
} as const;

export type Check = { label: string; ok: boolean | null };

/** Satu syarat aturan strategi: ok = terpenuhi / belum / null (data belum cukup), plus angka pendukungnya. */
export type Condition = { label: string; ok: boolean | null; detail: string };
export type Conditions = { buy: Condition[]; sell: Condition[] };
const NO_CONDITIONS: Conditions = { buy: [], sell: [] };

export type Guidance = { notOwned: string; owned: string };
const NO_GUIDANCE: Guidance = { notOwned: "", owned: "" };

export type Signal = {
  action: SignalAction;
  strategy: Strategy;
  headline: string;
  /** Hasil tiap aturan dalam bahasa sederhana. */
  reasons: string[];
  /** Konfirmasi pendukung (tidak mengubah keputusan; hanya info kekuatan sinyal). */
  checks: Check[];
  /** Jumlah konfirmasi yang terpenuhi / total. */
  passed: number;
  total: number;
  /** Terisi kalau aturan strategi memberi BUY tapi saringan risiko membatalkannya. */
  blockedBy: string | null;
  /** Syarat BUY dan SELL beserta status tiap syarat, supaya terlihat kenapa sinyalnya HOLD. */
  conditions: Conditions;
  /** Arti sinyal dalam bahasa sehari-hari untuk orang yang BELUM dan yang SUDAH punya koinnya. */
  guidance: Guidance;
};

const STABLECOINS = new Set([
  "usdt",
  "usdc",
  "dai",
  "busd",
  "tusd",
  "fdusd",
  "usde",
  "usdd",
  "pyusd",
  "usds",
  "gusd",
  "usdp",
  "frax",
  "idrt",
  "xidr",
  "bidr",
]);
const GOLD_TOKENS = new Set(["paxg", "xaut"]);

function baseSymbol(pairId: string): string {
  const p = pairId.toLowerCase().replace("_", "");
  return p.endsWith("idr") ? p.slice(0, -3) : p.endsWith("usdt") ? p.slice(0, -4) : p;
}
export function isStablecoin(pairId: string): boolean {
  return STABLECOINS.has(baseSymbol(pairId));
}
export function isGoldToken(pairId: string): boolean {
  return GOLD_TOKENS.has(baseSymbol(pairId));
}

const f = (n: number) => formatIdr(n);
const finalize = (
  action: SignalAction,
  strategy: Strategy,
  headline: string,
  reasons: string[],
  checks: Check[],
  blockedBy: string | null,
  conditions: Conditions = NO_CONDITIONS,
  guidance: Guidance = NO_GUIDANCE,
): Signal => ({
  action,
  strategy,
  headline,
  reasons,
  checks,
  passed: checks.filter((c) => c.ok === true).length,
  total: checks.length,
  blockedBy,
  conditions,
  guidance,
});

function buildGuidance(
  action: "BUY" | "HOLD" | "SELL",
  blocked: boolean,
  dataMissing: boolean,
  a: MarketAnalysis,
): Guidance {
  const stop = a.plan ? ` Stop-loss acuan ${f(a.plan.stopLoss)}.` : "";
  if (dataMissing) {
    return {
      notOwned: "TUNGGU: data belum cukup untuk memberi sinyal, jadi jangan masuk dulu.",
      owned: "TAHAN dengan hati-hati: data belum cukup untuk menilai.",
    };
  }
  if (action === "BUY") {
    return {
      notOwned: `BELI: syarat masuk terpenuhi.${stop} Ukuran posisi ada di bawah.`,
      owned: `TAHAN: syarat beli masih terpenuhi. Jangan menambah di luar rencana.${stop}`,
    };
  }
  if (action === "SELL") {
    return {
      notOwned: "JANGAN BELI: sinyal menunjukkan tekanan turun.",
      owned:
        "PERTIMBANGKAN JUAL: sinyal menunjukkan tekanan turun. Kalau tetap menahan, tetapkan stop-loss.",
    };
  }
  return blocked
    ? {
        notOwned: "TUNGGU: ada sinyal beli, tapi ditunda saringan risiko. Jangan masuk dulu.",
        owned: `TAHAN: belum ada sinyal jual.${stop}`,
      }
    : {
        notOwned: "TUNGGU: belum ada sinyal beli. Jangan masuk dulu.",
        owned: `TAHAN: belum ada sinyal jual.${stop}`,
      };
}

function buildConditions(a: MarketAnalysis, strategy: Strategy): Conditions {
  const price = a.price;
  if (strategy === "trend") {
    const have = a.ma7 !== null && a.ma25 !== null && price !== null;
    const miss = "data belum cukup (butuh minimal 25 harga)";
    const mk = (
      label: string,
      ok: (m7: number, m25: number, p: number) => boolean,
      det: (m7: number, m25: number, p: number) => string,
    ): Condition => ({
      label,
      ok: have ? ok(a.ma7 as number, a.ma25 as number, price as number) : null,
      detail: have ? det(a.ma7 as number, a.ma25 as number, price as number) : miss,
    });
    return {
      buy: [
        mk(
          "Rata-rata 7 hari di atas rata-rata 25 hari",
          (m7, m25) => m7 > m25,
          (m7, m25) => `${f(m7)} vs ${f(m25)}`,
        ),
        mk(
          "Harga di atas rata-rata 7 hari",
          (m7, _m25, p) => p > m7,
          (m7, _m25, p) => `${f(p)} vs ${f(m7)}`,
        ),
        mk(
          "Harga di atas rata-rata 25 hari",
          (_m7, m25, p) => p > m25,
          (_m7, m25, p) => `${f(p)} vs ${f(m25)}`,
        ),
      ],
      sell: [
        mk(
          "Rata-rata 7 hari di bawah rata-rata 25 hari",
          (m7, m25) => m7 < m25,
          (m7, m25) => `${f(m7)} vs ${f(m25)}`,
        ),
        mk(
          "Harga di bawah rata-rata 7 hari",
          (m7, _m25, p) => p < m7,
          (m7, _m25, p) => `${f(p)} vs ${f(m7)}`,
        ),
        mk(
          "Harga di bawah rata-rata 25 hari",
          (_m7, m25, p) => p < m25,
          (_m7, m25, p) => `${f(p)} vs ${f(m25)}`,
        ),
      ],
    };
  }
  const r = a.rsi14;
  const miss = "data belum cukup (butuh minimal 15 harga)";
  return {
    buy: [
      {
        label: `RSI ${SIGNAL_PARAMS.rsiBuyMax} atau lebih rendah (jenuh jual)`,
        ok: r === null ? null : r <= SIGNAL_PARAMS.rsiBuyMax,
        detail:
          r === null
            ? miss
            : r <= SIGNAL_PARAMS.rsiBuyMax
              ? `RSI ${r.toFixed(1)}`
              : `RSI ${r.toFixed(1)}, masih ${(r - SIGNAL_PARAMS.rsiBuyMax).toFixed(1)} poin di atas batas`,
      },
    ],
    sell: [
      {
        label: `RSI ${SIGNAL_PARAMS.rsiSellMin} atau lebih tinggi (jenuh beli)`,
        ok: r === null ? null : r >= SIGNAL_PARAMS.rsiSellMin,
        detail:
          r === null
            ? miss
            : r >= SIGNAL_PARAMS.rsiSellMin
              ? `RSI ${r.toFixed(1)}`
              : `RSI ${r.toFixed(1)}, masih ${(SIGNAL_PARAMS.rsiSellMin - r).toFixed(1)} poin di bawah batas`,
      },
    ],
  };
}

export function computeSignal(a: MarketAnalysis, strategy: Strategy, pairId: string): Signal {
  if (isStablecoin(pairId)) {
    return finalize(
      "NA",
      strategy,
      "Stablecoin: harganya sengaja dipatok ke dolar atau rupiah, jadi analisis teknikal tidak berarti.",
      [
        "Harga stablecoin hampir tidak bergerak, jadi tidak ada tren atau titik jenuh yang bisa dibaca.",
      ],
      [],
      null,
    );
  }

  const price = a.price;
  const reasons: string[] = [];
  const note = isGoldToken(pairId)
    ? "Catatan: harga token emas mengikuti harga emas dunia, bukan pergerakan kripto biasa."
    : null;

  // ---- 1) Aturan strategi ----
  let raw: "BUY" | "HOLD" | "SELL" = "HOLD";
  let dataMissing = false;
  if (strategy === "trend") {
    if (a.ma7 === null || a.ma25 === null || price === null) {
      dataMissing = true;
      reasons.push(
        "Data belum cukup untuk membaca tren (butuh minimal 25 harga untuk rata-rata 25 hari).",
      );
    } else if (a.ma7 > a.ma25 && price > a.ma7 && price > a.ma25) {
      raw = "BUY";
      reasons.push(
        `Rata-rata harga 7 hari (${f(a.ma7)}) lebih tinggi dari rata-rata 25 hari (${f(a.ma25)}), dan harga sekarang (${f(price)}) di atas keduanya: tren naik sedang berjalan.`,
      );
    } else if (a.ma7 < a.ma25 && price < a.ma7 && price < a.ma25) {
      raw = "SELL";
      reasons.push(
        `Rata-rata harga 7 hari (${f(a.ma7)}) lebih rendah dari rata-rata 25 hari (${f(a.ma25)}), dan harga sekarang (${f(price)}) di bawah keduanya: tren turun sedang berjalan.`,
      );
    } else {
      reasons.push(
        `Tren belum searah: syarat BUY (rata-rata 7 hari di atas rata-rata 25 hari, dan harga di atas keduanya) maupun SELL (kebalikannya) tidak terpenuhi. Rata-rata 7 hari ${f(a.ma7)}, rata-rata 25 hari ${f(a.ma25)}, harga ${f(price)}.`,
      );
    }
  } else {
    if (a.rsi14 === null) {
      dataMissing = true;
      reasons.push("Data belum cukup untuk menghitung RSI (butuh minimal 15 harga).");
    } else if (a.rsi14 <= SIGNAL_PARAMS.rsiBuyMax) {
      raw = "BUY";
      reasons.push(
        `RSI (ukuran seberapa cepat harga naik/turun) = ${a.rsi14.toFixed(1)}, di bawah ${SIGNAL_PARAMS.rsiBuyMax}: harga sudah turun terlalu jauh ("jenuh jual"), peluang memantul naik, tapi tidak dijamin.`,
      );
    } else if (a.rsi14 >= SIGNAL_PARAMS.rsiSellMin) {
      raw = "SELL";
      reasons.push(
        `RSI = ${a.rsi14.toFixed(1)}, di atas ${SIGNAL_PARAMS.rsiSellMin}: harga sudah naik terlalu jauh ("jenuh beli"), rawan terkoreksi turun.`,
      );
    } else {
      reasons.push(
        `RSI = ${a.rsi14.toFixed(1)}, di zona tengah (${SIGNAL_PARAMS.rsiBuyMax}-${SIGNAL_PARAMS.rsiSellMin}): tidak ada tanda jenuh beli maupun jenuh jual.`,
      );
    }
  }

  // ---- 2) Saringan risiko untuk BUY ----
  let action: "BUY" | "HOLD" | "SELL" = raw;
  let blockedBy: string | null = null;
  if (raw === "BUY") {
    if (a.plan === null) {
      action = "HOLD";
      blockedBy =
        "Aturan strategi memberi BUY, tapi stop-loss tidak bisa dihitung (data ATR kurang atau volatilitas terlalu besar), jadi dibatalkan: masuk tanpa batas rugi yang jelas tidak aman.";
    } else if (
      a.plan.resistanceInR !== null &&
      a.plan.resistanceInR < SIGNAL_PARAMS.minRoomToResistanceR &&
      a.levels.resistance !== null
    ) {
      action = "HOLD";
      blockedBy = `Aturan strategi memberi BUY, tapi ruang naik ke resistance terdekat (${f(a.levels.resistance)}) hanya ${a.plan.resistanceInR.toFixed(2)}R, kurang dari batas ${SIGNAL_PARAMS.minRoomToResistanceR}R: potensi untungnya kecil dibanding risiko ruginya, jadi ditunda.`;
    }
  }
  if (
    a.plan?.resistanceInR != null &&
    raw === "BUY" &&
    blockedBy === null &&
    a.levels.resistance !== null
  ) {
    reasons.push(
      `Ruang naik ke resistance terdekat (${f(a.levels.resistance)}) sekitar ${a.plan.resistanceInR.toFixed(2)}R: cukup lega.`,
    );
  } else if (raw === "BUY" && blockedBy === null && a.levels.resistance === null) {
    reasons.push(
      "Tidak ada resistance terdeteksi di atas harga sekarang (harga di area tertinggi periode ini).",
    );
  }
  if (note) reasons.push(note);

  // ---- 3) Konfirmasi pendukung (hanya info) ----
  const checks: Check[] = [];
  const hist = a.macd?.hist ?? null;
  const histPrev = a.macd?.histPrev ?? null;
  const vr = a.volumeRatio;
  const volOk = vr === null ? null : vr >= 1;
  const volLabel = "Volume candle terakhir minimal sama dengan rata-rata";
  if (action === "BUY" || (raw === "BUY" && action === "HOLD")) {
    if (strategy === "trend") {
      checks.push({ label: "Momentum (MACD) positif", ok: hist === null ? null : hist > 0 });
      checks.push({
        label: "RSI belum jenuh beli (< 70)",
        ok: a.rsi14 === null ? null : a.rsi14 < 70,
      });
    } else {
      checks.push({
        label: "Tekanan turun mulai mereda (MACD naik dibanding sebelumnya)",
        ok: hist === null || histPrev === null ? null : hist > histPrev,
      });
      checks.push({
        label: "Harga dekat support (selisih maksimal 1 ATR)",
        ok:
          a.levels.support === null || a.atr14 === null || price === null
            ? null
            : price - a.levels.support <= a.atr14,
      });
    }
    checks.push({ label: volLabel, ok: volOk });
    checks.push({
      label: `Ruang ke resistance minimal ${SIGNAL_PARAMS.minRoomToResistanceR}R`,
      ok:
        a.plan === null
          ? null
          : a.plan.resistanceInR === null
            ? true
            : a.plan.resistanceInR >= SIGNAL_PARAMS.minRoomToResistanceR,
    });
  } else if (action === "SELL") {
    if (strategy === "trend") {
      checks.push({ label: "Momentum (MACD) negatif", ok: hist === null ? null : hist < 0 });
      checks.push({
        label: "RSI belum jenuh jual (> 30)",
        ok: a.rsi14 === null ? null : a.rsi14 > 30,
      });
    } else {
      checks.push({
        label: "Tekanan naik mulai melemah (MACD turun dibanding sebelumnya)",
        ok: hist === null || histPrev === null ? null : hist < histPrev,
      });
      checks.push({
        label: "Harga dekat resistance (selisih maksimal 1 ATR)",
        ok:
          a.levels.resistance === null || a.atr14 === null || price === null
            ? null
            : a.levels.resistance - price <= a.atr14,
      });
    }
    checks.push({ label: volLabel, ok: volOk });
  }

  // ---- 4) Kalimat ringkas ----
  const headline = dataMissing
    ? "Data belum cukup untuk memberi sinyal, jadi tahan dulu."
    : action === "BUY"
      ? "Sinyal BUY: syarat masuk terpenuhi. Lihat stop-loss dan ukuran posisi di bawah."
      : action === "SELL"
        ? "Sinyal SELL: kalau kamu sedang memegang koin ini, pertimbangkan keluar. Kalau belum punya, jangan masuk dulu."
        : blockedBy !== null
          ? "BUY ditunda oleh saringan risiko: tunggu kondisi yang lebih menguntungkan."
          : "Belum ada sinyal jelas: tunggu, atau tahan kalau sudah punya.";

  const finalAction = dataMissing ? "HOLD" : action;
  return finalize(
    finalAction,
    strategy,
    headline,
    reasons,
    checks,
    blockedBy,
    buildConditions(a, strategy),
    buildGuidance(finalAction, blockedBy !== null, dataMissing, a),
  );
}
