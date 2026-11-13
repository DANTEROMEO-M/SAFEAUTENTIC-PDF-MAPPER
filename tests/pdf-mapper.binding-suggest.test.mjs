import test from "node:test";
import assert from "node:assert/strict";
import { normalizeItem, groupTextRuns } from "../js/pdf-mapper/pdf-text.mjs";
import { suggestBindings, proposeMappings, mappingStatus, isConstancia, CONCEPTS, conceptsFor } from "../js/pdf-mapper/binding-suggest.mjs";

/* Una constancia de cliente típica, llena con su ejemplo (hoja carta
 * horizontal). Los anchos son los de Helvetica/Times a ese tamaño. */
const W = 792;
const item = (str, x, y, size, width, name = "Helvetica") => normalizeItem({ str, transform: [size, 0, 0, size, x, y], width, fontName: name }, { font: { name } });
const centered = (str, y, size, width, name) => item(str, W / 2 - width / 2, y, size, width, name);
const runs = groupTextRuns([
  centered("CONSTANCIA DE PARTICIPACIÓN", 520, 24, 400, "Helvetica-Bold"),
  centered("Se otorga la presente a:", 470, 12, 130),
  centered("JUAN PÉREZ HERNÁNDEZ", 430, 22, 279, "Times-Bold"),
  centered("Por haber concluido satisfactoriamente el curso", 390, 12, 262),
  centered("PRIMEROS AUXILIOS NIVEL BÁSICO", 362, 16, 280, "Helvetica-Bold"),
  item("Duración: 8 horas", 120, 300, 11, 92),
  item("Fecha: 12 de marzo de 2026", 120, 282, 11, 142),
  item("Instructor: Ing. Laura Gómez Ruiz", 470, 150, 11, 175),
  item("Folio: ACM-000451", 640, 40, 9, 80)
]);
const run = text => runs.find(r => r.text === text);
const top = text => suggestBindings([run(text)], { runs, pageWidth: W })[0];

test("el nombre bajo «Se otorga la presente a:» es el participante, con confianza alta y razones", () => {
  const s = top("JUAN PÉREZ HERNÁNDEZ");
  assert.equal(s.path, "record.nombre");
  assert.equal(s.confidence, "alta");
  assert.equal(s.template, null);
  assert.deepEqual(s.reasons, ["está debajo de «Se otorga la presente a:»", "tiene forma de nombre de persona", "es el nombre más destacado de la hoja"]);
});

test("el título bajo «…el curso» es el curso, aunque también parezca un nombre", () => {
  const all = suggestBindings([run("PRIMEROS AUXILIOS NIVEL BÁSICO")], { runs, pageWidth: W });
  assert.equal(all[0].path, "record.nombreCurso");
  assert.equal(all[0].confidence, "alta");
});

test("otra columna de la tabla no es etiqueta; «Nombre:» con tabulación sí lo es", () => {
  /* Acta exportada de Word: «Nombre ⇥ Puesto ⇥ Firma» (columnas a ~100 pt). */
  const table = groupTextRuns([item("Nombre", 172.8, 492, 10, 35.7), item("Puesto", 316.3, 492, 10, 31.1), item("Firma", 434.3, 492, 10, 25.7),
    item("C.", 72, 120, 12, 9), item("C.", 330, 120, 12, 9),
    item("Nombre:", 72, 300, 11, 40), item("Ana López Ruiz", 200, 300, 11, 80)]);
  const sug = text => suggestBindings([table.find(r => r.text === text && (text !== "C." || r.x > 100))], { runs: table, pageWidth: 612 });
  assert.deepEqual(sug("Puesto"), [], "«Puesto» no es el nombre del participante");
  assert.deepEqual(sug("C."), []);
  assert.equal(sug("Ana López Ruiz")[0]?.path, "record.nombre", "con «:» la etiqueta vale aunque esté lejos");
});

test("etiqueta y dato en el mismo renglón: plantilla que conserva el texto fijo", () => {
  assert.deepEqual([top("Duración: 8 horas").path, top("Duración: 8 horas").template], ["record.duracion", "Duración: {record.duracion} horas"]);
  assert.equal(top("Fecha: 12 de marzo de 2026").template, "Fecha: {record.fecha}");
  assert.equal(top("Folio: ACM-000451").template, "Folio: {record.folio}");
  assert.equal(top("Instructor: Ing. Laura Gómez Ruiz").template, "Instructor: {record.instructor}");
});

test("los textos fijos de la constancia no reciben sugerencias", () => {
  for (const t of ["CONSTANCIA DE PARTICIPACIÓN", "Se otorga la presente a:", "Por haber concluido satisfactoriamente el curso"]) {
    assert.deepEqual(suggestBindings([run(t)], { runs, pageWidth: W }), [], t);
  }
});

test("la forma basta para una fecha o unas horas sueltas (confianza media)", () => {
  const lone = groupTextRuns([item("5 de septiembre de 2026", 100, 100, 10, 110), item("40 horas", 400, 300, 10, 40)]);
  const fecha = suggestBindings([lone[1]], { runs: lone, pageWidth: W })[0];
  assert.deepEqual([fecha.path, fecha.confidence], ["record.fecha", "media"]);
  const horas = suggestBindings([lone[0]], { runs: lone, pageWidth: W })[0];
  assert.deepEqual([horas.path, horas.template], ["record.duracion", "{record.duracion} horas"]);
});

test("propuesta de la página: un renglón por elemento, en el orden de la constancia", () => {
  const p = proposeMappings(runs, { pageWidth: W });
  assert.deepEqual(p.map(x => [x.concept, x.run.text]), [
    ["participante", "JUAN PÉREZ HERNÁNDEZ"], ["curso", "PRIMEROS AUXILIOS NIVEL BÁSICO"], ["fecha", "Fecha: 12 de marzo de 2026"],
    ["folio", "Folio: ACM-000451"], ["duracion", "Duración: 8 horas"], ["instructor", "Instructor: Ing. Laura Gómez Ruiz"]
  ]);
  /* Lo ya vinculado o tapado no se vuelve a proponer. */
  const again = proposeMappings(runs, { pageWidth: W, fields: [{ id: "nombre", dataKey: "record.nombre" }], isCovered: r => r.text.startsWith("Folio") });
  assert.ok(!again.some(x => x.concept === "participante" || x.concept === "folio"));
});

test("lista de elementos: obligatorios, QR y firma; una variante «constancia-…» es constancia", () => {
  assert.equal(isConstancia({ id: "constancia-acme" }), true);
  assert.equal(isConstancia({ id: "carta-especial" }), false);
  const doc = { id: "constancia-acme", fields: [
    { id: "nombre", type: "text", dataKey: "record.nombre" },
    { id: "duracion", type: "text", textTemplate: "Duración: {record.duracion} horas" },
    { id: "qr", type: "qr", dataKey: "qrImage" }
  ] };
  const st = Object.fromEntries(mappingStatus(doc).map(s => [s.concept, s]));
  assert.equal(st.participante.done, true); assert.equal(st.participante.fieldId, "nombre");
  assert.equal(st.duracion.done, true, "la plantilla de texto también cuenta");
  assert.equal(st.qr.done, true);
  assert.equal(st.firma.done, false); assert.equal(st.firma.tool, "image");
  assert.equal(st.curso.done, false); assert.equal(st.curso.required, true);
  assert.equal(st.sello.required, false);
  assert.equal(st.instructor, undefined, "un elemento opcional sin usar no se lista");
  assert.ok(CONCEPTS.every(c => c.path));
});

/* Carta de cumplimiento exportada de Word (PRUEBASCARTAS, «EPP»): posiciones
   medidas en el PDF real. Las cartas usan los datos que la emisión de cartas
   entrega, no los de una constancia. */
test("cartas: fecha, razón social, domicilio y firmas con los datos de cartas", () => {
  const T = "TimesNewRomanPSMT", TB = "TimesNewRomanPS-BoldMT";
  const letter = groupTextRuns([
    item("Ciudad de México, a 19 de septiembre de 2024.", 330, 703, 12, 230, T),
    item("Por medio de la presente me permito informarle a usted que nuestro establecimiento con razón social", 72, 546, 12, 470, T),
    item("FIDEICOMISO DE ADMINISTRACION F/750323", 72, 532, 12, 260, TB),
    item("y con domicilio en", 335, 532, 12, 90, T),
    item("AVENIDA PROLONGACION", 425, 532, 12, 140, TB),
    item("REPRESENTANTE LEGAL", 115, 240, 10, 120, TB), item("RESPONSABLE OFICIAL DE", 358, 240, 10, 140, TB),
    item("C.", 63, 159, 10, 9, TB), item("C.", 312, 159, 10, 9, TB),
    item("Itziar de Luisa Plazas", 117, 147, 11, 105, T), item("Ing. Sergio Gómez de la Cruz", 363, 147, 11, 135, T)
  ]);
  const concepts = conceptsFor({ id: "carta-epp" });
  const got = Object.fromEntries(proposeMappings(letter, { pageWidth: 612, concepts }).map(p => [p.path, [p.run.text, p.template]]));
  assert.deepEqual(got["record.fechaCdmx"], ["Ciudad de México, a 19 de septiembre de 2024.", "Ciudad de México, a {record.fechaCdmx}."], "conserva el lugar y sólo cambia la fecha");
  assert.equal(got["record.razonSocial"][0], "FIDEICOMISO DE ADMINISTRACION F/750323");
  assert.equal(got["record.municipio"][0], "AVENIDA PROLONGACION");
  assert.equal(got["record.nombreCliente"][0], "Itziar de Luisa Plazas", "firma bajo «REPRESENTANTE LEGAL»");
  assert.equal(got["profile.nombreConsultor"][0], "Ing. Sergio Gómez de la Cruz", "firma bajo «RESPONSABLE OFICIAL»");
  assert.ok(!Object.keys(got).some(p => /record\.(nombre|nombreCurso|folio)$/.test(p)), "nada de datos de constancia en una carta");
});

test("cartas: el paréntesis dice qué dato pide; una etiqueta con «:» no es dato", () => {
  const letter = groupTextRuns([
    item("El que suscribe", 72, 496, 10, 70), item("(Nombre del Responsable Oficial de Protección Civil)", 145, 496, 10, 240, "Times-Bold"),
    item("Representante Legal:", 72, 613, 11, 100), item("Número de Trabajadores:", 72, 591, 11, 120)
  ]);
  const concepts = conceptsFor({ id: "carta" });
  const top = text => suggestBindings([letter.find(r => r.text === text)], { runs: letter, pageWidth: 612, concepts })[0];
  assert.equal(top("(Nombre del Responsable Oficial de Protección Civil)").path, "profile.nombreConsultor");
  assert.equal(top("Número de Trabajadores:"), undefined);
  assert.equal(conceptsFor({ id: "constancia-acme" }).some(c => c.path === "record.nombre"), true, "las constancias siguen igual");
  assert.equal(conceptsFor({ id: "dc3" }).some(c => c.path === "record.nombre"), true);
});

/* Campos del formulario de la plataforma por documento: una DC-3 con las
   etiquetas oficiales de la STPS ARRIBA de cada casilla, y una carta
   responsiva. Cada dato debe caer en SU casilla. */
{
  const { normalizeItem: ni, groupTextRuns: gtr } = await import("../js/pdf-mapper/pdf-text.mjs");
  const { proposeMappings: pm, conceptsFor: cf, suggestBindings: sb } = await import("../js/pdf-mapper/binding-suggest.mjs");
  const at = (str, x, y, size = 8) => ni({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, fontName: "Helvetica" }, { font: { name: "Helvetica" } });
  const dc3 = gtr([
    at("Nombre (Anotar apellido paterno, apellido materno y nombre (s))", 40, 610), at("XXXXXXXXXXXXXXX", 40, 596, 11),
    at("Clave Única de Registro de Población", 40, 572), at("Ocupación específica (Catálogo Nacional de Ocupaciones)", 310, 572),
    at("XXXXXXXXXXXXXXXXXX", 40, 559, 9), at("XXXXXXXX", 310, 559, 9),
    at("Puesto*", 40, 546), at("XXXXXXXXXX", 40, 533, 11),
    at("Nombre o razón social (En caso de persona física anotar apellido paterno, apellido materno y nombre(s))", 40, 492), at("XXXXXXXXXXXXX", 40, 479, 11),
    at("Registro Federal de Contribuyentes con homoclave (SHCP)", 40, 456), at("XXXXXXXXXXXXX", 40, 443, 10),
    at("Nombre del curso", 40, 410), at("XXXXXXXXXXXXXXX", 40, 397, 10),
    at("Duración en horas", 40, 384), at("XX", 40, 371, 10),
    at("Área temática del curso", 40, 353), at("XXXXXXXXXX", 40, 340, 10),
    at("Nombre del agente capacitador o STPS", 40, 328), at("XXXXXXXXXXXXX", 40, 315, 9.5),
    at("Instructor o tutor", 60, 245), at("Patrón o representante legal", 220, 245), at("Representante de los trabajadores", 390, 245),
    at("XXXXXXXXXX", 60, 226, 8.2), at("XXXXXXXXXXX", 220, 226, 8.2), at("XXXXXXXXXXXX", 390, 226, 8.2)
  ]);

  test("DC-3: cada dato del formulario cae en su casilla, bajo su etiqueta oficial", () => {
    const got = Object.fromEntries(pm(dc3, { pageWidth: 612, concepts: cf({ id: "dc3" }) }).map(p => [p.path, `${Math.round(p.run.box.x0)},${Math.round(p.run.y)}`]));
    assert.deepEqual(got, {
      "record.nombre": "40,596", "record.curp": "40,559", "record.ocupacion": "310,559", "record.puesto": "40,533",
      "record.empresa": "40,479", "record.rfc": "40,443", "record.nombreCurso": "40,397", "record.duracion": "40,371",
      "record.area": "40,340", "record.agente": "40,315",
      "record.instructor": "60,226", "record.patron": "220,226", "record.representanteTrabajadores": "390,226"
    });
  });

  test("DC-3: una CURP escrita se reconoce por su forma", () => {
    const runs = gtr([at("Clave Única de Registro de Población", 40, 572), at("PEJJ900101HDFRXN01", 40, 559, 9)]);
    const top = sb([runs[1]], { runs, concepts: cf({ id: "dc3" }) })[0];
    assert.equal(top.path, "record.curp");
    assert.ok(top.reasons.includes("tiene forma de CURP"));
  });

  test("carta responsiva: razón social, domicilio, factura, fecha y alcance", () => {
    const runs = gtr([
      at("Razón social:", 40, 600, 11), at("XXXXXXXXXXXXXXXXX", 140, 600, 11),
      at("Domicilio:", 40, 580, 11), at("XXXXXXXXXXXXXXXXXXXXXX", 140, 580, 11),
      at("Factura:", 40, 560, 11), at("XXXXXX", 140, 560, 11),
      at("Toluca, Estado de México, a XX de XXXXX de XXXX.", 300, 700, 11),
      at("Alcance del servicio:", 40, 540, 11), at("XXXXXXXXXXXXXXXXXXXX", 170, 540, 11)
    ]);
    const got = Object.fromEntries(pm(runs, { pageWidth: 612, concepts: cf({ id: "carta-responsiva" }) }).map(p => [p.path, Math.round(p.run.y)]));
    assert.deepEqual(got, { "record.razonSocial": 600, "record.domicilio": 580, "record.factura": 560, "record.fecha": 700, "record.alcanceServicio": 540 });
  });

  test("cada juego de conceptos usa claves que el formulario de su documento entrega", async () => {
    const { classifyDataPath } = await import("../js/pdf-mapper/data-catalog.mjs");
    for (const [doc, catalogo] of [["dc3", "dc3"], ["carta-responsiva", "carta-responsiva"], ["constancia", "constancia"]])
      for (const c of cf({ id: doc }).filter(c => c.kind === "text"))
        assert.notEqual(classifyDataPath(c.path, catalogo).status, "new", `${doc}: ${c.path} no existe en la plataforma`);
  });
}
