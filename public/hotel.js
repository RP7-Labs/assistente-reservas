// Qual hotel esta página atende (multi-hotel): ?hotel=<id> na URL fica guardado nesta aba
// e vai no cabeçalho X-Hotel de toda chamada à nossa API. No domínio próprio do hotel não precisa.
(() => {
  const CHAVE = "hotelId";
  let id = new URLSearchParams(location.search).get("hotel");
  try {
    if (id) sessionStorage.setItem(CHAVE, id);
    else id = sessionStorage.getItem(CHAVE);
  } catch { /* sem armazenamento */ }
  if (!id) return;
  const original = window.fetch.bind(window);
  window.fetch = (entrada, opcoes = {}) => {
    const url = typeof entrada === "string" ? entrada : entrada.url;
    if (!new URL(url, location.href).pathname.startsWith("/api/") || new URL(url, location.href).origin !== location.origin) return original(entrada, opcoes);
    const headers = new Headers(opcoes.headers || (typeof entrada === "string" ? undefined : entrada.headers));
    if (!headers.has("X-Hotel")) headers.set("X-Hotel", id);
    return original(entrada, { ...opcoes, headers });
  };
  window.hotelAtual = id;
})();
