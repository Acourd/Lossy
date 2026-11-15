# Lossy 1.6.1 — Nuevo logotipo

Integra el monograma aprobado en popup, workspace, documentos, vista previa e iconos de navegador (16, 32, 48 y 128 px). Se conserva el diseño original y se ajusta su encuadre para tamaños pequeños.

---

# Lossy 1.6.0 — Lector completo y migración de historial


Recarga Lossy desde la página de extensiones del navegador y vuelve a abrir su workspace. La actualización se aplica a la extensión de Ayzok; no es necesario reinstalarla ni borrar su biblioteca.

## Vista completa

Las tarjetas conservan su altura natural y el lector permite desplazarse hasta el último mensaje. Ahora presenta tablas, bloques de código, fórmulas compatibles e imágenes guardadas. La búsqueda resalta texto sin romper caracteres como `&` o `<`. Se conserva la selección por rango con Mayús; Escape cierra primero el diálogo abierto y devuelve el foco al cerrar el lector.

## Importar la exportación de ChatGPT

1. Abre **Transferencias → De ChatGPT a Claude**.
2. Selecciona el ZIP de exportación, los archivos `conversations.json` / `conversations-001.json`, o su carpeta descomprimida. Seleccionar solo JSON no incluye los archivos de imagen que estén fuera de él.
3. Revisa el número de conversaciones y los avisos sobre recursos pendientes. Puedes buscar por título y elegir qué conversaciones importar antes de guardar.
4. Elige el nombre del proyecto —inicialmente **ChatGPT**— y la organización por año/mes o por metadatos disponibles.
5. Pulsa **Importar en Lossy**. La lectura inicial no escribe datos; el guardado de fuentes, índice y proyecto es transaccional. Puedes cancelar durante la lectura o el guardado.

El proyecto y sus carpetas son locales a Lossy. Las relaciones con proyectos o GPTs solo se muestran cuando el material aporta metadatos explícitos. Un identificador aislado se conserva como referencia sin adjudicarle un proyecto. Las conversaciones sin fecha reconocible aparecen como «Sin fecha indicada».

Al repetir una importación puedes actualizar el proyecto detectado o crear otro. Actualizar conserva tus notas, los miembros y las carpetas anteriores; reutiliza las fuentes sin cambios. Si una fuente difiere de una versión ya guardada, conserva ambas versiones. Importar no borra conversaciones previas. El ZIP de proyecto permite respaldar también esta organización y los datos originales.

## Preparar contexto para Claude

1. Tras importar, elige las conversaciones necesarias. Inicialmente se seleccionan hasta 20 recientes; esto es una ayuda de selección de Lossy, no una garantía de capacidad de Claude.
2. Puedes filtrar por carpeta. Desde el proyecto, **Continuar en otra IA** abre este mismo flujo con la carpeta activa.
3. Escribe el objetivo actual. El paquete incorpora también las decisiones, preguntas abiertas y siguiente paso guardados en el proyecto.
4. Pulsa **Preparar paquete para Claude** y descomprime el ZIP.
5. Abre o crea el proyecto de destino en Claude y adjunta `START_HERE.txt` y las partes de texto pertinentes. Consulta `INDEX.json` para localizar las conversaciones y `ASSETS.json` para adjuntar las imágenes o archivos relevantes por separado.

El ZIP incluye `conversaciones/`, `assets/`, índices, recibo SHA-256 y plantillas editables. Las imágenes no se reciben automáticamente por estar mencionadas dentro de un TXT. El paquete no recrea la lista de chats, la memoria de cuenta ni los conectores de Claude. Su finalidad es trasladar contexto que el usuario pueda revisar y adjuntar.

Las plantillas cubren estado de proyecto, preferencias disponibles y configuración de un GPT o complemento propio. Puedes copiarlas y pedir el resultado al asistente que sí tenga acceso a esa información. Revisa el resultado: un prompt no recupera automáticamente archivos ausentes ni toda la memoria de una cuenta. Las integraciones requieren configuración en el destino. [Importación de memoria de Claude](https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude).

## Límites de esta entrega

- ZIP de entrada: hasta 512 MiB; para archivos mayores, selecciona la carpeta descomprimida. ZIP64 no está admitido: utiliza también la carpeta descomprimida.
- Historial seleccionado: hasta 256 MiB de JSON y 20.000 conversaciones por importación. Historiales mayores requieren lotes de archivos numerados; un JSON individual mayor necesita dividirse antes.
- Recursos recuperados: hasta 20 MiB por archivo y 64 MiB de archivos únicos por importación. Los ausentes, ambiguos o que superen el presupuesto quedan avisados; el texto se conserva.
- Paquete para Claude: hasta 500 conversaciones y 32 MiB de texto por lote, dividido en partes de 32, 64 o 128 KiB. Estos son presupuestos de Lossy, no límites oficiales ni un cálculo exacto de tokens.
- Se conserva el árbol original en Lossy. El texto de continuidad corresponde a la rama conversacional activa; las partes no textuales no admitidas se señalan y no se convierten inventando contenido.
- La importación y la preparación se procesan localmente, sin subir el historial. El espacio disponible depende del almacenamiento que el navegador conceda a la extensión. Un fallo de escritura se informa y revierte la importación.

Consulta los [tipos de archivo y límites actuales de Claude](https://support.claude.com/en/articles/8241126-upload-files-to-claude) antes de adjuntar un lote grande. Dividir archivos no hace que un historial ilimitado quepa en una conversación.

## Verificación

155 pruebas de lógica superadas, más pruebas físicas en Chromium aislado con datos sintéticos. Se verificaron el lector de 30 mensajes, tablas/código/imagen, ventanas de 390 y 900 píxeles, importación de archivos numerados, cancelación de trabajador y transacción, reimportación, carpetas, preparación selectiva y navegación de 1.000 chats. También pasaron las regresiones de PDF, Word, otros formatos, proyectos y popup anclado. No se usaron la cuenta real ni conversaciones personales del usuario.

La investigación y el diagnóstico se entregan en el informe de esta versión.


---

# Lossy 1.5.0 — Documentos y proyectos recuperables

Esta versión completa los dos flujos acordados: preparar un documento con una selección real de mensajes y restaurar un proyecto completo desde su paquete.

## Preparar documentos

El acceso PDF principal del popup abre un editor amplio. También está disponible en la selección de biblioteca, en cada proyecto y en el centro de exportación. El editor permite seleccionar mensajes, cambiar el título y configurar A4 o Carta, orientación, márgenes, tipografía, tamaño, imágenes, enlaces de procedencia y saltos entre mensajes.

La vista de contenido y el Markdown se preparan con la misma selección. Los recursos de mensajes excluidos no se incorporan al documento. El Markdown ofrece ZIP con carpeta assets/ o un archivo con imágenes incrustadas. Las fuentes guardadas permanecen intactas.

Guardar PDF abre la impresión local del navegador; el usuario elige Guardar como PDF y comprueba allí la paginación final. El navegador compone Unicode con las fuentes disponibles en el equipo, tablas con encabezados repetidos, código e imágenes. KaTeX local convierte fórmulas compatibles a MathML; si una fórmula no se admite, se conserva su código y se muestra un aviso. El editor detecta fórmulas o elementos más anchos que la página e impide imprimirlos silenciosamente recortados; se puede ajustar orientación y tamaño o usar Markdown.

La vista continua del editor representa el contenido y el ancho de papel; los cortes finales se comprueban en la impresión del navegador. Las opciones nativas pueden cambiar el resultado si el usuario modifica allí escala, papel o márgenes. Se conserva PDF rápido en la lista de formatos para descargas directas con el generador básico anterior y sus fuentes estándar.

El editor utiliza los recursos guardados localmente. Para recuperar imágenes pendientes, actualiza la captura o utiliza el acceso PDF del popup, que intenta recuperar los recursos de la conversación antes de abrir el editor. No se envían documentos a un servidor de conversión.

## Restaurar proyectos

En Proyectos, Restaurar proyecto (.zip) muestra nombre, estado, decisiones, pendientes, fuentes y efecto de la restauración. Crear copia es la opción inicial. Actualizar un proyecto existente reemplaza nombre, descripción y estado de trabajo, y mantiene sus fuentes adicionales.

Las fuentes idénticas se reutilizan. Cuando una conversación o clip difiere de su versión local, se conserva una copia restaurada y se mantienen los vínculos del clip con la conversación correspondiente. El guardado del proyecto, sus fuentes y su índice se realiza en una transacción de IndexedDB; ante un fallo no quedan registros parciales. Si los datos cambian después de la vista previa, la operación se rechaza para volver a revisarla.

El ZIP de proyecto y las transferencias asociadas a proyectos incluyen registros canónicos para restauración, incluso el destino Markdown. Se conserva compatibilidad con paquetes 1.4 que incluyan esos registros; los paquetes antiguos que solo contienen Markdown no permiten reconstruir datos ausentes. Un ZIP documental de mensajes seleccionados sirve para lectura, no para restaurar un proyecto.

## Validación y dependencias

Pruebas: npm run test:extension (137 pruebas), npm run test:extension:documents, npm run test:extension:projects, npm run test:extension:e2e, npm run test:extension:visual y npm run test:extension:popup. El escenario documental comprueba restauración exacta de cinco imágenes y un clip, selección coherente, fallo transaccional real, modificación de paquetes y tres PDF renderizados por Poppler e inspeccionados con PDF.js. Usa Chromium aislado y conversaciones sintéticas; no accede a una cuenta real del usuario.

Las distribuciones locales de Markdown-it 15.0.3 y KaTeX 0.19.1 se incluyen con licencias MIT y registros de integridad en extension/vendor/. No se cargan dependencias desde una CDN durante el uso.

Para activar, recarga Lossy en la página de extensiones y actualiza sus pestañas. No se han añadido nuevas fuentes de captura en Claude o Gemini en esta entrega.

---

# Lossy 1.4.0 — Retomar proyectos entre conversaciones

Lossy conecta la biblioteca con el estado actual del trabajo. Las colecciones existentes aparecen como proyectos y conservan sus conversaciones y clips. Define objetivo, decisiones tomadas, preguntas pendientes, siguiente paso y estado (en curso, en pausa o completado).

- La biblioteca muestra proyectos recientes y permite retomarlos. Su búsqueda también encuentra objetivos, decisiones y pendientes.
- El editor guarda automáticamente y permite guardar explícitamente. Las escrituras usan revisión para evitar sobrescribir cambios de otra ventana; un error conserva el borrador y ofrece copiarlo o recargar el estado guardado.
- Copiar para continuar lleva el estado y el listado de fuentes al portapapeles. No copia los mensajes completos ni adjunta imágenes; para ello utiliza Continuar en otra IA.
- Los paquetes de proyecto y las transferencias genéricas, Claude y Markdown incorporan PROJECT_BRIEF.md y project.json, además de conversaciones, recursos, inventario y recibo de archivos. Las notas son escritas por el usuario y no modifican el historial original.
- El proyecto elegido aporta el objetivo inicial a la transferencia. Quitar esa asociación elimina el objetivo automático y excluye su estado del siguiente paquete.
- Se mantiene el popup nativo con tamaño utilizable y desplazamiento interno, así como las exportaciones PDF, DOCX, Markdown, ZIP, JSON, TXT y PNG.

Validación: npm run test:extension (114 pruebas), npm run test:extension:projects, npm run test:extension:e2e, npm run test:extension:visual y npm run test:extension:popup. Las pruebas de navegador requieren Chromium y Playwright como herramientas de desarrollo y usan perfiles aislados con fuentes sintéticas, sin acceder a una cuenta del usuario.

Alcance: la captura en vivo sigue centrada en ChatGPT. Claude y Markdown son destinos de paquete, no nuevas fuentes de captura en esta versión. El importador de configuración sigue aceptando exportaciones oficiales de ChatGPT; todavía no restaura automáticamente project.json. El paquete permite leer y reutilizar ese estado fuera de Lossy. La paridad de PDF con fórmulas, tablas complejas y todo Unicode requiere trabajo adicional.

Para activar: recarga Lossy en la página de extensiones del navegador y actualiza sus pestañas abiertas. Las colecciones existentes se reutilizan sin recrearlas.

---

# Lossy 1.3.3 — Preparar contexto para continuar

El popup abre el workspace con la conversación seleccionada. Registra qué quieres continuar y descarga un ZIP completo para el destino elegido: genérico, Claude o Markdown. El paquete incorpora conversaciones, imágenes, CONTEXT_BRIEF.md, inventario de recursos y un recibo con SHA-256 sobre los archivos reales.

Esta revisión conserva el resultado completo del flujo de transferencia y corrige el cálculo de hashes Unicode/binarios. Las pruebas incluyen el ZIP descargado por la extensión.

---

# Lossy 1.3.2 — Consolidación de captura y exportación

- Resuelve archivos de imagen privados de la conversación, además de los visibles en pantalla. Conserva JPG/PNG/GIF/WebP como bytes locales durante la captura y recupera recursos pendientes al exportar.
- Conserva el resultado del enriquecimiento y unifica punteros y metadatos del mismo archivo.
- Las menciones a complementos con enlaces app:// se convierten en nombres legibles en documentos. JSON conserva la información original.
- Markdown ofrece un archivo único o un ZIP con documento y carpeta assets/. Si algún recurso no se puede descargar, el manifiesto lo indica.
- PDF, DOCX y PNG reciben los mismos recursos resueltos. PNG incluye imágenes y mantiene el estilo al continuar en otra página.
- Los clips conservan adjuntos y sus mensajes seleccionados. El service worker los guarda directamente en IndexedDB; el workspace conserva los elementos antiguos que no haya podido importar.
- El popup usa tarjetas cuadradas de exportación y muestra cuántas imágenes están realmente guardadas.

Pruebas: npm run test:extension. Prueba de extensión cargada en Chromium: npm run test:extension:e2e (herramientas externas de desarrollo configurables mediante LOSSY_QA_MODULES, LOSSY_QA_BROWSER_PATH, LOSSY_QA_OUTPUTS y LOSSY_QA_PROFILE).

Para activar: recarga la extensión y la página de ChatGPT. Las capturas antiguas con imágenes pendientes se pueden actualizar o recuperar desde la exportación. Las rutas internas de ChatGPT pueden variar; si un archivo ha expirado o no es accesible, se informa como pendiente y no se sustituye por otra imagen.

---

# Lossy 1.3.1 — Biblioteca de contexto local

Esta revisión corrige la exportación de conversaciones y clips, y actualiza el workspace.

- PDF: decodificación de PNG, transparencia sobre fondo blanco, conversión de imágenes mediante codecs del navegador, bloques de código sin duplicaciones y líneas largas dentro del margen.
- Markdown: imágenes sin duplicaciones, archivos locales enlazados dentro de un ZIP, nombres seguros y únicos, incrustación opcional y respeto de la opción de omitir imágenes.
- Captura: excluye controles y encabezados de complementos, conserva párrafos y enlaces, y relaciona imágenes con el ID del mensaje. Los clips resuelven imágenes antes de guardarse.
- Workspace: resumen de biblioteca, estados vacíos diferenciados, menú de fila reparado, foco visible, diseño adaptable y contraste de temas claro/oscuro.
- La exportación masiva conserva conversaciones que tengan el mismo título.

Recarga la extensión en la página de extensiones del navegador y vuelve a cargar ChatGPT para activar el nuevo content script. Las capturas antiguas necesitan recapturarse si sus imágenes no quedaron guardadas.

Pruebas: npm run test:extension. La prueba de navegador opcional se ejecuta con node tests/extension/browser_exports.cjs y requiere Playwright, PDF.js y Chromium como herramientas de desarrollo. Configuración: LOSSY_QA_MODULES, LOSSY_QA_BROWSER_PATH y LOSSY_QA_OUTPUTS.

La validación usa conversaciones e imágenes de prueba; no accede a la cuenta del usuario. Los punteros privados que la fuente no exponga se muestran como recursos no disponibles. PDF usa las fuentes estándar del formato; Markdown/JSON conservan Unicode completo.

---

# Liner — AI Context Portability Workbench (v1.3.0)

> **Liner is a local-first context portability layer for AI work.**
> Unit of design: *Transferable context with known provenance, integrity, and limits.*

```
   ┌─────────┐      ┌─────────┐      ┌────────┐      ┌────────┐      ┌─────────┐      ┌──────────┐
   │ CAPTURE │ ───► │ LIBRARY │ ───► │ SELECT │ ───► │ VERIFY │ ───► │ PACKAGE │ ───► │ TRANSFER │
   └─────────┘      └─────────┘      └────────┘      └────────┘      └─────────┘      └──────────┘
```

---

## 1. Los Tres Pilares de Liner v1.3

### I. CAPTURE (Adquisición Híbrida y Fidedigna)
- **Tier 1 — Structured Session Acquisition**: Si la sesión de ChatGPT está activa y autenticada en el navegador, Liner recupera el árbol Directed Acyclic Graph (DAG) completo desde `/backend-api/conversation/{id}`. Extrae UUIDs reales, marcas de tiempo Unix, bifurcaciones de ramas, identificadores de modelo empíricos (`model_slug`) y metadatos de adjuntos.
- **Tier 2 — Resilient DOM Fallback**: Si las APIs internas no están disponibles o cambian, Liner ejecuta una recolección física de DOM mediante barrido progresivo de scroll, alineación posicional de solapamiento contiguo (`computeOverlap` y `alignAndAppendTurns`), cálculo dinámico de `maxScroll` y restauración de la posición original del usuario.
- **Tier 3 — Ingestión de Export Oficial**: Importa directamente archivos `conversations.json` oficiales de OpenAI offline.
- **Integridad Honesta**: Clasifica la captura en cuatro estados semánticos:
  - `captured`: Adquisición completa verificada sin huecos.
  - `partial`: Turnos visibles capturados, pero historial previo fuera de viewport o truncado.
  - `degraded`: Captura exitosa con advertencias de fidelidad.
  - `failed`: Fallo irrecuperable en adquisición.

### II. LIBRARY (Persistencia y Consulta Local-First)
- **Persistencia en IndexedDB (`LinerDB v1.3`)**: Almacena conversaciones completas, índices ligeros de metadatos, colecciones y registros de trabajos.
- **Búsqueda Full-Text Local**: Búsqueda instantánea tokenizada por títulos, contenido de mensajes y roles sin enviar datos a ningún servidor externo.
- **Colecciones de Contexto**: Agrupa conversaciones afines en unidades semánticas transferibles.
- **Principio READ-ONLY**: Liner jamás muta, archiva ni borra contenido de la plataforma de origen.

### III. TRANSFER (Proyecciones y Verificación Portables)
- **Liner Package v1**: Paquete estructurado estándar independiente de plataforma:
  ```
  liner-package/
  ├── manifest.json            # Portability Manifest v1.0
  ├── START_HERE.md            # Guía de bootstrap para modelos LLM de destino
  ├── CONTEXT_MAP.md           # Mapa de contexto y resumen de conversaciones
  ├── conversations/
  │   ├── <id>.json            # Representación canónica tipada v1.3
  │   └── <id>.md              # Markdown limpio con Frontmatter e isomorfismo
  ├── portability/
  │   ├── receipt.json         # Recibo de transferencia con hashes SHA-256
  │   └── capabilities.json    # Capacidades observadas durante la captura
  └── diagnostics/
      └── errors.json          # Registro de advertencias y degradaciones
  ```
- **Portability Manifest Audit (6 Estados)**:
  - `capturedExactly`: Datos íntegros desde sesión estructurada/DAG.
  - `capturedFromRenderedRepresentation`: Reconstruidos desde DOM con solapamiento verificado.
  - `transformed`: Formatos adaptados a especificación canónica.
  - `unavailable`: Información no expuesta por la fuente (ej. modelo no verificable).
  - `unsupported`: Primitivas complejas aún no serializadas.
  - `failed`: Errores durante la adquisición.
- **Adaptadores de Destino (Target Adapters)**:
  - `GenericTargetAdapter`: Genera el paquete estándar Liner Package v1.
  - `ClaudeTargetAdapter`: Genera `PROJECT_CONTEXT.md` e `IMPORT_PROMPT.md` optimizados para Claude Code, Claude Web y Claude Projects.
  - `MarkdownBundleAdapter`: Genera una colección de Markdown con índice maestro.

---

## 2. Superficies de Usuario

1. **Popup (Quick Capture Surface)**:
   - Detección inmediata de pestaña activa.
   - Indicador de estado de integridad (`captured`, `partial`, `warning`).
   - Acciones rápidas de exportación (Markdown, JSON, Claude).
   - Acceso directo a **Liner Workspace**.

2. **Liner Workspace (`workspace.html`)**:
   - Entorno técnico Chrome Refresh 2023 con modos Oscuro y Claro.
   - Vista de Biblioteca con selección múltiple y barra de acciones persistente.
   - Drawer inspector para auditar procedencia, adjuntos y vista previa de turnos.
   - Vista de Colecciones para organizar proyectos.
   - Asistente de Transferencia en 4 pasos (Contexto ➔ Integridad ➔ Destino ➔ Emisión).
   - Centro de Diagnósticos con sanitización automática de secretos y PII.

---

## 3. Seguridad y Privacidad

- **Zero-Token Storage**: Los tokens de sesión web (`Bearer`) se mantienen exclusivamente en memoria volátil durante trabajos activos. Jamás se guardan en IndexedDB, `chrome.storage` o archivos exportados.
- **Zero-Backend**: 100% de la ejecución ocurre en el navegador del usuario. Cero telemetría externa.
- **Sanitización de Diagnósticos**: `sanitizeDiagnostics()` elimina tokens, cabeceras de autorización, cookies y correos electrónicos.
- **Nombres de Archivo Seguros**: `sanitizeFilename()` protege contra ataques de *Zip Slip* (`../`) y nombres reservados de Windows (`CON`, `PRN`, `AUX`, `COM1-9`).

---

## 4. Pruebas y Validación Determinista

Ejecutar la suite completa de pruebas:
```bash
npm run test:extension
```
Verifica:
- Modelo Canónico v1.3 y compatibilidad v1.0.
- Parseo de árboles DAG de ChatGPT.
- Persistencia y búsqueda en LinerDB.
- Máquina de estados del JobEngine y reintentos ante HTTP 429.
- Generación de Liner Package v1, Claude y Markdown.
- Sanitización de secretos y seguridad de rutas.
- Regresión RED-C1-003 en conversaciones largas.
