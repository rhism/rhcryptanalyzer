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

export const analyzeWithGemini = createServerFn({ method: "POST" })
  .inputValidator((input: GeminiAnalysisInput) => {
    if (!input || typeof input !== "object") throw new Error("Invalid input");
    if (!input.pair || !input.ticker || !input.indicators) {
      throw new Error("Missing pair/ticker/indicators");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY belum tersedia.");

    const { pair, ticker, indicators: ind } = data;
    const prompt = `Kamu adalah analis kripto. Analisis data berikut untuk pasangan ${pair.toUpperCase()} di Indodax dan HANYA balas dengan JSON valid tanpa markdown code fence atau teks lain.

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

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 429) {
        throw new Error("Rate limit AI Gateway. Coba lagi sebentar.");
      }
      if (res.status === 402) {
        throw new Error("Kredit AI Gateway habis. Tambah kredit di workspace settings.");
      }
      throw new Error(`AI Gateway HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    const json = await res.json();
    const text: string | undefined = json?.choices?.[0]?.message?.content;
    if (!text) throw new Error("AI Gateway: empty response");

    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    try {
      return JSON.parse(cleaned) as {
        kesimpulan: string;
        rekomendasi: string;
        alasan: string;
        support: string;
        resistance: string;
        confidence: string;
      };
    } catch {
      throw new Error("Gemini: gagal parse JSON. Raw: " + cleaned.slice(0, 200));
    }
  });
