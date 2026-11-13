# PDF Mapper

**Convierte cualquier PDF o Word en una plantilla con datos: colócalos con el
mouse, revísalos con una vista previa real y obtén el código listo para
pdf-lib. Todo en el navegador, sin servidor.**

PDF Mapper es el editor de plantillas de [SafeAutentic](https://safeautenticmx.web.app/),
la plataforma para consultorías de Protección Civil en México. Con él, las
constancias, cartas, formatos DC-3 y cotizaciones de cada consultoría se
preparan sin escribir coordenadas a mano. Aquí se publica como módulo
independiente: sin inicio de sesión ni base de datos, para usarlo con tus
propios documentos.

> Los archivos se leen en tu navegador y no se suben a ningún servidor.

---

## Capacidades

### Importar cualquier documento
- **PDF:** de una o varias páginas, de cualquier tamaño u orientación.
- **Word (.docx)**, de dos formas:
  - **Carta editable:** el texto sigue fluyendo y se edita. Antes de abrirla se
    revisa a qué dato se vincula cada marca del Word: resaltados, «XXX»,
    «(instrucciones)» y campos de combinar correspondencia.
  - **Plantilla PDF:** el Word se convierte en un PDF fijo y se mapea como
    cualquier PDF.
- **Fotos y escaneos** (JPG, PNG, WebP): se convierten en una página PDF y sus
  textos se leen con **OCR** en el navegador (tesseract.js, español).
- **PDF cifrados** (protegidos contra cambios): se desbloquean con la contraseña
  de propietario o con la declaración de que se tiene derecho a modificarlos.
  Soporta RC4 de 40 y 128 bits, AES-128 y AES-256 (revisiones R2 a R6).
  Se trabaja sobre una copia; el original no cambia.
- **Formularios PDF (AcroForm):** sus campos se importan como campos editables,
  con su posición y tamaño reales.
- **Lotes:** detecta cuando un PDF repite la misma constancia en cada página y
  ofrece usar sólo la primera como plantilla.
- **Proyectos `.zip`** del propio mapper, para seguir editando donde te quedaste.
- Arrastrar y soltar el archivo en cualquier parte del editor.

### Vincular datos
- **Textos del PDF:** clic en un texto de la plantilla para vincularlo con un
  dato, corregirlo o borrarlo. El texto original se retira del contenido del
  PDF (o se tapa con una máscara de respaldo).
- **Mapeo sugerido:** propone qué dato va en cada texto (nombre, curso, fechas,
  folio, empresa…) y dónde colocar el QR, la firma y el sello digital, con un
  nivel de confianza para cada propuesta.
- **Reubicar un mapeo:** cuando cambia el membrete, los campos de la plantilla
  anterior se colocan solos sobre el texto equivalente del PDF nuevo.
- **Pasos guiados** con los elementos obligatorios que faltan en cada documento.
- **Herramientas de dibujo:** texto, casillas de caracteres (CURP, RFC, fechas),
  casilla de verificación, código QR, imagen o firma, y regla para medir.
- **Ajuste automático:** el texto se reduce o se reparte en varias líneas para
  caber en su caja; alineación a la izquierda, centrada en la página o en la
  caja, o a la derecha.
- **Fuentes propias** (TTF/OTF) o las estándar de PDF, detectando la fuente
  original del documento.
- Rejilla y snapping, deshacer/rehacer, zoom, reglas en pt, mm o pulgadas, y atajos
  de teclado.

### Revisar antes de usar
- **Vista previa real:** el PDF final se genera con pdf-lib, no se aproxima con
  CSS.
- **Comparar con el original:** se ve si cada dato cae donde estaba el ejemplo.
- **Juegos de datos de muestra** y **textos largos** con el peor caso realista
  (nombres compuestos, razones sociales completas, direcciones extensas).
- **Preflight:** avisa de textos que no caben, márgenes que no se imprimen,
  bajo contraste, campos encimados y QR demasiado pequeños, con correcciones
  automáticas seguras.
- **Probar y aprobar:** corre la plantilla con todos los juegos de datos y
  guarda versiones aprobadas que se pueden comparar y restaurar.

### Exportar
- **Mapa de campos** y **código de dibujo para pdf-lib**, listos para pegar.
- **Paquete `.zip`** con la plantilla, las fuentes, el código, el proyecto y un
  **resumen para IA** con los cambios.
- **PDF de prueba** con los datos de ejemplo.

### Carta con formato
Un editor de cartas con párrafos, títulos, listas, tablas, sangrías, negritas,
tamaños y bloque de firmas. Los datos se escriben como `{{ruta}}` y la vista
previa los llena. Se puede usar un membrete PDF de fondo y exportar la carta
como JSON.

---

## Privacidad y seguridad
- Todo se procesa en el navegador. No hay servidor, cuentas ni base de datos.
- Plantillas, borradores y fuentes se guardan sólo en ese navegador
  (localStorage e IndexedDB).
- Las únicas descargas externas son las librerías públicas (pdf-lib, pdf.js,
  qrcode, tesseract.js) y las tipografías de Google Fonts.

## Uso

Requiere [Node.js](https://nodejs.org/) 20 o superior. No hay dependencias que
instalar.

```bash
npm start
```

Abre <http://127.0.0.1:5179>. Para otro puerto: `PORT=8080 npm start`.
El mapper arranca sin documentos y abre «Importar»: empieza con tu propio PDF o
Word.

También funciona con cualquier servidor estático, siempre que sirva la carpeta
desde la raíz del dominio (la página usa rutas absolutas).

## Pruebas

```bash
npm test
```

## Estructura

| Ruta | Contenido |
| --- | --- |
| `index.html` | La aplicación: interfaz y orquestación. |
| `js/pdf-mapper/` | Módulos del mapper: lectura de texto del PDF, motor de dibujo, sugerencias de mapeo, OCR, descifrado, versiones, paquete de proyecto y carta con formato. |
| `js/clientes/` | Editor de redacción y lector de Word que usa la carta con formato. |
| `js/shared/document-data.mjs` | Sintaxis de los datos `{{ruta}}`. |
| `css/doc-editor.css` | Estilos del editor de la carta. |
| `config/client/templates/` | Carpeta reservada para plantillas PDF; no se publica nada de ella. |
| `tests/` | Pruebas con `node --test`. |
| `tools/serve.mjs` | Servidor estático local, sin dependencias. |

## Tecnología

JavaScript moderno en módulos ES, sin frameworks ni paso de compilación.
[pdf-lib](https://pdf-lib.js.org/) para generar PDF,
[pdf.js](https://mozilla.github.io/pdf.js/) para leerlos,
[tesseract.js](https://tesseract.projectnaptha.com/) para el OCR y
[qrcode](https://github.com/soldair/node-qrcode) para los códigos QR.

---

## Sobre SafeAutentic

[SafeAutentic](https://safeautenticmx.web.app/) es un ERP para consultorías de
Protección Civil en México. Conecta clientes, cotizaciones, inspecciones,
capacitación, planos y **constancias verificables con código QR** en una sola
plataforma, con la identidad de cada consultoría.

PDF Mapper es la pieza con la que cada consultoría convierte sus formatos en
plantillas de SafeAutentic. ¿Quieres verlo funcionando con todo lo demás?
[Conoce SafeAutentic](https://safeautenticmx.web.app/).
