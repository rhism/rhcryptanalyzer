import type { Strategy } from "./signals";

/**
 * Bukti historis dari uji ulang (backtest) aturan strategi. Angka di sini adalah HASIL UJI TERTULIS,
 * bukan dihitung ulang oleh aplikasi. Perbarui bersama tanggal `EVIDENCE_AS_OF` setiap kali uji diulang.
 */
export const EVIDENCE_AS_OF = "15 Oktober 2026";

export type Evidence = {
  level: "info" | "warning";
  title: string;
  lines: string[];
  footnote: string;
};

const FOOTNOTE = `Sumber: uji ulang aturan ini pada data harian Indodax (BTC, ETH, XRP, SOL, DOGE, BNB, ADA, LTC; sejak 2017 sampai ${EVIDENCE_AS_OF}) dengan biaya 0,2% dan selisih harga 0,1% per sisi. Hanya koin besar yang bertahan sampai sekarang yang diuji, jadi hasilnya cenderung lebih bagus dari kenyataan. Hasil masa lalu tidak menjamin hasil ke depan.`;

export function evidenceFor(strategy: Strategy): Evidence {
  if (strategy === "contrarian") {
    return {
      level: "warning",
      title: "Strategi Contrarian belum terbukti untung",
      lines: [
        "Pada uji 9,8 tahun: 336 transaksi, menang 28%, rata-rata -0,07R per transaksi setelah biaya, dan positif hanya di 3 dari 8 koin. (1R = rugi sebesar risiko awal, yaitu jarak harga masuk ke stop-loss.)",
        "Rentang kepercayaannya mencakup nol, artinya tidak ada bukti keunggulan. Jangan dijadikan satu-satunya dasar keputusan.",
      ],
      footnote: FOOTNOTE,
    };
  }
  return {
    level: "info",
    title: "Bukti historis strategi Trend Following",
    lines: [
      "Pada uji 9,8 tahun: 793 transaksi, menang 36%, rata-rata +0,33R per transaksi setelah biaya (1R = rugi sebesar risiko awal). Untungnya datang dari transaksi menang yang besar, bukan dari seringnya menang.",
      "Melemah belakangan: sampai 2022 rata-rata +0,45R, sejak 2023 +0,16R (belum bisa dibedakan dari nol), dan 2026 -0,49R dari 65 transaksi.",
      "Rentetan kalah terpanjang di uji ini 13 transaksi, dan modal pernah berada di bawah puncaknya selama beberapa tahun.",
    ],
    footnote: FOOTNOTE,
  };
}

/** Catatan cara keluar untuk kartu "Level & rencana risiko". */
export function exitNote(strategy: Strategy): string {
  if (strategy === "contrarian") {
    return "Belum ada bukti uji untuk cara keluar strategi Contrarian, jadi anggap target dan stop-loss ini sekadar patokan risiko.";
  }
  return "Target hanyalah patokan. Pada uji historis strategi Trend, keluar penuh di Target 1 hanya menghasilkan +0,11R per transaksi (tidak berbeda nyata dari nol) dan di Target 2 +0,33R. Membiarkan untung berjalan (keluar hanya saat stop-loss kena atau sinyal berubah SELL) memberi rata-rata lebih tinggi, tetapi sekitar 65% totalnya datang dari 10 transaksi besar dan hasil 2026 tetap negatif. Salah satu cara yang bisa dipertimbangkan: menaikkan stop-loss mengikuti harga (trailing stop), yang belum teruji tuntas.";
}
