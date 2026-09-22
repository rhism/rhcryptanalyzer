import { createServerFn } from "@tanstack/react-start";

export type FearGreed = {
  value: number;
  classification: string;
  timestamp: string | null;
};

export type UsdIdr = {
  rate: number;
  date: string;
};

export const fetchFearGreed = createServerFn({ method: "GET" }).handler(
  async (): Promise<FearGreed> => {
    const res = await fetch("https://api.alternative.me/fng/", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Fear & Greed HTTP ${res.status}`);
    const json = await res.json();
    const item = json?.data?.[0];
    if (!item) throw new Error("Fear & Greed: data kosong");
    const value = Number(item.value);
    if (!Number.isFinite(value)) throw new Error("Fear & Greed: nilai tidak valid");
    return {
      value,
      classification: String(item.value_classification ?? "-"),
      timestamp: item.timestamp ? String(item.timestamp) : null,
    };
  },
);

export const fetchUsdIdr = createServerFn({ method: "GET" }).handler(
  async (): Promise<UsdIdr> => {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=IDR", {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const json = await res.json();
    const rate = Number(json?.rates?.IDR);
    if (!Number.isFinite(rate)) throw new Error("Kurs USD/IDR tidak ditemukan di respons");
    return { rate, date: String(json?.date ?? "") };
  },
);

type NewsItem = { title: string; description: string };

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

function parseRss(xml: string, limit: number): NewsItem[] {
  const items: NewsItem[] = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[0];
    const title = pickTag(block, "title");
    const description = pickTag(block, "description").slice(0, 400);
    if (title) items.push({ title, description });
  }
  return items;
}

async function fetchFeed(url: string, limit: number): Promise<NewsItem[]> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml, */*", "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];
    return parseRss(await res.text(), limit);
  } catch {
    return [];
  }
}

function buildNewsPrompt(items: NewsItem[]): string {
  const list = items
    .map((it, i) => `${i + 1}. ${it.title}${it.description ? ` — ${it.description}` : ""}`)
    .join("\n");
  return `Kamu adalah penerjemah berita kripto untuk orang yang BENAR-BENAR AWAM. Di bawah ini daftar judul & ringkasan berita kripto terbaru.

TUGAS:
- Rangkum HANYA berita yang relevan ke salah satu topik ini: keputusan suku bunga The Fed / bank sentral AS, regulasi kripto (AS atau Indonesia), peristiwa geopolitik yang memengaruhi pasar, dan arus dana ETF kripto.
- Buang total berita soal pump koin receh, NFT, gosip selebriti, promosi produk.
- Kalau TIDAK ADA satu pun berita yang relevan, katakan itu apa adanya dengan kalimat singkat ("Dari berita terbaru yang masuk, belum ada kabar penting soal suku bunga, regulasi, geopolitik, atau ETF."). Jangan memaksakan rangkuman.

GAYA BAHASA (WAJIB):
- Bahasa Indonesia santai seperti ngobrol ke teman awam.
- Jangan pakai jargon telanjang. Setiap istilah teknis langsung dijelaskan di kalimat yang sama pakai bahasa sehari-hari.
- 2-4 paragraf pendek. Boleh sebut angka konkret kalau ada.
- Tutup dengan 1 kalimat singkat soal artinya buat harga kripto secara umum, dan ingatkan ini bukan saran finansial.
- Balas HANYA teks rangkuman, tanpa judul, tanpa markdown, tanpa bullet.

DAFTAR BERITA:
${list}`;
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 },
      }),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: respons kosong");
  return text.trim();
}

async function callGroq(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq: respons kosong");
  return text.trim();
}

export type NewsSummary = {
  summary: string;
  sources: string[];
  count: number;
  provider: string;
};

export const fetchNewsSummary = createServerFn({ method: "POST" }).handler(
  async (): Promise<NewsSummary> => {
    const [coindesk, cointelegraph] = await Promise.all([
      fetchFeed("https://www.coindesk.com/arc/outboundfeeds/rss/", 8),
      fetchFeed("https://cointelegraph.com/rss", 8),
    ]);

    const sources: string[] = [];
    if (coindesk.length) sources.push("CoinDesk");
    if (cointelegraph.length) sources.push("CoinTelegraph");

    const items = [...coindesk, ...cointelegraph].slice(0, 15);
    if (items.length === 0) {
      throw new Error("Tidak ada berita yang bisa diambil dari CoinDesk maupun CoinTelegraph.");
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    if (!geminiKey && !groqKey) throw new Error("GEMINI_API_KEY / GROQ_API_KEY belum tersedia.");

    const prompt = buildNewsPrompt(items);

    let geminiErr: unknown = null;
    if (geminiKey) {
      try {
        return { summary: await callGemini(prompt, geminiKey), sources, count: items.length, provider: "gemini" };
      } catch (e) {
        geminiErr = e;
      }
    }
    if (groqKey) {
      try {
        return { summary: await callGroq(prompt, groqKey), sources, count: items.length, provider: "groq" };
      } catch (e) {
        const g = geminiErr instanceof Error ? geminiErr.message : "tidak dikonfigurasi";
        const gr = e instanceof Error ? e.message : String(e);
        throw new Error(`Kedua AI provider gagal. Gemini: ${g}. Groq: ${gr}`);
      }
    }
    throw new Error(
      `Gemini gagal dan Groq belum dikonfigurasi. ${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)}`,
    );
  },
);
