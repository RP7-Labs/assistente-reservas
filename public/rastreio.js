// Origem da visita (campanhas) e tags de conversão da Meta e do Google Ads.
// As tags só carregam depois do consentimento (LGPD); a origem da campanha fica guardada só neste navegador
// e vai para o servidor junto com a primeira mensagem do chat.
(() => {
  const CHAVE = "origemCampanha", CONSENT = "consentimentoCookies", VALIDADE = 30 * 86_400_000;
  const CAMPOS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "gbraid", "wbraid", "fbclid"];
  const ler = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
  const cookie = (n) => document.cookie.split("; ").find((c) => c.startsWith(n + "="))?.split("=")[1] ?? null;

  // Guarda o último clique de campanha (vale 30 dias)
  const q = new URLSearchParams(location.search);
  const daUrl = Object.fromEntries(CAMPOS.filter((c) => q.get(c)).map((c) => [c, q.get(c)]));
  const externo = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : null;
  if (Object.keys(daUrl).length) {
    gravar(CHAVE, { ...daUrl, fbclid_em: daUrl.fbclid ? Date.now() : undefined, referrer: externo, landing: location.href.split("#")[0], em: Date.now() });
  } else if (externo && !ler(CHAVE)) {
    gravar(CHAVE, { referrer: externo, landing: location.href.split("#")[0], em: Date.now() });
  }

  const origem = () => {
    const o = ler(CHAVE);
    if (!o || Date.now() - (o.em ?? 0) > VALIDADE) return null;
    return { ...o, fbp: cookie("_fbp"), fbc: cookie("_fbc") };
  };

  let cfg = null;
  const fila = [];
  const carregar = (src) => { const s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s); };

  function ligarTags() {
    if (!cfg) return;
    if (cfg.meta_pixel && !window.fbq) {
      const f = window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
      f.push = f; f.loaded = true; f.version = "2.0"; f.queue = [];
      carregar("https://connect.facebook.net/en_US/fbevents.js");
      fbq("init", cfg.meta_pixel); fbq("track", "PageView");
    }
    if (cfg.google_ads && !window.gtag) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { dataLayer.push(arguments); };
      carregar(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.google_ads)}`);
      gtag("js", new Date()); gtag("config", cfg.google_ads);
    }
    fila.splice(0).forEach((f) => f());
  }

  function banner() {
    const b = document.createElement("div");
    b.setAttribute("role", "dialog");
    b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:50;max-width:520px;margin:0 auto;background:var(--surface,#fff);color:var(--ink,#111);border:1px solid var(--border,#ddd);border-radius:14px;padding:12px 14px;box-shadow:0 12px 32px -8px rgba(0,0,0,.25);font:14px/1.4 var(--font,system-ui);display:flex;gap:10px;align-items:center;flex-wrap:wrap";
    b.innerHTML = `<span style="flex:1;min-width:200px">Usamos cookies para medir de onde vêm as reservas e melhorar nossos anúncios.</span>
      <button type="button" data-c="nao" class="btn">Recusar</button><button type="button" data-c="sim" class="btn prim">Aceitar</button>`;
    b.onclick = (e) => {
      const c = e.target.closest("[data-c]")?.dataset.c;
      if (!c) return;
      gravar(CONSENT, c);
      b.remove();
      if (c === "sim") ligarTags();
    };
    document.body.appendChild(b);
  }

  fetch("/api/rastreio/config").then((r) => r.ok && r.json()).then((c) => {
    cfg = c;
    if (!c || (!c.meta_pixel && !c.google_ads)) return;
    const consent = ler(CONSENT);
    if (consent === "sim") ligarTags();
    else if (consent !== "nao") banner();
  }).catch(() => {});

  // Evento nas duas plataformas, se as tags estiverem ligadas. eventId deduplica com a API de Conversões.
  function evento(nome, { valor, eventId, rotuloGoogle } = {}) {
    const f = () => {
      const extra = valor != null ? { value: Number(valor), currency: "BRL" } : {};
      if (window.fbq) fbq("track", nome, extra, eventId ? { eventID: eventId } : undefined);
      if (window.gtag && cfg?.google_ads && rotuloGoogle && cfg[rotuloGoogle]) {
        gtag("event", "conversion", { send_to: `${cfg.google_ads}/${cfg[rotuloGoogle]}`, ...extra, transaction_id: eventId });
      }
    };
    window.fbq || window.gtag ? f() : fila.push(f);
  }

  window.rastreio = { origem, evento };
})();
