// Optional fixture-authoring tool: uses the installed Codex workbook SDK, never application runtime code.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';

const modules = process.env.CODEX_WORKBOOK_MODULES ?? join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const bundled = createRequire(join(modules, 'package.json'));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(bundled.resolve('@oai/artifact-tool')).href);
const workbook = Workbook.create();
const sheet = workbook.worksheets.add('TREINO A');
const cells = {
  C1: 'PLANO DE TREINO — SYNTHETIC AUDIT', E4: 'DIAS DE TREINO',
  B5: 'Fictional mobile editing checks', B7: 'Flexible', B9: 'Rest 2 minutes',
  E18: 'PARTE I: AQUECIMENTO', E19: 'EXERCÍCIOS', F19: 'REPETIÇÕES', G19: 'VÍDEO REFERÊNCIA',
  E20: 'Cloud Warmup', F20: '10x', E21: 'Pixel Warmup', F21: '10x', E22: 'Beacon Warmup', F22: '10x',
  E24: 'PARTE II: FORÇA', E25: 'EXERCÍCIOS', F25: 'REPETIÇÕES', G25: 'CARGA ATUAL', I25: 'EQUIPAMENTO', J25: 'VÍDEO REFERÊNCIA',
  E26: 'Nova Press\nOrbit Row', F26: '3x10\n3x10', G26: '12kg', H26: '12,5 kg', I26: 'Synthetic station\nSynthetic station',
  E28: 'Quartz Pull\nComet Lift', F28: '3x10\n3x10', G28: '2x8kg', H28: '20kg (17,5 no final)', I28: 'Synthetic station\nSynthetic station',
  E30: 'Lumen Raise', F30: '3x10', I30: 'Synthetic station',
  E32: 'Vector Step', F32: '3x10', G32: 16, I32: 'Synthetic station',
  E34: 'Synthetic guidance only: use comfortable controlled movement.'
};
for (let row = 5; row <= 16; row++) cells[`D${row}`] = row - 4;
cells.E5 = '2001-01-02'; // Artificial source occurrence; not a real completion.
sheet.getRange('E5:E16').values = Array.from({ length: 12 }, () => [null]);
sheet.getRange('E5:E16').format.numberFormat = 'yyyy-mm-dd';
for (const [cell, value] of Object.entries(cells)) sheet.getRange(cell).values = [[value]];
sheet.getRange('C1:K34').format.rowHeight = 24;
sheet.getRange('E1:E34').format.columnWidth = 36;
sheet.getRange('F1:H34').format.columnWidth = 23;
sheet.getRange('I1:K34').format.columnWidth = 25;
sheet.getRange('E26:K30').format.wrapText = true;
sheet.getRange('C26:K26').format.rowHeight = 36;
sheet.getRange('C28:K28').format.rowHeight = 36;
workbook.recalculate();
const target = resolve('tests/fixtures/mobile-audit.xlsx');
await fs.mkdir(resolve('tests/fixtures'), { recursive: true });
await fs.mkdir('screenshots/mobile-load-audit', { recursive: true });
const intermediate = resolve('screenshots/mobile-load-audit/mobile-audit.xlsx');
await (await SpreadsheetFile.exportXlsx(workbook)).save(intermediate);
// Remove identifying document metadata and normalize ZIP timestamps for repeatable exports.
const JSZip = bundled('jszip');
const source = await JSZip.loadAsync(await fs.readFile(intermediate));
const normalized = new JSZip();
const relationshipIds = new Map();
for (const name of Object.keys(source.files).sort()) {
  if (source.files[name].dir) continue;
  let bytes = await source.files[name].async('uint8array');
  if (name === 'docProps/core.xml') bytes = new TextEncoder().encode('<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>');
  if (name.endsWith('.xml') || name.endsWith('.rels')) bytes = new TextEncoder().encode(new TextDecoder().decode(bytes)
    .replace(/R[0-9a-f]{16}/g, (id) => { if (!relationshipIds.has(id)) relationshipIds.set(id, `rId${relationshipIds.size + 1}`); return relationshipIds.get(id); }));
  normalized.file(name, bytes, { date: new Date('2000-01-01T00:00:00Z'), createFolders: false });
}
await fs.writeFile(target, await normalized.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
if (process.argv.includes('--render')) {
  await fs.mkdir('screenshots/mobile-load-audit', { recursive: true });
  const preview = await workbook.render({ sheetName: 'TREINO A', range: 'C18:K34', scale: 1, format: 'png' });
  await fs.writeFile('screenshots/mobile-load-audit/workbook.png', new Uint8Array(await preview.arrayBuffer()));
}
console.log('Created tests/fixtures/mobile-audit.xlsx (fully synthetic).');
