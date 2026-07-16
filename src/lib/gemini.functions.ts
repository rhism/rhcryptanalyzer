import { createServerFn } from "@tanstack/react-start";

export type GeminiAnalysisInput = {
  pair: string;
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
  };
};

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
  return `Kamu adalah analis kripto. Analisis data berikut untuk pasangan ${pair.toUpperCase()} di Indodax dan HANYA balas dengan JSON valid tanpa markdown code fence atau teks lain.

Data ticker:
- Harga terakhir: ${ticker.last}
- High 24h: ${ticker.high}
- Low 24h: ${ticker.low}
- Bid: ${ticker.buy ?? "-"}
- Ask: ${ticker.sell ?? "-"}

Indikator (dihitung dari 30 candle harian):
- RSI14: ${ind.rsi14?.toFixed(2) ?? "-"}
- MA7: ${ind.ma7?.toFixed(2) ?? "-"}
- MA25: ${ind.ma25?.toFixed(2) ?? "-"}

Balas dengan JSON persis struktur ini (tanpa tambahan apapun):
{"kesimpulan":"...","rekomendasi":"BUY|HOLD|SELL","alasan":"minimal 3 kalimat","support":"level harga support kasar dalam Rupiah","resistance":"level harga resistance kasar dalam Rupiah","confidence":"LOW|MEDIUM|HIGH"}`;
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

    let geminiErr: unknown = null;
    if (geminiKey) {
      try {
        const parsed = await callGemini(prompt, geminiKey);
        return { ...parsed, provider: "gemini" };
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
        return { ...parsed, provider: "groq" };
      } catch (e) {
        const gMsg = geminiErr instanceof Error ? geminiErr.message : geminiErr ? String(geminiErr) : "tidak dikonfigurasi";
        const grMsg = e instanceof Error ? e.message : String(e);
        throw new Error(`Kedua AI provider gagal. Gemini: ${gMsg}. Groq: ${grMsg}`);
      }
    }

    const gMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
    throw new Error(`Gemini gagal dan Groq fallback belum dikonfigurasi. ${gMsg}`);
  });
