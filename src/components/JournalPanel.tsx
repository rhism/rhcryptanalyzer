import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchIndodaxCandles, fetchIndodaxTicker } from "@/lib/indodax.functions";
import {
  evaluateEntry,
  exportJournal,
  JOURNAL_MAX_ENTRIES,
  parseJournal,
  summarizeJournal,
  validGuessTarget,
  type JournalEntry,
  type Outcome,
  type Tally,
} from "@/lib/journal";
import type { Candle } from "@/lib/indicators";
import { formatIdr } from "@/lib/format";
import { isStablecoin } from "@/lib/signals";
import type { PairInfo } from "@/lib/pairs";

const SOURCES = [
  "X (Twitter)",
  "Telegram",
  "YouTube",
  "Berita",
  "Feeling / analisis sendiri",
  "Lainnya",
];

const pctText = (n: number | null) =>
  n === null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}%`;
const when = (sec: number) =>
  new Date(sec * 1000).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const rate = (t: Tally) =>
  t.n === 0 ? "-" : `${Math.round((t.wins / t.n) * 100)}% (${t.wins}/${t.n})`;

function Stat({
  id,
  label,
  value,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--neon-magenta)]/30 bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-widest text-white/60">{label}</p>
      <p data-testid={id} className="mt-1 text-base font-bold text-white">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-white/45">{hint}</p>}
    </div>
  );
}

export function JournalPanel({
  entries,
  onChange,
  pairs,
  defaultPair,
  storageOk,
}: {
  entries: JournalEntry[];
  onChange: (next: JournalEntry[]) => void;
  pairs: PairInfo[];
  defaultPair: string;
  storageOk: boolean;
}) {
  const getCandles = useServerFn(fetchIndodaxCandles);
  const getTicker = useServerFn(fetchIndodaxTicker);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  // formulir tebakan
  const [pair, setPair] = useState(defaultPair);
  const [direction, setDirection] = useState<"naik" | "turun">("naik");
  const [horizon, setHorizon] = useState("7");
  const [targetText, setTargetText] = useState("");
  const [hype, setHype] = useState(false);
  const [source, setSource] = useState(SOURCES[0]);
  const [note, setNote] = useState("");

  const sorted = useMemo(() => [...entries].sort((a, b) => b.createdAt - a.createdAt), [entries]);
  const summary = useMemo(() => summarizeJournal(entries, outcomes), [entries, outcomes]);

  const refresh = async (list: JournalEntry[]) => {
    if (list.length === 0) {
      setOutcomes({});
      return;
    }
    setBusy(true);
    setErr(null);
    const now = Math.floor(Date.now() / 1000);
    const byPair = new Map<string, JournalEntry[]>();
    for (const e of list) {
      const arr = byPair.get(e.pairId) ?? [];
      arr.push(e);
      byPair.set(e.pairId, arr);
    }
    const next: Record<string, Outcome> = {};
    const errors: string[] = [];
    for (const [p, es] of byPair) {
      try {
        const from = Math.min(...es.map((e) => e.createdAt)) - 2 * 86400;
        const candles = (await getCandles({ data: { pair: p, from, to: now } })) as Candle[];
        for (const e of es) next[e.id] = evaluateEntry(e, candles, now);
      } catch (e) {
        errors.push(`${p.toUpperCase()}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setOutcomes(next);
    if (errors.length) setErr(`Sebagian hasil gagal diperbarui. ${errors.join(" | ")}`);
    setBusy(false);
  };

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      void refresh(entries);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addGuess = async () => {
    setErr(null);
    setMsg(null);
    if (entries.length >= JOURNAL_MAX_ENTRIES)
      return setErr(`Jurnal penuh (${JOURNAL_MAX_ENTRIES} entri). Ekspor dan hapus sebagian dulu.`);
    if (isStablecoin(pair))
      return setErr("Stablecoin tidak perlu ditebak: harganya sengaja dipatok.");
    const target =
      targetText.trim() === "" ? null : Number(targetText.replace(/\./g, "").replace(",", "."));
    if (target !== null && (!Number.isFinite(target) || target <= 0))
      return setErr("Harga target tidak valid.");
    setBusy(true);
    try {
      const t = (await getTicker({ data: { pair } })) as { last: string };
      const price0 = Number(t.last);
      if (!Number.isFinite(price0) || price0 <= 0) throw new Error("Harga sekarang tidak valid.");
      if (target !== null && validGuessTarget(direction, price0, target) === null) {
        setErr(
          direction === "naik"
            ? `Untuk tebakan naik, harga target harus di atas harga sekarang (${formatIdr(price0)}).`
            : `Untuk tebakan turun, harga target harus di bawah harga sekarang (${formatIdr(price0)}).`,
        );
        setBusy(false);
        return;
      }
      const createdAt = Math.floor(Date.now() / 1000);
      const entry: JournalEntry = {
        id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt,
        kind: "guess",
        pairId: pair,
        price0,
        direction,
        horizonDays: Number(horizon),
        targetPrice: target,
        hype,
        source,
        note: note.trim() || undefined,
      };
      onChange([entry, ...entries]);
      setMsg(
        `Tebakan dicatat: ${pair.toUpperCase()} ${direction} dalam ${horizon} hari, harga awal ${formatIdr(price0)}.`,
      );
      setNote("");
      setTargetText("");
      setHype(false);
    } catch (e) {
      setErr(`Gagal mencatat: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  };

  const download = () => {
    const blob = new Blob([exportJournal(entries)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jurnal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = () => {
    setErr(null);
    const r = parseJournal(importText);
    if (r.error) return setErr(r.error);
    const have = new Set(entries.map((e) => e.id));
    const fresh = r.entries.filter((e) => !have.has(e.id));
    const merged = [...entries, ...fresh].slice(0, JOURNAL_MAX_ENTRIES);
    onChange(merged);
    setImportText("");
    setMsg(
      `${fresh.length} entri baru diimpor, ${r.skipped + (r.entries.length - fresh.length)} dilewati (rusak atau sudah ada).`,
    );
    void refresh(merged);
  };

  const label = (e: JournalEntry) =>
    e.kind === "signal"
      ? `Sinyal ${e.action}${e.strategy ? ` (${e.strategy === "trend" ? "Trend" : "Contrarian"})` : ""}`
      : `Tebakan ${e.direction} ${e.horizonDays ?? 7} hari${e.targetPrice ? ` → ${formatIdr(e.targetPrice)}` : ""}`;

  return (
    <section className="neon-card rounded-2xl p-5 sm:p-7" aria-label="Jurnal">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-neon-orange">
        Jurnal — bukti dari masa depan
      </h2>
      <p className="mb-4 text-sm text-white/70">
        Catat sinyal sistem dan tebakanmu sendiri SEKARANG, lalu lihat hasilnya dari harga yang
        terjadi sesudahnya. Hype dan catatan hanya bisa diisi saat mencatat dan tidak bisa diubah
        sesudahnya, supaya hasilnya tidak bias oleh hasil yang sudah diketahui. Perlu puluhan
        catatan selama beberapa bulan sebelum hasilnya berarti.
      </p>
      {!storageOk && (
        <div className="mb-4 rounded-lg border border-red-400/50 bg-red-500/10 p-3 text-sm text-red-100">
          Browser ini tidak mengizinkan penyimpanan lokal, jadi jurnal akan hilang saat halaman
          ditutup. Ekspor sebelum menutup halaman.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="journal-summary">
        <Stat id="jr-total" label="Jumlah catatan" value={String(entries.length)} />
        <Stat
          id="jr-buy"
          label="Sinyal BUY benar (bersih biaya)"
          value={rate(summary.buy)}
          hint={`${summary.buy.pending} menunggu · rata-rata ${summary.buy.avgR === null ? "-" : summary.buy.avgR.toFixed(2).replace(".", ",") + "R bersih"}`}
        />
        <Stat
          id="jr-sell"
          label="Sinyal SELL benar"
          value={rate(summary.sell)}
          hint={`${summary.sell.pending} menunggu`}
        />
        <Stat
          id="jr-guess"
          label="Tebakanmu benar"
          value={rate(summary.guess)}
          hint={`${summary.guess.pending} menunggu`}
        />
        <Stat id="jr-hype" label="Tebakan dengan hype" value={rate(summary.guessHype)} />
        <Stat id="jr-nohype" label="Tebakan tanpa hype" value={rate(summary.guessNoHype)} />
      </div>
      <p className="mb-3 text-xs text-white/60" data-testid="jr-note">
        Persen benar bukan keuntungan: sinyal bisa sering benar tapi tetap merugi setelah biaya.
        Sinyal BUY dinilai dari R bersih (perkiraan biaya 0,2% + slippage 0,1% per sisi), jadi
        perhatikan juga rata-rata R-nya, bukan hanya persen benarnya.
      </p>
      {summary.guess.n + summary.buy.n < 30 && (
        <p className="mb-4 text-xs text-yellow-200" data-testid="jr-small">
          Baru {summary.guess.n + summary.buy.n} catatan yang sudah dinilai. Di bawah sekitar 30,
          angka di atas bisa kebetulan semata.
        </p>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neon-orange">
        Catat tebakanmu
      </h3>
      <div className="mb-5 grid grid-cols-1 gap-3 rounded-lg border border-white/15 bg-black/20 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
          Koin
          <select
            aria-label="Koin tebakan"
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white"
          >
            {(pairs.some((p) => p.id === pair)
              ? pairs
              : [{ id: pair, label: pair.toUpperCase() } as PairInfo, ...pairs]
            ).map((p) => (
              <option key={p.id} value={p.id} className="bg-[#1B1035]">
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
          Arah tebakan
          <div className="inline-flex rounded-md border border-[color:var(--neon-violet)]/60 bg-black/30 p-1">
            {(["naik", "turun"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={direction === d}
                onClick={() => setDirection(d)}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold normal-case tracking-normal ${direction === d ? "bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] text-white" : "text-white/70"}`}
              >
                Akan {d}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
          Dinilai setelah
          <select
            aria-label="Horizon tebakan"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
            className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white"
          >
            {["1", "3", "7", "14", "30"].map((h) => (
              <option key={h} value={h} className="bg-[#1B1035]">
                {h} hari
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
          Harga target (opsional)
          <input
            aria-label="Harga target"
            inputMode="decimal"
            value={targetText}
            onChange={(e) => setTargetText(e.target.value.replace(/[^\d.,]/g, "").slice(0, 14))}
            placeholder="naik: di atas harga sekarang"
            className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-white/35"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-white/85">
          <input
            type="checkbox"
            aria-label="Ada hype"
            checked={hype}
            onChange={(e) => setHype(e.target.checked)}
          />
          Ada hype/narasi di sosial media
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60">
          Sumber
          <select
            aria-label="Sumber tebakan"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s} className="bg-[#1B1035]">
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-white/60 sm:col-span-2">
          Catatan (alasan, narasi yang kamu lihat)
          <input
            aria-label="Catatan"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="mis. dev bikin drama, ramai di X"
            className="rounded-md border border-[color:var(--neon-magenta)]/60 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-white/35"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={addGuess}
            disabled={busy}
            className="rounded-lg bg-gradient-to-r from-[#FF4D9D] to-[#FF8A3D] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            Catat tebakan
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void refresh(entries)}
          disabled={busy}
          className="rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Perbarui hasil
        </button>
        <button
          type="button"
          onClick={download}
          disabled={entries.length === 0}
          className="rounded-lg border border-white/30 px-4 py-2 text-sm text-white/85 disabled:opacity-40"
        >
          Ekspor cadangan (.json)
        </button>
        <span data-testid="jr-status" className="text-xs text-white/60">
          {busy ? "Memproses…" : ""}
        </span>
      </div>
      {msg && (
        <p data-testid="jr-msg" className="mb-3 text-xs text-emerald-200">
          {msg}
        </p>
      )}
      {err && (
        <p
          data-testid="jr-err"
          className="mb-3 rounded-lg border border-red-400/50 bg-red-500/10 p-2 text-xs text-red-100"
        >
          {err}
        </p>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neon-orange">
        Catatan ({entries.length})
      </h3>
      {entries.length === 0 ? (
        <p className="mb-5 text-sm text-white/60">
          Belum ada catatan. Catat sinyal dari tab Analisis Koin, atau catat tebakanmu di atas.
        </p>
      ) : (
        <div className="mb-5 overflow-x-auto">
          <table data-testid="jr-table" className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-white/60">
              <tr>
                <th className="py-1 pr-3">Dicatat</th>
                <th className="py-1 pr-3">Koin</th>
                <th className="py-1 pr-3">Jenis</th>
                <th className="py-1 pr-3">Harga awal</th>
                <th className="py-1 pr-3">+3h</th>
                <th className="py-1 pr-3">+7h</th>
                <th className="py-1 pr-3">+14h</th>
                <th className="py-1 pr-3">Hasil</th>
                <th className="py-1 pr-3">Hype</th>
                <th className="py-1">Catatan</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const o = outcomes[e.id];
                return (
                  <tr
                    key={e.id}
                    className="border-t border-white/10"
                    data-testid="jr-row"
                    data-entry-id={e.id}
                  >
                    <td className="py-1 pr-3">{when(e.createdAt)}</td>
                    <td className="py-1 pr-3">{e.pairId.replace("idr", "").toUpperCase()}</td>
                    <td className="py-1 pr-3">{label(e)}</td>
                    <td className="py-1 pr-3">{formatIdr(e.price0)}</td>
                    <td className="py-1 pr-3">{pctText(o?.pct3 ?? null)}</td>
                    <td className="py-1 pr-3">{pctText(o?.pct7 ?? null)}</td>
                    <td className="py-1 pr-3">{pctText(o?.pct14 ?? null)}</td>
                    <td
                      className={`py-1 pr-3 font-semibold ${o?.verdict === "benar" ? "text-emerald-300" : o?.verdict === "salah" ? "text-red-300" : "text-white/70"}`}
                      title={o?.detail ?? ""}
                      data-testid="jr-verdict"
                    >
                      {o ? o.verdict : "perlu diperbarui"}
                    </td>
                    <td className="py-1 pr-3">{e.hype ? "ya" : "-"}</td>
                    <td className="max-w-[220px] truncate py-1 pr-3" title={e.note ?? ""}>
                      {e.note ?? ""}
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        aria-label={`Hapus catatan ${e.id}`}
                        onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
                        className="text-white/50 underline"
                      >
                        hapus
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-lg border border-white/15 bg-black/20 p-3 text-sm text-white/80">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-neon-orange">
          Impor cadangan
        </summary>
        <p className="mt-2 text-xs text-white/60">
          Tempel isi file jurnal (.json) yang pernah kamu ekspor. Catatan yang sudah ada tidak
          digandakan.
        </p>
        <textarea
          aria-label="Teks impor"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={4}
          className="mt-2 w-full rounded-md border border-white/20 bg-black/30 p-2 text-xs text-white"
        />
        <button
          type="button"
          onClick={doImport}
          disabled={importText.trim() === ""}
          className="mt-2 rounded-lg border border-white/30 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Impor
        </button>
      </details>
      <p className="mt-4 text-[11px] text-white/45">
        Data jurnal tersimpan hanya di browser ini. Menghapus data browser akan menghapus jurnal,
        jadi ekspor secara berkala. Penilaian memakai candle harian yang sudah selesai; hasil BUY
        memakai stop-loss dan Target 2 dari sinyal (maksimal 30 hari), tanpa biaya.
      </p>
    </section>
  );
}
