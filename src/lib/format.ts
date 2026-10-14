/**
 * Format Rupiah yang aman untuk semua harga koin di Indodax.
 * Koin murah (di bawah Rp 1.000) butuh desimal supaya tidak tampil "Rp 0".
 */
export function formatIdr(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const maximumFractionDigits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 8;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits,
  }).format(n);
}

/** Ringkas untuk angka besar: Rp 3,2 M (miliar), Rp 850 jt (juta), Rp 1,5 T (triliun). */
export function compactIdr(n: number): string {
  if (!Number.isFinite(n)) return "-";
  const fmt = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(v);
  const abs = Math.abs(n);
  if (abs >= 1e12) return `Rp ${fmt(n / 1e12)} T`;
  if (abs >= 1e9) return `Rp ${fmt(n / 1e9)} M`;
  if (abs >= 1e6) return `Rp ${fmt(n / 1e6)} jt`;
  return formatIdr(n);
}
