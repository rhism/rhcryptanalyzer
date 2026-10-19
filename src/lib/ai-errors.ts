/**
 * Mengubah pesan error mentah dari penyedia AI menjadi kalimat singkat yang mudah dipahami.
 * Kalau Gemini DAN cadangannya (Groq) sama-sama gagal, penyebab tiap penyedia dijelaskan terpisah
 * supaya penyebab utama (mis. Gemini sibuk) tidak tertutup oleh kegagalan cadangan.
 */
export type AiErrorInfo = { summary: string; detail: string };

function classify(m: string): string {
  const t = m || "";
  if (/\b429\b|quota|rate[ -]?limit/i.test(t)) return "kuota habis sementara (429)";
  if (/\b404\b|not[_ ]found|no longer available|does not exist|decommission/i.test(t)) {
    return "model tidak ditemukan (404), kemungkinan sudah dimatikan penyedia";
  }
  if (/\b50[0-4]\b|high demand|overload|UNAVAILABLE/i.test(t)) return "server sedang sibuk (5xx)";
  if (/\b40[13]\b|api key|permission|unauthor/i.test(t))
    return "kunci API ditolak atau tidak valid";
  if (/belum tersedia|belum dikonfigurasi|belum di-set/i.test(t))
    return "kunci API belum dipasang di server";
  const short = t.replace(/\s+/g, " ").trim();
  return short.length > 120 ? `${short.slice(0, 120)}…` : short || "penyebab tidak diketahui";
}

export function explainAiError(raw: string): AiErrorInfo {
  const m = raw || "";
  const detail = m.replace(/\s+/g, " ").trim().slice(0, 700);
  const both = m.match(/Kedua AI provider gagal\.\s*Gemini:\s*([\s\S]*?)\.\s*Groq:\s*([\s\S]*)$/i);
  if (both) {
    return {
      summary: `Gemini: ${classify(both[1])}. Cadangan Groq: ${classify(both[2])}.`,
      detail,
    };
  }
  return { summary: `${classify(m).replace(/^./, (c) => c.toUpperCase())}.`, detail };
}

/** Versi ringkas (hanya kalimat ringkasan). */
export function friendlyAiError(raw: string): string {
  return explainAiError(raw).summary;
}
