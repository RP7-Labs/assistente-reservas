import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LOCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ical-")), "db.json");
delete process.env.SUPABASE_URL;
const { lerIcal, intervalos, gerarIcal, noitesFechadas, urlValida } = await import("../src/ical.js");
const { sincronizarCanal, calendarioExportado } = await import("../src/canais.js");
const { disponibilidade } = await import("../src/backoffice.js");
const store = await import("../src/store.js");

// Formato que o Airbnb exporta (reserva e bloqueio manual)
const AIRBNB = [
  "BEGIN:VCALENDAR", "PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN", "VERSION:2.0",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20261112", "DTSTART;VALUE=DATE:20261110", "UID:1418fb94e984-abc@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC\\nPhone Number (La", " st 4 Digits): 1234",
  "SUMMARY:Reserved", "END:VEVENT",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20261003", "DTSTART;VALUE=DATE:20261001", "UID:old@airbnb.com", "SUMMARY:Reserved", "END:VEVENT",
  "BEGIN:VEVENT", "DTEND;VALUE=DATE:20261226", "DTSTART;VALUE=DATE:20261224", "UID:x@airbnb.com", "SUMMARY:Airbnb (Not available)", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");

test("lê o iCal do Airbnb com linhas dobradas", () => {
  const ev = lerIcal(AIRBNB);
  assert.equal(ev.length, 3);
  assert.deepEqual(ev[0], { uid: "1418fb94e984-abc@airbnb.com", inicio: "2026-11-10", fim: "2026-11-12", resumo: "Reserved" });
  assert.equal(ev[2].resumo, "Airbnb (Not available)");
});

test("junta noites em intervalos e gera um .ics que a própria leitura entende", () => {
  const iv = intervalos(["2026-12-24", "2026-12-25", "2026-12-31", "2026-12-24"]);
  assert.deepEqual(iv, [{ inicio: "2026-12-24", fim: "2026-12-26" }, { inicio: "2026-12-31", fim: "2027-01-01" }]);
  const ics = gerarIcal({ nome: "Hotel · Suíte", fechados: iv });
  assert.match(ics, /DTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261226/);
  assert.deepEqual(lerIcal(ics).map((e) => [e.inicio, e.fim]), [["2026-12-24", "2026-12-26"], ["2026-12-31", "2027-01-01"]]);
});

test("exporta só as noites lotadas, ignorando os bloqueios do próprio canal", () => {
  const quarto = { id: "suite", unidades: 2 };
  const reservas = [{ quarto_id: "suite", status: "confirmada", checkin: "2026-11-10", checkout: "2026-11-12" }];
  const bloqueios = [
    { canal_id: "a", quarto_id: "suite", checkin: "2026-11-11", checkout: "2026-11-13" },
    { canal_id: "b", quarto_id: "suite", checkin: "2026-11-10", checkout: "2026-11-11" },
  ];
  // Para o canal "b": reserva + bloqueio do "a" lotam só a noite 11
  assert.deepEqual(noitesFechadas({ quarto, reservas, bloqueios, canalId: "b", hoje: "2026-11-09", dias: 6 }), ["2026-11-11"]);
  // Para o canal "a": reserva + bloqueio do "b" lotam a noite 10
  assert.deepEqual(noitesFechadas({ quarto, reservas, bloqueios, canalId: "a", hoje: "2026-11-09", dias: 6 }), ["2026-11-10"]);
});

test("só aceita links https públicos", () => {
  assert.ok(urlValida("https://www.airbnb.com.br/calendar/ical/123.ics?s=abc"));
  assert.ok(!urlValida("http://www.airbnb.com/x.ics"));
  assert.ok(!urlValida("https://localhost/x.ics"));
  assert.ok(!urlValida("https://169.254.169.254/latest"));
  assert.ok(!urlValida("https://10.0.0.1/x.ics"));
});

test("sincroniza o canal, bloqueia a disponibilidade e mantém os bloqueios se o Airbnb falhar", async () => {
  const canal = await store.salvarCanal({ id: "c1", nome: "Airbnb · Suíte 1", quarto_id: "suite", url_importar: "https://www.airbnb.com/calendar/ical/1.ics?s=x", token_exportar: "tok123" });
  const ok = async () => ({ ok: true, text: async () => AIRBNB });
  const r = await sincronizarCanal(canal, { hoje: "2026-10-06", buscarFn: ok });
  assert.deepEqual(r, { id: "c1", ok: true, bloqueios: 2 }); // a reserva de 01/10 já passou
  const bloqueios = await store.listarBloqueios();
  const hotel = { quartos: [{ id: "suite", nome: "Suíte", unidades: 1 }] };
  assert.equal(disponibilidade(hotel, [], [], "2026-11-10", bloqueios)[0].livres, 0);
  assert.equal(disponibilidade(hotel, [], [], "2026-11-12", bloqueios)[0].livres, 1);

  const falha = async () => ({ ok: false, status: 503, text: async () => "" });
  const r2 = await sincronizarCanal((await store.listarCanais())[0], { hoje: "2026-10-06", buscarFn: falha });
  assert.equal(r2.ok, false);
  assert.equal((await store.listarBloqueios()).length, 2);
  assert.match((await store.listarCanais())[0].erro, /503/);

  // O calendário exportado para esse anúncio não devolve as reservas dele mesmo
  const ics = await calendarioExportado("tok123", "2026-10-06");
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.doesNotMatch(ics, /20261110/);
  assert.equal(await calendarioExportado("errado"), null);
});
