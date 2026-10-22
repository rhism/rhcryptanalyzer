import { useState } from "react";
import { formatIdr } from "@/lib/format";
import { SIZING_PARAMS, type Sizing } from "@/lib/sizing";
import type { Signal, SignalAction } from "@/lib/signals";
import { evidenceFor } from "@/lib/evidence";

const BADGE: Record<SignalAction, { box: string; label: string }> = {
  BUY: { box: "bg-emerald-500/20 border-emerald-400 text-emerald-300", label: "BUY" },
  SELL: { box: "bg-red-500/20 border-red-400 text-red-300", label: "SELL" },
  HOLD: { box: "bg-yellow-500/20 border-yellow-400 text-yellow-200", label: "HOLD" },
  NA: { box: "bg-slate-500/20 border-slate-400 text-slate-300", label: "N/A" },
};

function unitsText(n: number): string {
  return new Intl.NumberFormat("id-ID", { maximumSignificantDigits: 6 }).format(n);
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[color:var(--neon-magenta)]/30 bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/60">{label}</p>
      <p className={`mt-1 text-base font-bold ${accent ? "text-neon-pink" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

export function SignalCard({
  signal,
  strategyLabel,
  sizing,
  capitalText,
  onCapitalChange,
  riskText,
  onRiskChange,
  onLog,
  logged,
}: {
  signal: Signal;
  strategyLabel: string;
  sizing: Sizing;
  capitalText: string;
  onCapitalChange: (digitsOnly: string) => void;
  riskText: string;
  onRiskChange: (v: string) => void;
  onLog?: (opts: { hype: boolean; note: string }) => void;
  logged?: boolean;
}) {
  const [logHype, setLogHype] = useState(false);
  const [logNote, setLogNote] = useState("");
  const badge = BADGE[signal.action];
  const evidence = signal.action === "NA" ? null : evidenceFor(signal.strategy);
  const capitalShown = capitalText
    ? new Intl.NumberFormat("id-ID").format(Number(capitalText))
    : "";

  return (
    <section className="neon-card mb-6 rounded-2xl p-5 sm:p-7" aria-label="Sinyal sistem">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-neon-orange">
        Sinyal sistem — dihitung kode · strategi {strategyLabel}
      </h2>

      <div className="mb-4 mt-3 flex flex-wrap items-center gap-3">
        <div
          data-testid="signal-action"
          className={`rounded-lg border-2 px-5 py-2 text-2xl font-extrabold tracking-widest ${badge.box}`}
        >
          {badge.label}
        </div>
        {signal.total > 0 && (
          <span className="rounded-full border border-white/25 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white/80">
            Konfirmasi pendukung: {signal.passed}/{signal.total}
          </span>
        )}
      </div>

      <p className="mb-4 text-base font-medium text-white">{signal.headline}</p>

      {signal.guidance.notOwned && (
        <div data-testid="guidance" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ["Kalau kamu BELUM punya koin ini", signal.guidance.notOwned],
              ["Kalau kamu SUDAH punya koin ini", signal.guidance.owned],
            ] as const
          ).map(([title, text]) => (
            <div
              key={title}
              className="rounded-lg border border-[color:var(--neon-violet)]/50 bg-black/25 p-3"
            >
              <p className="text-[11px] uppercase tracking-widest text-white/60">{title}</p>
              <p className="mt-1 text-sm font-semibold text-white">{text}</p>
            </div>
          ))}
        </div>
      )}

      {onLog && signal.action !== "NA" && (
        <div
          data-testid="log-signal"
          className="mb-4 rounded-lg border border-white/15 bg-black/20 p-3"
        >
          <p className="mb-2 text-[11px] uppercase tracking-widest text-white/60">Jurnal</p>
          {logged ? (
            <p className="text-sm text-emerald-200">
              Tercatat di tab Jurnal. Hasilnya akan dinilai dari harga setelah ini.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-white/85">
                <input
                  type="checkbox"
                  aria-label="Hype untuk sinyal"
                  checked={logHype}
                  onChange={(e) => setLogHype(e.target.checked)}
                />
                Ada hype/narasi di sosial media untuk koin ini
              </label>
              <input
                aria-label="Catatan sinyal"
                value={logNote}
                onChange={(e) => setLogNote(e.target.value.slice(0, 500))}
                placeholder="Catatan (opsional)"
                className="rounded-md border border-white/20 bg-black/30 px-3 py-1.5 text-sm text-white placeholder:text-white/35"
              />
              <button
                type="button"
                onClick={() => onLog({ hype: logHype, note: logNote })}
                className="self-start rounded-lg border border-white/30 px-4 py-1.5 text-sm font-semibold text-white"
              >
                Catat sinyal ini ke jurnal
              </button>
            </div>
          )}
        </div>
      )}

      {evidence && evidence.level === "warning" && (
        <div
          data-testid="evidence"
          className="mb-4 rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100"
        >
          <p className="font-semibold">{evidence.title}</p>
          {evidence.lines.map((l) => (
            <p key={l} className="mt-1">
              {l}
            </p>
          ))}
          <p className="mt-2 text-[11px] text-red-100/70">{evidence.footnote}</p>
        </div>
      )}

      {signal.blockedBy && (
        <div className="mb-4 rounded-lg border border-yellow-400/50 bg-yellow-500/10 p-3 text-sm text-yellow-100">
          {signal.blockedBy}
        </div>
      )}

      <ul className="mb-4 list-disc space-y-1 pl-5 text-sm leading-relaxed text-white/85">
        {signal.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      {signal.conditions.buy.length > 0 && (
        <div data-testid="conditions" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ["Syarat BUY (semua harus ✓)", signal.conditions.buy],
              ["Syarat SELL (semua harus ✓)", signal.conditions.sell],
            ] as const
          ).map(([title, list]) => (
            <div key={title} className="rounded-lg border border-white/15 bg-black/20 p-3">
              <p className="mb-2 text-[11px] uppercase tracking-widest text-white/60">{title}</p>
              <ul className="space-y-1.5 text-sm">
                {list.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className={
                        c.ok === true
                          ? "text-emerald-300"
                          : c.ok === false
                            ? "text-red-300"
                            : "text-white/40"
                      }
                    >
                      {c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}
                    </span>
                    <span className="text-white/85">
                      {c.label}
                      <span className="block text-xs text-white/55">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {signal.checks.length > 0 && (
        <div className="mb-4 rounded-lg border border-[color:var(--neon-violet)]/40 bg-black/20 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-widest text-white/60">
            Konfirmasi pendukung (tidak mengubah keputusan, hanya menunjukkan kekuatan sinyal)
          </p>
          <ul className="space-y-1 text-sm">
            {signal.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={
                    c.ok === true
                      ? "text-emerald-300"
                      : c.ok === false
                        ? "text-red-300"
                        : "text-white/40"
                  }
                >
                  {c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}
                </span>
                <span className="text-white/80">
                  {c.label}
                  {c.ok === null ? " (data belum cukup)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {signal.action === "BUY" ? (
        <div
          className="rounded-lg border border-emerald-400/30 bg-emerald-500/5 p-4"
          data-testid="sizing"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-300">
            Ukuran posisi (berdasarkan risiko)
          </p>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
              Modal (Rp)
              <input
                aria-label="Modal"
                inputMode="numeric"
                value={capitalShown}
                onChange={(e) => onCapitalChange(e.target.value.replace(/\D/g, "").slice(0, 15))}
                placeholder="mis. 10.000.000"
                className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-white/35 outline-none focus:border-[color:var(--neon-pink)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
              Risiko per transaksi (% dari modal)
              <input
                aria-label="Risiko per transaksi"
                inputMode="decimal"
                value={riskText}
                onChange={(e) => onRiskChange(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
                placeholder={String(SIZING_PARAMS.defaultRiskPct)}
                className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-white/35 outline-none focus:border-[color:var(--neon-pink)]"
              />
            </label>
          </div>

          <p data-testid="risk-hint" className="mb-3 text-[11px] text-white/55">
            Risiko 1% artinya: kalau stop-loss kena, rugimu sekitar 1% dari TOTAL modal (modal Rp
            10.000.000 → rugi sekitar Rp 100.000). Ukuran belinya dihitung mundur dari angka itu.
          </p>

          {!sizing.ok ? (
            <p className="text-sm text-white/70">{sizing.reason}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Mini label="Beli sekitar" value={formatIdr(sizing.positionIdr)} accent />
                <Mini label="Jumlah koin" value={unitsText(sizing.units)} />
                <Mini
                  label="Porsi dari modal"
                  value={`${sizing.positionPctOfCapital.toFixed(1)}%`}
                />
                <Mini label="Rugi jika stop-loss kena*" value={formatIdr(sizing.lossAtStopIdr)} />
                <Mini
                  label="Biaya beli + jual"
                  value={sizing.feeRoundTripIdr !== null ? formatIdr(sizing.feeRoundTripIdr) : "-"}
                />
                <Mini label="Risiko yang dipilih" value={formatIdr(sizing.plannedRiskIdr)} />
              </div>
              <p className="mt-2 text-[11px] text-white/50">
                *Sudah termasuk biaya beli dan jual, belum termasuk selisih harga saat eksekusi
                (slippage), yang bisa lebih besar di koin sepi.
              </p>
              {sizing.notes.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-yellow-200">
                  {sizing.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : (
        signal.action !== "NA" && (
          <p className="text-xs text-white/55">
            Ukuran posisi hanya dihitung kalau ada sinyal BUY.
          </p>
        )
      )}

      {evidence && evidence.level === "info" && (
        <details
          data-testid="evidence"
          className="mt-4 rounded-lg border border-white/15 bg-black/20 p-3 text-sm text-white/85"
        >
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-neon-orange">
            Bukti historis strategi ini (hasil uji 9,8 tahun)
          </summary>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {evidence.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-white/50">{evidence.footnote}</p>
        </details>
      )}

      <p className="mt-4 text-[11px] text-white/45">
        Anggap sinyal ini sebagai alat bantu berpikir, bukan jaminan untung. Bukan saran finansial.
      </p>
    </section>
  );
}
