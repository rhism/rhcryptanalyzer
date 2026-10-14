import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./auth";

export type Strategy = "trend" | "contrarian";

export type GeminiAnalysisInput = {
  pair: string;
  strategy?: Strategy;
  ticker: {
    last: string;
    high: string;
    low: string;
    buy?: string;
    sell?: string;
  };
  indicators: {
    rsi14: number | null;
    ma7: number | null;
    ma25: number | null;
    macd?: { macd: number; signal: number; hist: number; histPrev: number | null } | null;
    atr14?: number | null;
    volumeRatio?: number | null;
  };
  /** Level yang SUDAH dihitung kode (bukan tebakan AI). */
  levels?: {
    support: number | null;
    resistance: number | null;
    stopLoss: number | null;
    target1: number | null;
    target2: number | null;
  };
};

function idr(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

type AnalysisResult = {
  kesimpulan: string;
  rekomendasi: string;
  alasan: string;
  support: string;
  resistance: string;
  confidence: string;
  provider?: string;
};

function buildPrompt(data: GeminiAnalysisInput): string {
  const { pair, ticker, indicators: ind } = data;
  const strategy: Strategy = data.strategy === "contrarian" ? "contrarian" : "trend";
  const strategyLabel = strategy === "contrarian" ? "Contrarian" : "Trend Following";
  return `Kamu adalah analis kripto yang OBJEKTIF dan tidak bias untuk pasangan ${pair.toUpperCase()} di Indodax. HANYA balas dengan JSON valid tanpa markdown code fence atau teks lain.

STRATEGI YANG DIPILIH USER: ${strategyLabel}

Data ticker:
- Harga terakhir: ${ticker.last}
- High 24h: ${ticker.high}
- Low 24h: ${ticker.low}
- Bid: ${ticker.buy ?? "-"}
- Ask: ${ticker.sell ?? "-"}

Indikator (dihitung dari candle harian):
- RSI14: ${ind.rsi14?.toFixed(2) ?? "-"}
- MA7: ${ind.ma7?.toFixed(2) ?? "-"}
- MA25: ${ind.ma25?.toFixed(2) ?? "-"}
- MACD histogram: ${
    ind.macd
      ? `${ind.macd.hist.toFixed(2)} (${
          ind.macd.histPrev === null
            ? "arah belum diketahui"
            : ind.macd.hist > ind.macd.histPrev
              ? "naik dibanding candle sebelumnya"
              : "turun dibanding candle sebelumnya"
        })`
      : "-"
  }
- ATR14 (rata-rata rentang gerak harian): ${ind.atr14 != null ? `${ind.atr14.toFixed(2)} (${((ind.atr14 / Number(ticker.last)) * 100).toFixed(2)}% dari harga)` : "-"}
- Volume candle harian terakhir vs rata-rata: ${ind.volumeRatio != null ? `${ind.volumeRatio.toFixed(2)}x` : "-"}

PEDOMAN REKOMENDASI — WAJIB pakai lensa "${strategyLabel}" saja (nilai objektif, jangan bias ke HOLD):
${
  strategy === "contrarian"
    ? `- Lensa CONTRARIAN: melawan arah tren, cari titik jenuh.
- BUY → RSI14 mendekati atau di bawah 30 (jenuh jual), harga berpotensi memantul naik.
- SELL → RSI14 mendekati atau di atas 70 (jenuh beli), harga berpotensi terkoreksi turun.
- HOLD → RSI14 di zona netral 30-70: tidak ada sinyal contrarian yang kuat ke arah manapun, jelaskan itu.
- Posisi MA7/MA25 hanya konteks sekunder. Contoh: "walau tren pendeknya masih turun, indikator jenuh menunjukkan harga sudah 'kemurahan', yang secara historis sering diikuti pantulan — tapi ini tidak dijamin".`
    : `- Lensa TREND FOLLOWING: ikuti arah tren yang sedang berjalan.
- BUY → MA7 di atas MA25 DAN harga di atas kedua MA (momentum naik berlanjut).
- SELL → MA7 di bawah MA25 DAN harga di bawah kedua MA (momentum melemah).
- HOLD → MA saling berdekatan / harga bolak-balik di antara MA (tren belum jelas).
- RSI ekstrem (dekat 70 atau 30) hanya jadi bendera kehati-hatian di atas pembacaan tren MA, bukan sinyal utama.`
}

LEVEL DARI SISTEM (sudah dihitung kode, jangan diubah atau dikarang ulang):
- Support terdekat: ${data.levels?.support != null ? idr(data.levels.support) : "tidak terdeteksi"}
- Resistance terdekat: ${data.levels?.resistance != null ? idr(data.levels.resistance) : "tidak terdeteksi"}
- Kalau menyebut support/resistance/stop-loss/target di teks, pakai angka di atas persis. Jangan membuat level lain.
- Data MACD, ATR, dan volume hanya KONTEKS PENDUKUNG; aturan rekomendasi tetap yang di atas.

GAYA BAHASA untuk "kesimpulan" dan "alasan" (WAJIB):
- Tulis seperti ngobrol santai ke teman yang BENAR-BENAR AWAM soal crypto/trading. Nol jargon telanjang.
- JANGAN pernah nulis istilah teknis ("RSI", "MA7", "MA25", "overbought", "uptrend", "bearish", "resistance", "support") tanpa langsung dijelasin artinya di kalimat itu juga pakai bahasa sehari-hari.
- Contoh gaya:
  * Jangan: "RSI berada di zona netral."
    Pakai: "Indikator momentum (RSI) ada di posisi tengah-tengah (${ind.rsi14?.toFixed(0) ?? "-"}), artinya harga belakangan ini nggak lagi 'terlalu panas' atau 'terlalu dingin' — masih wajar."
  * Jangan: "MA7 di atas MA25, mengindikasikan uptrend."
    Pakai: "Harga rata-rata seminggu terakhir lebih tinggi dari rata-rata sebulan terakhir, tandanya harga lagi cenderung naik pelan-pelan."
- Pakai analogi sederhana kalau membantu (momentum = kecepatan, tren = jalan menanjak/menurun, overbought = kayak lari terlalu kencang mau ngos-ngosan, dsb).
- Tetap sebut angka konkretnya (harga dalam Rupiah, nilai RSI, nilai rata-rata harga) — tapi selalu bungkus dengan penjelasan simpel, jangan lempar angka mentah.
- Nada casual & ramah, bukan laporan formal. Jangan bertele-tele — panjangnya wajar (mirip versi sebelumnya, cuma lebih gampang dicerna).
- "kesimpulan": 1-2 kalimat ringkas gaya obrolan, DITUTUP satu kalimat yang bilang bahwa ini cuma satu sudut pandang analisis dari beberapa cara yang sama-sama valid, dan kalau tombol strateginya diganti, hasil bacanya bisa beda tapi tetap masuk akal.
- "alasan": 3-4 kalimat, WAJIB dimulai dengan "Berdasarkan pendekatan ${strategyLabel}, ..." lalu jelasin kenapa kesimpulannya begitu dengan bahasa awam + angka pendukung.
- Field "support" dan "resistance": isi dengan level dari sistem di atas (sistem akan memastikan nilainya).

Balas JSON persis struktur ini (tanpa tambahan apapun):
{"kesimpulan":"...","rekomendasi":"BUY|HOLD|SELL","alasan":"...","support":"level harga kasar dalam Rupiah","resistance":"level harga kasar dalam Rupiah","confidence":"LOW|MEDIUM|HIGH"}`;
}

function parseJsonResponse(text: string): Omit<AnalysisResult, "provider"> {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

class RateLimitError extends Error {}

async function callGemini(prompt: string, apiKey: string): Promise<Omit<AnalysisResult, "provider">> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
      }),
    },
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if (res.status === 429 || /quota|rate/i.test(txt)) {
      throw new RateLimitError(`Gemini rate limit (${res.status})`);
    }
    throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: empty response");
  return parseJsonResponse(text);
}

async function callGroq(prompt: string, apiKey: string): Promise<Omit<AnalysisResult, "provider">> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq: empty response");
  return parseJsonResponse(text);
}

export const analyzeWithGemini = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((input: GeminiAnalysisInput) => {
    if (!input || typeof input !== "object") throw new Error("Invalid input");
    if (!input.pair || !input.ticker || !input.indicators) {
      throw new Error("Missing pair/ticker/indicators");
    }
    return input;
  })
  .handler(async ({ data }): Promise<AnalysisResult> => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    if (!geminiKey && !groqKey) {
      throw new Error("GEMINI_API_KEY / GROQ_API_KEY belum tersedia.");
    }

    const prompt = buildPrompt(data);
    // Level support/resistance selalu dari hitungan kode, bukan dari AI.
    const withSystemLevels = (r: Omit<AnalysisResult, "provider">) => ({
      ...r,
      support: data.levels?.support != null ? idr(data.levels.support) : "Tidak terdeteksi",
      resistance: data.levels?.resistance != null ? idr(data.levels.resistance) : "Tidak terdeteksi",
    });

    let geminiErr: unknown = null;
    if (geminiKey) {
      try {
        const parsed = await callGemini(prompt, geminiKey);
        return { ...withSystemLevels(parsed), provider: "gemini" };
      } catch (e) {
        geminiErr = e;
        const isRate = e instanceof RateLimitError;
        if (!isRate) {
          // Non-rate error: still try Groq as fallback, but remember error
          console.error("Gemini failed:", e);
        } else {
          console.warn("Gemini rate-limited, falling back to Groq");
        }
      }
    }

    if (groqKey) {
      try {
        const parsed = await callGroq(prompt, groqKey);
        return { ...withSystemLevels(parsed), provider: "groq" };
      } catch (e) {
        const gMsg = geminiErr instanceof Error ? geminiErr.message : geminiErr ? String(geminiErr) : "tidak dikonfigurasi";
        const grMsg = e instanceof Error ? e.message : String(e);
        throw new Error(`Kedua AI provider gagal. Gemini: ${gMsg}. Groq: ${grMsg}`);
      }
    }

    const gMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
    throw new Error(`Gemini gagal dan Groq fallback belum dikonfigurasi. ${gMsg}`);
  });
