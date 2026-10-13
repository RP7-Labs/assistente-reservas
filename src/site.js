// Conteúdo público do site do hotel (/site): textos do bloco "site" do hotel.json,
// mais o que já existe no catálogo (quartos) e no guia (fotos, contato, estrutura).
export function dadosSite(hotel) {
  const g = hotel.guia ?? {};
  const s = hotel.site ?? {};
  return {
    nome: g.marca ?? hotel.nome,
    titulo: s.titulo ?? hotel.nome,
    subtitulo: s.subtitulo ?? null,
    cidade: hotel.cidade,
    checkin: hotel.checkin,
    checkout: hotel.checkout,
    endereco: g.endereco ?? null,
    mapa: g.mapa ?? null,
    contato: g.contato ?? null,
    empresa: hotel.empresa ? { razao_social: hotel.empresa.razao_social ?? null, cnpj: hotel.empresa.cnpj ?? null, endereco: hotel.empresa.endereco ?? null } : null,
    fotos: g.fotos ?? {},
    destaques: s.destaques ?? [],
    quartos: (s.quartos ?? hotel.quartos.map((q) => ({ id: q.id }))).map((q) => {
      const c = hotel.quartos.find((x) => x.id === q.id) ?? {};
      return {
        id: q.id, nome: q.nome ?? c.nome, descricao: q.descricao ?? c.descricao, capacidade: c.capacidade_total ?? null,
        foto: g.fotos?.[q.foto] ?? g.fotos?.quarto ?? null, itens: q.itens ?? [], mensal: Boolean(c.preco_mensal),
      };
    }),
    mensal: s.mensal ?? null,
    estrutura: (g.estrutura ?? []).map(([foto, titulo, texto]) => ({ titulo, texto, foto: g.fotos?.[foto] ?? null })),
    distancias: s.distancias ?? [],
    avaliacoes: s.avaliacoes ?? null,
    faq: s.faq ?? [],
    estacionamento: g.estacionamento ?? null,
  };
}
