// Regras do back-office, sem acesso a banco (fáceis de testar).

const ATIVAS = new Set(["confirmada", "concluida"]);

// Estado de cada link gerado pelo assistente, do envio até a estadia
export function montarLocacoes(leads, cliques, reservas, hoje = new Date().toISOString().slice(0, 10)) {
  const clicados = new Map();
  for (const c of cliques) if (!clicados.has(c.lead_id) || c.em < clicados.get(c.lead_id)) clicados.set(c.lead_id, c.em);
  const porLead = new Map(reservas.filter((r) => r.lead_id).map((r) => [r.lead_id, r]));

  const doAssistente = leads.map((l) => {
    const reserva = porLead.get(l.id);
    let status;
    if (reserva) status = reserva.status;
    else if (l.checkin < hoje) status = "nao_convertido";
    else if (clicados.has(l.id)) status = "clicou";
    else status = "link_enviado";
    return {
      lead_id: l.id,
      origem: l.canal,
      conversa_id: l.conversa_id,
      quarto_id: l.quarto_id,
      checkin: l.checkin,
      checkout: l.checkout,
      hospedes: `${l.adultos}A${l.criancas ? ` + ${l.criancas}C` : ""}`,
      criado_em: l.criado_em,
      clicou_em: clicados.get(l.id) ?? null,
      codigo_motor: reserva?.codigo_motor ?? null,
      hospede: reserva?.hospede ?? null,
      valor: reserva?.valor != null ? Number(reserva.valor) : null,
      status,
    };
  });

  // Reservas lançadas à mão, sem link do assistente (balcão, telefone, portais)
  const manuais = reservas.filter((r) => !r.lead_id).map((r) => ({
    lead_id: null,
    origem: "manual",
    conversa_id: null,
    quarto_id: r.quarto_id,
    checkin: r.checkin,
    checkout: r.checkout,
    hospedes: null,
    criado_em: r.criado_em,
    clicou_em: null,
    codigo_motor: r.codigo_motor,
    hospede: r.hospede,
    valor: r.valor != null ? Number(r.valor) : null,
    status: r.status,
  }));

  return [...doAssistente, ...manuais].sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

// Ocupação por tipo de quarto numa data, com base nas reservas registradas aqui
export function disponibilidade(hotel, reservas, leads, data) {
  const ocupa = (r) => r.checkin <= data && data < r.checkout;
  const comReserva = new Set(reservas.map((r) => r.lead_id).filter(Boolean));
  return hotel.quartos.map((q) => {
    const ocupadas = reservas.filter((r) => r.quarto_id === q.id && ATIVAS.has(r.status) && ocupa(r)).length;
    const emProcesso = leads.filter((l) => l.quarto_id === q.id && !comReserva.has(l.id) && ocupa(l)).length;
    const unidades = q.unidades ?? 0;
    return {
      id: q.id,
      nome: q.nome,
      unidades,
      ocupadas,
      livres: Math.max(unidades - ocupadas, 0),
      em_processo: emProcesso,
      preco_a_partir: q.preco_a_partir,
      capacidade: `${q.capacidade_adultos} adultos / ${q.capacidade_total} pessoas`,
    };
  });
}

// Converte o histórico da API do Claude em falas legíveis
export function falas(mensagens = []) {
  const saida = [];
  for (const m of mensagens) {
    const blocos = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content ?? [];
    for (const b of blocos) {
      if (b.type === "text" && b.text?.trim()) saida.push({ autor: m.role === "user" ? "hospede" : "assistente", texto: b.text.trim() });
      if (b.type === "tool_use" && b.name === "gerar_link_reserva") {
        const i = b.input ?? {};
        saida.push({ autor: "sistema", texto: `Link de reserva: ${i.quarto_id}, ${i.checkin} a ${i.checkout}, ${i.adultos} adulto(s)${i.criancas ? ` e ${i.criancas} criança(s)` : ""}` });
      }
      if (b.type === "tool_use" && b.name === "chamar_atendente") saida.push({ autor: "sistema", texto: `Pediu atendente: ${b.input?.motivo ?? ""}` });
    }
  }
  return saida;
}

export function resumoAtendimento(c) {
  const f = falas(c.mensagens);
  const ultima = [...f].reverse().find((x) => x.autor !== "sistema");
  return {
    id: c.id,
    canal: c.canal,
    atualizado_em: c.atualizado_em,
    precisa_atendente: Boolean(c.precisa_atendente),
    motivo_atendente: c.motivo_atendente ?? null,
    mensagens: f.filter((x) => x.autor === "hospede").length,
    gerou_link: f.some((x) => x.texto.startsWith("Link de reserva")),
    ultima: ultima ? `${ultima.autor === "hospede" ? "Hóspede" : "Assistente"}: ${ultima.texto.slice(0, 140)}` : "",
  };
}

const COMISSAO_PORTAL = 0.15;

export function indicadores(atendimentos, locacoes) {
  const dias = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
  const confirmadas = locacoes.filter((l) => ATIVAS.has(l.status));
  const doAssistente = confirmadas.filter((l) => l.lead_id);
  const receita = doAssistente.reduce((s, l) => s + (l.valor ?? 0), 0);
  const links = locacoes.filter((l) => l.lead_id);
  return {
    atendimentos_7d: atendimentos.filter((a) => a.atualizado_em >= dias(7)).length,
    aguardando_atendente: atendimentos.filter((a) => a.precisa_atendente).length,
    links_gerados: links.length,
    links_clicados: links.filter((l) => l.clicou_em).length,
    em_processo: locacoes.filter((l) => ["link_enviado", "clicou"].includes(l.status)).length,
    reservas_confirmadas: confirmadas.length,
    reservas_do_assistente: doAssistente.length,
    conversao: links.length ? +(doAssistente.length / links.length).toFixed(3) : 0,
    receita_assistente: +receita.toFixed(2),
    comissao_economizada: +(receita * COMISSAO_PORTAL).toFixed(2),
  };
}
