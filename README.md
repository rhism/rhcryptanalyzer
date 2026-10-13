# Crypto Insight Engine

Prompt buat Bolt.new / Lovable

Copy-paste semua teks di bawah ini persis apa adanya ke Bolt atau Lovable.

Buatkan web app React (single page, client-side only, TANPA backend server dan TANPA database) untuk analisis kripto personal saya. Ini untuk personal use, bukan produk publik.

Fungsi Utama

User bisa pilih pasangan koin dari dropdown (default: BNB/IDR). Sediakan minimal opsi: BTC/IDR, ETH/IDR, BNB/IDR, SOL/IDR.

Saat halaman dibuka atau tombol "Refresh Analysis" ditekan:

Fetch data ticker dari Indodax Public API: https://indodax.com/api/ticker/{pair} (contoh pair: bnbidr, huruf kecil, tanpa slash)

Fetch data candle harian 30 hari dari: https://indodax.com/tradingview/history?symbol={PAIR}&resolution=1D&from={unix_timestamp_30_hari_lalu}&to={unix_timestamp_sekarang} (contoh PAIR: BNBIDR, huruf besar)

Kalau fetch Indodax gagal karena CORS (cross-origin blocked), tampilkan pesan error yang jelas ke user: "Gagal ambil data, kemungkinan CORS diblokir Indodax. Perlu proxy server." Jangan bikin app crash, tampilkan state error yang rapi.

Dari data candle, hitung sendiri di client-side (JavaScript murni, jangan pakai library eksternal untuk ini):

RSI 14 hari

Simple Moving Average 7 hari (MA7)

Simple Moving Average 25 hari (MA25)

Kirim data ticker + indikator yang udah dihitung ke Gemini API (https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent) via POST request, dengan API key dari environment variable VITE_GEMINI_API_KEY. Minta Gemini balikin analisis dalam format JSON dengan struktur persis seperti ini (instruksikan Gemini untuk HANYA return JSON, tanpa markdown code fence, tanpa teks lain):

{  "kesimpulan": "ringkasan kondisi market 1-2 kalimat",  "rekomendasi": "BUY | HOLD | SELL",  "alasan": "penjelasan detail alasan rekomendasi berdasarkan data, minimal 3 kalimat",  "support": "level harga support kasar dalam Rupiah",  "resistance": "level harga resistance kasar dalam Rupiah",  "confidence": "LOW | MEDIUM | HIGH"}


Tampilkan hasil analisis dalam card yang rapi berisi:

Harga sekarang, high/low 24 jam (dari ticker)

Nilai RSI, MA7, MA25 (dari hasil hitungan sendiri)

Rekomendasi BUY/HOLD/SELL dengan warna berbeda (hijau untuk BUY, kuning untuk HOLD, merah untuk SELL)

Kesimpulan dan alasan detail dari Gemini

Level support & resistance

Badge confidence level

Timestamp kapan analisis terakhir dilakukan

Requirement Teknis

React + Vite, TypeScript kalau bisa

TIDAK ADA backend, TIDAK ADA database — semua logic (fetch, hitung indikator, panggil Gemini) jalan di client-side browser

State cukup pakai React useState/useEffect, tidak perlu persist data antar sesi (setiap buka halaman = fetch ulang)

Environment variable untuk API key: VITE_GEMINI_API_KEY (gunakan import.meta.env.VITE_GEMINI_API_KEY)

Responsive — harus enak dipakai di layar HP (mobile-first) maupun laptop/desktop

Tampilkan loading state yang jelas saat fetch data & saat nunggu response Gemini (proses ini bisa makan beberapa detik)

Tampilkan error state yang jelas dan informatif kalau salah satu API gagal (Indodax atau Gemini), termasuk kemungkinan CORS error dari Indodax

Tombol "Refresh Analysis" untuk trigger ulang seluruh proses kapan saja

Desain Visual

Gunakan tema neon-noir/synthwave dengan palet warna berikut:

Background gelap: #1B1035

Aksen ungu: #4A1E5C

Aksen magenta: #B03A6B

Aksen merah muda terang: #F04F6E

Aksen oranye: #F4A23C

Gunakan warna-warna ini untuk elemen dekoratif, border, dan aksen — tapi untuk indikator BUY/HOLD/SELL tetap gunakan hijau/kuning/merah standar biar jelas terbaca secara fungsional. Font modern, sans-serif, clean. Card dengan sedikit glow effect di border sesuai tema neon.

Yang TIDAK perlu dibuat

Jangan bikin sistem login/auth

Jangan bikin database atau localStorage untuk history (cukup tampilkan analisis terkini saja)

Jangan bikin fitur trading/eksekusi order — ini murni tools analisis & rekomendasi read-only

Jangan bikin backend API routes/serverless functions kecuali nanti diminta khusus untuk mengatasi CORS

Catatan buat Rico (bukan bagian dari prompt di atas): Kalau nanti Bolt/Lovable bikinnya dan pas dites beneran kena CORS block dari Indodax, kasih tau gue — nanti kita tambahin prompt susulan buat minta dibikinin 1 serverless function kecil sebagai proxy, itu satu-satunya bagian yang mungkin butuh keluar dari "no backend".

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://rhcryptanalyzer.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/78fa277e-57de-492c-ac01-5a91bbb892cd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
