import { compactIdr, formatIdr } from "./format";
import type { TradePlan } from "./indicators";

/**
 * Ukuran posisi berdasarkan risiko: "berapa yang boleh kubeli supaya kalau stop-loss kena,
 * ruginya sesuai persen risiko yang kupilih".
 *
 *  unit = (modal × risiko%) / jarak entry ke stop-loss
 *
 * Batas tambahan (spot Indodax tidak ada leverage):
 *  - posisi tidak boleh melebihi modal;
 *  - posisi tidak boleh melebihi liquidityCapPct dari volume 24 jam, supaya order tidak menggeser harga.
 */
export const SIZING_PARAMS = {
  liquidityCapPct: 1,
  defaultRiskPct: 1,
  /** Pedoman umum: risiko per transaksi 1–2% dari modal. Di atas ini diberi peringatan. */
  aggressiveRiskPct: 2,
  maxRiskPct: 10,
} as const;

export type SizingInput = {
  capital: number;
  riskPct: number;
  plan: TradePlan | null;
  volIdr: number | null;
  takerFeePct: number | null;
  minOrderIdr: number | null;
};

export type Sizing =
  | { ok: false; reason: string }
  | {
      ok: true;
      units: number;
      positionIdr: number;
      positionPctOfCapital: number;
      /** Rugi yang kamu pilih (modal × risiko%). */
      plannedRiskIdr: number;
      /** Perkiraan rugi kalau stop-loss kena, sudah termasuk biaya beli + jual (belum termasuk slippage). */
      lossAtStopIdr: number;
      feeRoundTripIdr: number | null;
      capped: "capital" | "liquidity" | null;
      notes: string[];
    };

export function computeSizing(i: SizingInput): Sizing {
  if (!Number.isFinite(i.capital) || i.capital <= 0)
    return { ok: false, reason: "Isi modal dulu untuk melihat ukuran posisi." };
  if (!Number.isFinite(i.riskPct) || i.riskPct <= 0 || i.riskPct > SIZING_PARAMS.maxRiskPct) {
    return {
      ok: false,
      reason: `Risiko per transaksi harus di antara 0 dan ${SIZING_PARAMS.maxRiskPct}%.`,
    };
  }
  if (i.plan === null)
    return {
      ok: false,
      reason: "Stop-loss belum bisa dihitung, jadi ukuran posisi juga belum bisa.",
    };

  const { entry, riskPerUnit } = i.plan;
  const plannedRiskIdr = (i.capital * i.riskPct) / 100;
  let positionIdr = (plannedRiskIdr / riskPerUnit) * entry;
  let capped: "capital" | "liquidity" | null = null;
  const notes: string[] = [];

  if (positionIdr > i.capital) {
    positionIdr = i.capital;
    capped = "capital";
  }
  if (i.volIdr !== null) {
    const liqCap = (i.volIdr * SIZING_PARAMS.liquidityCapPct) / 100;
    if (positionIdr > liqCap) {
      positionIdr = liqCap;
      capped = "liquidity";
    }
  }
  const units = positionIdr / entry;
  const feeRoundTripIdr = i.takerFeePct !== null ? positionIdr * (i.takerFeePct / 100) * 2 : null;
  const lossAtStopIdr = units * riskPerUnit + (feeRoundTripIdr ?? 0);

  if (capped === "capital") {
    notes.push(
      "Ukuran posisi dibatasi sebesar modalmu (spot tidak ada leverage), jadi risiko sebenarnya lebih kecil dari yang kamu pilih.",
    );
  } else if (capped === "liquidity") {
    notes.push(
      `Ukuran posisi dibatasi ${SIZING_PARAMS.liquidityCapPct}% dari volume 24 jam (${i.volIdr !== null ? compactIdr(i.volIdr) : "-"}) supaya order tidak menggeser harga koin yang sepi ini.`,
    );
  }
  if (i.minOrderIdr !== null && positionIdr < i.minOrderIdr) {
    notes.push(
      `Ukuran posisi di bawah order minimum Indodax untuk pair ini (${formatIdr(i.minOrderIdr)}).`,
    );
  }
  if (i.riskPct > SIZING_PARAMS.aggressiveRiskPct) {
    notes.push(
      `Risiko ${i.riskPct}% per transaksi tergolong agresif; umumnya trader memakai ${SIZING_PARAMS.defaultRiskPct}-${SIZING_PARAMS.aggressiveRiskPct}%.`,
    );
  }
  if (feeRoundTripIdr === null)
    notes.push("Biaya transaksi pair ini tidak diketahui, jadi belum dihitung.");

  return {
    ok: true,
    units,
    positionIdr,
    positionPctOfCapital: (positionIdr / i.capital) * 100,
    plannedRiskIdr,
    lossAtStopIdr,
    feeRoundTripIdr,
    capped,
    notes,
  };
}
