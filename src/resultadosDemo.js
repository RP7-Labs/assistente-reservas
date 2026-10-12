// Dados de DEMONSTRAÇÃO para o painel de resultados (nada disso é real nem vai para o banco).
// Servem só para ver o painel funcionando antes de importar os relatórios de verdade.

function aleatorio(semente) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const iso = (d) => d.toISOString().slice(0, 10);
const somaDias = (base, n) => new Date(Date.parse(base) + n * 86_400_000);

export function dadosDemo(hoje = iso(new Date())) {
  const rnd = aleatorio(20261012);
  const ini = iso(somaDias(hoje, -119));
  const campanhas = [
    { plataforma: "google", id: "1101", nome: "Pesquisa - Hotel Balneário Camboriú", cpc: 1.9, ctr: 0.07, conv: 0.035, diario: 30 },
    { plataforma: "google", id: "1102", nome: "Pesquisa - Studio mensal", cpc: 2.6, ctr: 0.05, conv: 0.012, diario: 15 },
    { plataforma: "meta", id: "2201", nome: "Leads - Studio mensal", cpc: 0.9, ctr: 0.012, conv: 0.004, diario: 30 },
    { plataforma: "meta", id: "2202", nome: "Tráfego - Verão", cpc: 0.6, ctr: 0.015, conv: 0.002, diario: 12 },
    { plataforma: "meta", id: "2203", nome: "Remarketing - Visitantes do site", cpc: 0.8, ctr: 0.02, conv: 0.02, diario: 6 },
  ];
  const midia = [], reservas = [], leads = [], origens = [], conversas = [], visitas = [], externas = [];
  let n = 0;
  for (let d = 0; d < 120; d++) {
    const data = iso(somaDias(ini, d));
    for (const c of campanhas) {
      const custo = Math.round(c.diario * (0.75 + rnd() * 0.5) * 100) / 100;
      const cliques = Math.round(custo / c.cpc);
      const impressoes = Math.round(cliques / c.ctr);
      const conv = c.plataforma === "meta" && c.id === "2201" ? Math.round(cliques * 0.08) : Math.round(cliques * c.conv * 1.6);
      midia.push({ plataforma: c.plataforma, data, campanha_id: c.id, campanha: c.nome, grupo_id: "", anuncio_id: "", impressoes, cliques, custo, conversoes_plataforma: conv, valor_plataforma: null });
      for (let k = 0; k < cliques; k++) {
        const visitante = `demo-${++n}`;
        const origem = c.plataforma === "google" ? { utm_source: "google", utm_medium: "cpc", utm_campaign: c.id, gclid: `g${n}` } : { utm_source: "meta", utm_medium: "paid_social", utm_campaign: c.id, fbclid: `f${n}` };
        if (rnd() < 0.6) visitas.push({ visitante, utm_source: origem.utm_source, utm_medium: origem.utm_medium, utm_campaign: c.id, referrer: null, criado_em: `${data}T12:00:00Z` });
        if (rnd() < 0.09) {
          const conversa = `demo-c${n}`;
          conversas.push({ id: conversa, criado_em: `${data}T13:00:00Z` });
          origens.push({ conversa_id: conversa, ...origem });
          if (rnd() < c.conv / 0.09) {
            const noites = c.id === "1102" || c.id === "2201" ? 28 : 1 + Math.floor(rnd() * 4);
            const checkin = iso(somaDias(data, 3 + Math.floor(rnd() * 40)));
            const lead = { id: `demo-l${n}`, conversa_id: conversa, criado_em: `${data}T13:10:00Z` };
            leads.push(lead);
            const diaria = noites >= 28 ? 80 : 150 + Math.round(rnd() * 120);
            const status = rnd() < 0.08 ? "cancelada" : "confirmada";
            reservas.push({ codigo_motor: `DEMO-${n}`, lead_id: lead.id, quarto_id: noites >= 28 ? "estudio" : "suite", checkin, checkout: iso(somaDias(checkin, noites)), valor: diaria * noites, status, criado_em: `${data}T13:30:00Z` });
          }
        }
      }
    }
    // Orgânico e direto
    for (let k = 0; k < 25; k++) visitas.push({ visitante: `demo-o${d}-${k}`, utm_source: k % 3 ? null : "instagram", referrer: k % 3 ? "https://www.google.com/" : null, criado_em: `${data}T10:00:00Z` });
    // PMS: OTAs e reservas diretas sem origem rastreada
    const nPms = Math.floor(rnd() * 4);
    for (let k = 0; k < nPms; k++) {
      const canal = rnd() < 0.65 ? (rnd() < 0.8 ? "Booking.com" : "Expedia") : rnd() < 0.5 ? "Site (motor)" : "Balcão";
      const noites = 1 + Math.floor(rnd() * 4);
      const checkin = iso(somaDias(data, 2 + Math.floor(rnd() * 30)));
      const bruto = (160 + Math.round(rnd() * 140)) * noites;
      externas.push({ fonte: "pms", codigo: `PMS-${d}-${k}`, data_reserva: data, checkin, checkout: iso(somaDias(checkin, noites)), noites, categoria: "Suíte", valor_bruto: bruto, desconto: 0, valor_liquido: null, canal, status: rnd() < 0.1 ? "cancelada" : "confirmada" });
    }
  }
  // Quase todas as reservas do assistente também aparecem no PMS com o mesmo código (conciliação)
  reservas.forEach((r, i) => { if (i % 10 !== 9) externas.push({ fonte: "pms", codigo: r.codigo_motor, data_reserva: r.criado_em.slice(0, 10), checkin: r.checkin, checkout: r.checkout, noites: null, categoria: r.quarto_id, valor_bruto: r.valor, desconto: 0, valor_liquido: null, canal: "Site", status: r.status }); });
  const importacoes = [
    { tipo: "google", criado_em: `${hoje}T08:00:00Z` }, { tipo: "meta", criado_em: `${hoje}T08:00:00Z` }, { tipo: "pms", criado_em: `${hoje}T08:00:00Z` },
  ];
  return { midia, reservas, leads, origens, conversas, visitas, externas, importacoes };
}
