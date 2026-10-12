// Site público do hotel (/site), montado no servidor: carrega rápido, aparece no Google
// e já vem com o conteúdo do hotel certo (multi-hotel pelo domínio ou ?hotel=).
// O chat do assistente abre por cima da página; o botão de WhatsApp leva um código de origem.
import { dadosSite } from "./site.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tel = (n) => String(n ?? "").replace(/\D/g, "");
const telBR = (n) => { const d = tel(n).replace(/^55/, ""); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : d; };

const ICONES = {
  praia: '<path d="M2 20c2 0 2-1.5 4-1.5S8 20 10 20s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M12 3a7 7 0 0 1 7 7H5a7 7 0 0 1 7-7z"/><path d="M12 10v8"/>',
  chave: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 7.7-7.7M16 7l2 2M14 9l2 2"/>',
  trabalho: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20M9 16v4M15 16v4"/>',
  vista: '<path d="M3 20h18"/><path d="M5 20V10l4-3v13M13 20V6l6 3v11"/>',
  pessoas: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
  mapa: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  estrela: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  zap: '<path d="M20.5 3.5A11.8 11.8 0 0 0 2.2 17.7L1 23l5.4-1.4A11.8 11.8 0 0 0 20.5 3.5zM12 21.1a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.2.8.9-3.1-.2-.4a9.8 9.8 0 1 1 7.9 4.3zm5.4-7.3c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.4.2-.7.1a8 8 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 0 0-.8.4 3.4 3.4 0 0 0-1 2.5 5.9 5.9 0 0 0 1.2 3.1 13.4 13.4 0 0 0 5.2 4.6c1.9.8 2.7.9 3.6.8a3.1 3.1 0 0 0 2-1.4 2.5 2.5 0 0 0 .2-1.4c-.1-.1-.3-.2-.6-.3z" fill="currentColor" stroke="none"/>',
  seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
  ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] ?? ""}</svg>`;

export function paginaSite(hotel, { base = "" } = {}) {
  const d = dadosSite(hotel);
  const c = d.contato ?? {};
  const capa = d.fotos.capa ?? d.fotos.quarto ?? "";
  const url = `${base}/site`;
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Hotel", name: d.nome, url, image: capa ? base + capa : undefined,
    telephone: c.telefone ? `+${tel(c.telefone)}` : undefined, email: c.email,
    address: d.endereco ? { "@type": "PostalAddress", streetAddress: d.endereco.split(",").slice(0, 2).join(",").trim(), addressLocality: d.cidade, addressCountry: "BR" } : undefined,
    checkinTime: d.checkin, checkoutTime: d.checkout,
    aggregateRating: d.avaliacoes ? { "@type": "AggregateRating", ratingValue: String(d.avaliacoes.nota).replace(",", "."), bestRating: "10", ratingCount: d.avaliacoes.total } : undefined,
  };
  const desc = [d.titulo, d.subtitulo].filter(Boolean).join(". ");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(d.nome)} | ${esc(d.titulo)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#1d2a7a">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(d.nome)}"><meta property="og:description" content="${esc(desc)}">
${capa ? `<meta property="og:image" content="${esc(base + capa)}"><link rel="preload" as="image" href="${esc(capa)}" fetchpriority="high">` : ""}
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
<style>
  :root { --navy: #1d2a7a; --navy-2: #26359a; --navy-50: #eef0fb; --verde: #2bb94a; --verde-2: #229a3d; --verde-50: #e8f8ec;
    --ink: #121735; --ink-2: #3b4163; --muted: #6b7090; --bg: #f7f5f1; --card: #fff; --linha: #e7e4dd;
    --raio: 20px; --sombra: 0 1px 2px rgba(18,23,53,.06), 0 10px 30px -8px rgba(18,23,53,.14);
    --fonte: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif }
  * { box-sizing: border-box }
  html { scroll-behavior: smooth; scroll-padding-top: 72px }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 var(--fonte); -webkit-font-smoothing: antialiased }
  a { color: inherit } img { display: block; max-width: 100% }
  svg { width: 22px; height: 22px; flex: none }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 16px }
  h1, h2, h3 { line-height: 1.15; margin: 0; letter-spacing: -.01em }
  h2 { font-size: clamp(26px, 4vw, 36px); font-weight: 800; color: var(--navy) }
  .sobre { color: var(--verde-2); font-size: 12.5px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; margin-bottom: 8px }
  .lead { color: var(--ink-2); font-size: 17px; max-width: 620px; margin: 10px 0 0 }
  section { padding: 56px 0 }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 999px; padding: 13px 22px; font: 700 15.5px var(--fonte); cursor: pointer; text-decoration: none; transition: transform .06s, background .15s }
  .btn:active { transform: scale(.98) }
  .prim { background: var(--verde); color: #fff } .prim:hover { background: var(--verde-2) }
  .sec { background: #fff; color: var(--navy); border: 1.5px solid var(--linha) } .sec:hover { border-color: var(--navy) }

  /* Topo */
  header.topo { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,.94); backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--linha) }
  header.topo .wrap { display: flex; align-items: center; gap: 18px; height: 64px }
  .marca { display: flex; align-items: center; gap: 10px; font-weight: 800; color: var(--navy); text-decoration: none; font-size: 17px }
  .selo { width: 36px; height: 36px; border-radius: 10px; background: var(--navy); color: #fff; display: grid; place-items: center; font: italic 900 20px/1 var(--fonte); box-shadow: inset 0 -8px 0 var(--verde) }
  nav.menu { display: flex; gap: 22px; margin-left: auto; font-weight: 600; font-size: 15px; color: var(--ink-2) }
  nav.menu a { text-decoration: none } nav.menu a:hover { color: var(--navy) }
  header .btn { padding: 10px 18px; font-size: 14.5px }
  @media (max-width: 820px) { nav.menu { display: none } header .btn { margin-left: auto } }

  /* Hero */
  .hero { padding: 32px 0 48px }
  .hero .wrap { display: grid; grid-template-columns: 1.05fr 1fr; gap: 40px; align-items: center }
  .hero h1 { font-size: clamp(34px, 5.4vw, 54px); font-weight: 850; color: var(--navy) }
  .hero h1 em { font-style: normal; color: var(--verde-2) }
  .foto-hero { position: relative; border-radius: 28px; overflow: hidden; aspect-ratio: 1/1; background: var(--navy-50); box-shadow: var(--sombra) }
  .foto-hero img { width: 100%; height: 100%; object-fit: cover }
  .nota { position: absolute; left: 14px; bottom: 14px; background: #fff; border-radius: 16px; padding: 10px 14px; display: flex; gap: 10px; align-items: center; box-shadow: var(--sombra); text-decoration: none }
  .nota b { font-size: 22px; color: var(--navy) } .nota span { font-size: 12.5px; color: var(--muted); line-height: 1.3 }
  @media (max-width: 820px) { .hero .wrap { grid-template-columns: 1fr; gap: 22px } .foto-hero { order: -1; aspect-ratio: 4/3; border-radius: 22px } .hero { padding-top: 14px } }

  /* Formulário de reserva */
  form.reserva { margin-top: 24px; background: #fff; border-radius: var(--raio); box-shadow: var(--sombra); padding: 14px; display: grid; grid-template-columns: 1fr 1fr .8fr auto; gap: 10px; align-items: end }
  form.reserva label { display: grid; gap: 4px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted) }
  form.reserva input, form.reserva select { width: 100%; border: 1.5px solid var(--linha); border-radius: 12px; padding: 11px 10px; font: 600 15.5px var(--fonte); color: var(--ink); background: #fff; min-width: 0 }
  form.reserva input:focus, form.reserva select:focus { outline: none; border-color: var(--navy) }
  form.reserva .btn { height: 48px }
  .garantias { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 14px; color: var(--ink-2); font-size: 14px }
  .garantias span { display: inline-flex; gap: 6px; align-items: center } .garantias svg { width: 18px; height: 18px; color: var(--verde-2) }
  @media (max-width: 560px) { form.reserva { grid-template-columns: 1fr 1fr } form.reserva .btn { grid-column: 1 / -1 } }

  /* Destaques */
  .destaques { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 26px }
  .dest { background: #fff; border-radius: var(--raio); padding: 20px; box-shadow: var(--sombra) }
  .dest .ic { width: 44px; height: 44px; border-radius: 14px; background: var(--navy-50); color: var(--navy); display: grid; place-items: center; margin-bottom: 12px }
  .dest h3 { font-size: 17px; margin-bottom: 4px } .dest p { margin: 0; color: var(--ink-2); font-size: 14.5px }
  @media (max-width: 900px) { .destaques { grid-template-columns: 1fr 1fr } }
  @media (max-width: 480px) { .destaques { grid-template-columns: 1fr } }

  /* Quartos */
  .quartos { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; margin-top: 26px }
  .quarto { background: #fff; border-radius: var(--raio); overflow: hidden; box-shadow: var(--sombra); display: flex; flex-direction: column }
  .quarto img { aspect-ratio: 16/10; object-fit: cover; width: 100%; background: var(--navy-50) }
  .quarto .corpo { padding: 18px; display: flex; flex-direction: column; gap: 10px; flex: 1 }
  .quarto h3 { font-size: 21px; color: var(--navy) }
  .quarto p { margin: 0; color: var(--ink-2) }
  .itens { display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 0; list-style: none }
  .itens li { background: var(--bg); border-radius: 999px; padding: 4px 11px; font-size: 13px; font-weight: 600; color: var(--ink-2) }
  .quarto .rodape { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 6px }
  .quarto .cap { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); font-size: 14px }

  .mensal { margin-top: 22px; background: var(--navy); color: #fff; border-radius: 24px; padding: 26px; display: flex; gap: 20px; align-items: center; justify-content: space-between; flex-wrap: wrap }
  .mensal h3 { font-size: 24px } .mensal p { margin: 6px 0 0; color: #d6daf5; max-width: 620px }

  /* Estrutura */
  .galeria { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 26px }
  .galeria figure { margin: 0; position: relative; border-radius: 18px; overflow: hidden; aspect-ratio: 3/4; background: var(--navy-50) }
  .galeria img { width: 100%; height: 100%; object-fit: cover }
  .galeria figcaption { position: absolute; inset: auto 0 0 0; padding: 40px 14px 12px; color: #fff; background: linear-gradient(transparent, rgba(18,23,53,.85)); font-size: 13.5px }
  .galeria figcaption b { display: block; font-size: 16px }
  @media (max-width: 900px) { .galeria { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; margin-inline: -16px; padding-inline: 16px } .galeria figure { flex: 0 0 68%; scroll-snap-align: start } }

  /* Local */
  .local { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 26px }
  .caixa { background: #fff; border-radius: var(--raio); padding: 22px; box-shadow: var(--sombra) }
  .dist { list-style: none; margin: 14px 0 0; padding: 0 }
  .dist li { display: flex; justify-content: space-between; gap: 10px; padding: 11px 0; border-top: 1px solid var(--linha) }
  .dist li span:last-child { color: var(--muted); white-space: nowrap }
  .avaliacao { display: flex; gap: 16px; align-items: center }
  .avaliacao .grande { width: 76px; height: 76px; border-radius: 20px; background: var(--navy); color: #fff; display: grid; place-items: center; font-size: 28px; font-weight: 850; flex: none }
  @media (max-width: 820px) { .local { grid-template-columns: 1fr } }

  /* Perguntas */
  .faq { margin-top: 22px; display: grid; gap: 10px; max-width: 820px }
  .faq details { background: #fff; border-radius: 16px; box-shadow: var(--sombra); padding: 0 18px }
  .faq summary { cursor: pointer; padding: 16px 0; font-weight: 700; list-style: none; display: flex; justify-content: space-between; gap: 12px }
  .faq summary::after { content: "+"; font-size: 22px; line-height: 1; color: var(--navy) }
  .faq details[open] summary::after { content: "–" }
  .faq p { margin: 0 0 16px; color: var(--ink-2) }

  footer { background: var(--ink); color: #c7cbe0; padding: 40px 0 120px; font-size: 14.5px }
  footer .wrap { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 24px }
  footer h3 { color: #fff; font-size: 16px; margin-bottom: 10px }
  footer a { text-decoration: none } footer a:hover { color: #fff }
  footer p { margin: 4px 0 }
  @media (max-width: 720px) { footer .wrap { grid-template-columns: 1fr } }

  /* Botões flutuantes e chat */
  .flutua { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 30; display: flex; flex-direction: column; gap: 10px; align-items: flex-end }
  .flutua button { border: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; font: 700 15px var(--fonte); box-shadow: 0 10px 28px -6px rgba(18,23,53,.45) }
  .b-zap { width: 56px; height: 56px; justify-content: center; background: #25d366; color: #fff } .b-zap svg { width: 28px; height: 28px }
  .b-chat { background: var(--navy); color: #fff; padding: 14px 20px }
  @media (max-width: 560px) { .b-chat { width: 56px; height: 56px; padding: 0; justify-content: center } .b-chat span { display: none } }
  .gaveta { position: fixed; inset: 0; z-index: 40; display: none }
  .gaveta.aberta { display: block }
  .gaveta .fundo { position: absolute; inset: 0; background: rgba(18,23,53,.45) }
  .gaveta .painel { position: absolute; right: 16px; bottom: 16px; width: min(420px, calc(100% - 32px)); height: min(680px, calc(100dvh - 32px)); background: #fff; border-radius: 22px; overflow: hidden; box-shadow: 0 20px 60px -10px rgba(0,0,0,.4); display: flex; flex-direction: column }
  .gaveta .barra { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 8px 16px; background: var(--navy); color: #fff; font-weight: 700; font-size: 14.5px }
  .gaveta .fechar { width: 36px; height: 36px; border-radius: 50%; border: 0; background: rgba(255,255,255,.14); color: #fff; display: grid; place-items: center; cursor: pointer }
  .gaveta iframe { border: 0; width: 100%; flex: 1 }
  @media (max-width: 560px) { .gaveta .painel { inset: 0; width: 100%; height: 100dvh; border-radius: 0 } }
</style>
</head>
<body>
<header class="topo"><div class="wrap">
  <a class="marca" href="#inicio"><span class="selo">R</span>${esc(d.nome)}</a>
  <nav class="menu" aria-label="Seções"><a href="#quartos">Quartos</a><a href="#estrutura">Estrutura</a><a href="#local">Localização</a><a href="#duvidas">Dúvidas</a></nav>
  <button class="btn prim" type="button" data-chat="Quero fazer uma reserva">Reservar</button>
</div></header>

<main id="inicio">
<section class="hero"><div class="wrap">
  <div>
    <div class="sobre">${esc(d.cidade ?? "")}</div>
    <h1>${esc(d.titulo)}</h1>
    ${d.subtitulo ? `<p class="lead">${esc(d.subtitulo)}</p>` : ""}
    <form class="reserva" id="formReserva">
      <label>Entrada<input type="date" name="entrada" required></label>
      <label>Saída<input type="date" name="saida" required></label>
      <label>Adultos<select name="adultos">${[1, 2, 3, 4].map((n) => `<option${n === 2 ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <button class="btn prim">Ver preços${ic("seta")}</button>
    </form>
    <div class="garantias"><span>${ic("ok")}Reserva direta com o hotel</span><span>${ic("ok")}Resposta na hora, 24h</span><span>${ic("ok")}Pague por Pix ou cartão</span></div>
  </div>
  <div class="foto-hero">
    ${capa ? `<img src="${esc(capa)}" alt="Fachada do ${esc(d.nome)}" width="640" height="631" fetchpriority="high">` : ""}
    ${d.avaliacoes ? `<a class="nota" href="${esc(d.avaliacoes.url)}" target="_blank" rel="noopener"><b>${esc(d.avaliacoes.nota)}</b><span>Nota dos hóspedes<br>${esc(d.avaliacoes.total)} avaliações na ${esc(d.avaliacoes.fonte)}</span></a>` : ""}
  </div>
</div></section>

${d.destaques.length ? `<section style="padding-top:8px"><div class="wrap">
  <div class="destaques">${d.destaques.map(([i, t, x]) => `<div class="dest"><div class="ic">${ic(i)}</div><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join("")}</div>
</div></section>` : ""}

<section id="quartos"><div class="wrap">
  <div class="sobre">Acomodações</div>
  <h2>Escolha seu quarto</h2>
  <p class="lead">Preço e disponibilidade na hora pelo nosso assistente, para as suas datas.</p>
  <div class="quartos">${d.quartos.map((q) => `<article class="quarto">
    ${q.foto ? `<img src="${esc(q.foto)}" alt="${esc(q.nome)}" loading="lazy" width="640" height="400">` : ""}
    <div class="corpo"><h3>${esc(q.nome)}</h3><p>${esc(q.descricao)}</p>
      ${q.itens.length ? `<ul class="itens">${q.itens.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      <div class="rodape">${q.capacidade ? `<span class="cap">${ic("pessoas")}Até ${esc(q.capacidade)} pessoas</span>` : "<span></span>"}
        <button class="btn sec" type="button" data-chat="Quero reservar ${esc(q.nome)}">Ver preço</button></div></div>
  </article>`).join("")}</div>
  ${d.mensal ? `<div class="mensal"><div><h3>${esc(d.mensal.titulo)}</h3><p>${esc(d.mensal.texto)}</p></div>
    <button class="btn prim" type="button" data-chat="${esc(d.mensal.mensagem)}">Quero saber</button></div>` : ""}
</div></section>

${d.estrutura.length ? `<section id="estrutura" style="background:#fff"><div class="wrap">
  <div class="sobre">O hotel</div>
  <h2>Estrutura</h2>
  <div class="galeria">${d.estrutura.map((e) => `<figure>${e.foto ? `<img src="${esc(e.foto)}" alt="${esc(e.titulo)}" loading="lazy" width="480" height="640">` : ""}<figcaption><b>${esc(e.titulo)}</b>${esc(e.texto)}</figcaption></figure>`).join("")}</div>
</div></section>` : ""}

<section id="local"><div class="wrap">
  <div class="sobre">Onde estamos</div>
  <h2>Localização</h2>
  <div class="local">
    <div class="caixa">
      <h3 style="display:flex;gap:8px;align-items:center;color:var(--navy)">${ic("mapa")}${esc(d.endereco ?? d.cidade ?? "")}</h3>
      ${d.distancias.length ? `<ul class="dist">${d.distancias.map(([l, t]) => `<li><span>${esc(l)}</span><span>${esc(t)}</span></li>`).join("")}</ul>` : ""}
      ${d.mapa ? `<a class="btn sec" style="margin-top:16px" href="${esc(d.mapa)}" target="_blank" rel="noopener">Abrir no mapa</a>` : ""}
    </div>
    ${d.avaliacoes ? `<div class="caixa">
      <div class="avaliacao"><div class="grande">${esc(d.avaliacoes.nota)}</div>
        <div><h3 style="color:var(--navy)">O que dizem os hóspedes</h3><p style="margin:4px 0 0;color:var(--ink-2)">${esc(d.avaliacoes.total)} avaliações na ${esc(d.avaliacoes.fonte)}${d.avaliacoes.destaque ? `. ${esc(d.avaliacoes.destaque)}` : ""}.</p></div></div>
      <a class="btn sec" style="margin-top:18px" href="${esc(d.avaliacoes.url)}" target="_blank" rel="noopener">${ic("estrela")}Ver avaliações</a>
    </div>` : ""}
  </div>
</div></section>

${d.faq.length ? `<section id="duvidas" style="padding-top:0"><div class="wrap">
  <div class="sobre">Dúvidas</div>
  <h2>Perguntas frequentes</h2>
  <div class="faq">${d.faq.map(([p, r]) => `<details><summary>${esc(p)}</summary><p>${esc(r)}</p></details>`).join("")}</div>
  <p style="margin-top:18px"><button class="btn prim" type="button" data-chat="Tenho uma dúvida">Perguntar ao assistente</button></p>
</div></section>` : ""}
</main>

<footer><div class="wrap">
  <div><h3>${esc(d.nome)}</h3><p>${esc(d.endereco ?? "")}</p><p>Check-in a partir das ${esc(d.checkin)} · Check-out até as ${esc(d.checkout)}</p></div>
  <div><h3>Contato</h3>
    ${c.whatsapp ? `<p><a href="#" data-zap>WhatsApp ${esc(telBR(c.whatsapp))}</a></p>` : ""}
    ${c.telefone ? `<p><a href="tel:+${esc(tel(c.telefone))}">Telefone ${esc(telBR(c.telefone))}</a></p>` : ""}
    ${c.email ? `<p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : ""}</div>
  <div><h3>Siga</h3>${c.instagram ? `<p><a href="https://instagram.com/${esc(c.instagram)}" target="_blank" rel="noopener">Instagram @${esc(c.instagram)}</a></p>` : ""}</div>
</div></footer>

<div class="flutua">
  ${c.whatsapp ? `<button class="b-zap" type="button" data-zap aria-label="Falar no WhatsApp">${ic("zap")}</button>` : ""}
  <button class="b-chat" type="button" data-chat="">${ic("chat")}<span>Reservar pelo chat</span></button>
</div>
<div class="gaveta" id="gaveta" role="dialog" aria-modal="true" aria-label="Atendimento">
  <div class="fundo" data-fechar></div>
  <div class="painel"><div class="barra">${esc(d.nome)} · Atendimento<button class="fechar" type="button" data-fechar aria-label="Fechar">${ic("fechar")}</button></div></div>
</div>

<script src="/hotel.js"></script>
<script src="/rastreio.js"></script>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  window.rastreio?.visita("site");

  // Datas: entrada a partir de hoje, saída depois da entrada
  const f = $("#formReserva");
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const hoje = new Date(); f.entrada.min = iso(hoje);
  f.entrada.onchange = () => {
    const prox = new Date(f.entrada.value + "T12:00"); prox.setDate(prox.getDate() + 1);
    f.saida.min = iso(prox); if (!f.saida.value || f.saida.value <= f.entrada.value) f.saida.value = iso(prox);
  };
  const br = (v) => v.split("-").reverse().join("/");

  // Chat do assistente numa gaveta; a mesma conversa continua se a pessoa fechar e abrir de novo
  let quadro = null;
  function abrirChat(msg) {
    const g = $("#gaveta");
    if (!quadro || msg) {
      quadro?.remove();
      quadro = document.createElement("iframe");
      quadro.title = "Assistente de reservas";
      const u = new URL("/", location.href); u.searchParams.set("embed", "1");
      if (window.hotelAtual) u.searchParams.set("hotel", window.hotelAtual);
      if (msg) u.searchParams.set("msg", msg);
      quadro.src = u.pathname + u.search;
      g.querySelector(".painel").appendChild(quadro);
    }
    g.classList.add("aberta"); document.body.style.overflow = "hidden";
    window.rastreio?.evento("InitiateCheckout");
  }
  function fecharChat() { $("#gaveta").classList.remove("aberta"); document.body.style.overflow = ""; }

  f.onsubmit = (e) => {
    e.preventDefault();
    abrirChat(\`Quero reservar de \${br(f.entrada.value)} a \${br(f.saida.value)} para \${f.adultos.value} adulto\${f.adultos.value > 1 ? "s" : ""}\`);
  };
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-chat]");
    if (c) { e.preventDefault(); abrirChat(c.dataset.chat); return; }
    if (e.target.closest("[data-fechar]")) { fecharChat(); return; }
    if (e.target.closest("[data-zap]")) { e.preventDefault(); window.rastreio?.whatsapp("Olá! Vim pelo site e quero fazer uma reserva."); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharChat(); });
})();
</script>
</body>
</html>`;
}
