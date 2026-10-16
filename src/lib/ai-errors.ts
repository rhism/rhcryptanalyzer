/** Mengubah pesan error mentah dari penyedia AI menjadi kalimat singkat yang mudah dipahami. */
export function friendlyAiError(raw: string): string {
  const m = raw || "";
  if (/\b50[0-4]\b|high demand|overload|UNAVAILABLE/i.test(m) && !/404/.test(m)) {
    return "Server AI sedang sibuk. Coba tekan Refresh Analysis lagi beberapa detik lagi.";
  }
  if (/\b429\b|quota|rate limit|rate-limit/i.test(m)) {
    return "Kuota AI sedang habis sementara. Coba lagi beberapa menit lagi.";
  }
  if (/\b404\b|not[_ ]found|no longer available|does not exist|decommission/i.test(m)) {
    return "Model AI tidak ditemukan (kemungkinan sudah dimatikan penyedia). Kabari pembuat aplikasi untuk mengganti model.";
  }
  if (/\b40[13]\b|api key|permission|unauthor/i.test(m)) {
    return "Kunci API AI ditolak atau tidak valid.";
  }
  if (/belum tersedia|belum dikonfigurasi/i.test(m)) {
    return "Kunci API AI belum dipasang di server.";
  }
  const short = m.replace(/\s+/g, " ").trim();
  return short.length > 140 ? `${short.slice(0, 140)}…` : short || "Penyebab tidak diketahui.";
}
