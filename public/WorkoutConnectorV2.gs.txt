// Workout Connector v2 — one standalone Apps Script project per Google account.
// Only explicitly registered spreadsheet IDs and TREINO worksheets are read.
// The browser never supplies a cell address for writes.
var CONNECTOR_VERSION = 2;
var KEY_PROPERTY = "WORKOUT_CONNECTOR_KEY";
var SHEETS_PROPERTY = "WORKOUT_CONNECTOR_SHEET_IDS";

function initializeConnector() {
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(KEY_PROPERTY)) properties.setProperty(KEY_PROPERTY, newConnectorKey_());
  return "Copy WORKOUT_CONNECTOR_KEY from Project Settings → Script Properties. Keep it private.";
}

function rotateConnectorKey() {
  PropertiesService.getScriptProperties().setProperty(KEY_PROPERTY, newConnectorKey_());
  return "Key rotated. Copy the new WORKOUT_CONNECTOR_KEY from Script Properties and reconnect the app.";
}

function newConnectorKey_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

function sameKey_(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || actual.length !== expected.length || expected.length < 48) return false;
  var mismatch = 0;
  for (var i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function failure_(code, message) { return { ok: false, version: CONNECTOR_VERSION, error: { code: code, message: message } }; }

function doPost(event) {
  var request;
  try {
    if (!event || !event.postData || !event.postData.contents || event.postData.contents.length > 32768) return reply_(failure_("BAD_REQUEST", "Invalid request."));
    request = JSON.parse(event.postData.contents);
    var storedKey = PropertiesService.getScriptProperties().getProperty(KEY_PROPERTY);
    if (!sameKey_(request.key, storedKey)) return reply_(failure_("UNAUTHORIZED", "Connection key was rejected."));
    if (request.operation === "ping") return reply_({ ok: true, version: CONNECTOR_VERSION, result: {
      connectorVersion: CONNECTOR_VERSION, registeredSheets: registeredIds_().length
    } });
    var spreadsheetId = validSpreadsheetId_(request.spreadsheetId);
    if (request.operation === "registerSpreadsheet") return reply_({ ok: true, version: CONNECTOR_VERSION,
      result: registerSpreadsheet_(spreadsheetId) });
    var spreadsheet = openRegistered_(spreadsheetId);
    if (request.operation === "getWorkbookSnapshot") return reply_({ ok: true, version: CONNECTOR_VERSION,
      result: workbookSnapshot_(spreadsheet) });
    if (request.operation === "getSyncSnapshot") return reply_({ ok: true, version: CONNECTOR_VERSION,
      result: syncSnapshot_(spreadsheet) });
    if (request.operation === "registerSpreadsheetCompletion") return reply_({ ok: true, version: CONNECTOR_VERSION,
      result: registerCompletion_(spreadsheet, request.payload || {}) });
    return reply_(failure_("UNKNOWN_OPERATION", "Operation is not supported."));
  } catch (error) {
    // Never return stack traces, request bodies, URLs, or keys.
    var code = error && error.connectorCode ? error.connectorCode : "CONNECTOR_ERROR";
    var message = error && error.connectorMessage ? error.connectorMessage : "The connector could not complete the request.";
    return reply_(failure_(code, message));
  }
}

function validSpreadsheetId_(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20,128}$/.test(value))
    connectorError_("BAD_SPREADSHEET", "Google Sheets URL is invalid.");
  return value;
}

function registeredIds_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SHEETS_PROPERTY);
  if (!raw) return [];
  var ids = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.length > 50 || !ids.every(function (id) { return typeof id === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(id); }))
    connectorError_("CONNECTOR_ERROR", "Connector registration data is invalid.");
  return ids;
}

function openSpreadsheet_(id) {
  try { return SpreadsheetApp.openById(id); }
  catch (error) {
    if (/permission|access|authoriz/i.test(String(error && error.message || "")))
      connectorError_("ACCESS_DENIED", "The Google account connected to this connector does not have access to this spreadsheet.");
    connectorError_("SOURCE_UNAVAILABLE", "The spreadsheet could not be opened. It may be deleted or temporarily unavailable.");
  }
}

function openRegistered_(id) {
  if (registeredIds_().indexOf(id) < 0) connectorError_("NOT_REGISTERED", "Connect this spreadsheet in Treino Local before reading or syncing it.");
  return openSpreadsheet_(id);
}

function registerSpreadsheet_(id) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) connectorError_("BUSY", "Connector is busy. Retry shortly.");
  try {
    var spreadsheet = openSpreadsheet_(id);
    var snapshot = workbookSnapshot_(spreadsheet); // Reject unsupported templates before registration.
    var ids = registeredIds_();
    if (ids.indexOf(id) < 0) {
      if (ids.length >= 50) connectorError_("REGISTER_LIMIT", "Too many spreadsheets are registered in this connector.");
      ids.push(id);
      PropertiesService.getScriptProperties().setProperty(SHEETS_PROPERTY, JSON.stringify(ids));
    }
    return snapshot;
  } finally { lock.releaseLock(); }
}

function connectorError_(code, message) {
  var error = new Error(message); error.connectorCode = code; error.connectorMessage = message; throw error;
}

function workoutSheets_(spreadsheet) {
  var sheets = spreadsheet.getSheets().filter(function (sheet) { return /^TREINO\s/i.test(sheet.getName()); });
  if (!sheets.length || sheets.length > 8) connectorError_("UNSUPPORTED_SOURCE", "No supported workout sheets were found.");
  return sheets;
}

function column_(index) {
  var result = "", value = index;
  while (value > 0) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

function sourceDate_(value, timezone) {
  if (value instanceof Date) return Utilities.formatDate(value, timezone, "yyyy-MM-dd");
  if (typeof value === "number" && Number.isFinite(value)) return new Date((value - 25569) * 86400000).toISOString().slice(0, 10);
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function cellSnapshot_(value, displayed, format, formula, rich, ref, timezone) {
  var raw = value instanceof Date ? sourceDate_(value, timezone) : value === null || value === undefined ? "" : String(value);
  var rawType = value instanceof Date ? "date" : typeof value === "number" ? "n" : "s";
  var hyperlink = rich && rich.getLinkUrl ? rich.getLinkUrl() : null;
  if (!hyperlink && rich && rich.getRuns) {
    var runs = rich.getRuns();
    for (var i = 0; i < runs.length; i++) if (runs[i].getLinkUrl && runs[i].getLinkUrl()) { hyperlink = runs[i].getLinkUrl(); break; }
  }
  if (!raw && !displayed && !hyperlink && !formula && !/d/i.test(format || "")) return null;
  return { ref: ref, raw: raw, displayed: displayed || raw, rawType: rawType,
    numberFormat: format || "General", formula: formula || undefined, hyperlink: hyperlink || undefined };
}

function workbookSnapshot_(spreadsheet) {
  var timezone = spreadsheet.getSpreadsheetTimeZone();
  var sheets = workoutSheets_(spreadsheet).map(function (sheet) {
    var range = sheet.getRange("A1:O45");
    var values = range.getValues(), displays = range.getDisplayValues(), formats = range.getNumberFormats();
    var formulas = range.getFormulas(), links = range.getRichTextValues();
    var cells = {};
    for (var row = 0; row < values.length; row++) for (var col = 0; col < values[row].length; col++) {
      var ref = column_(col + 1) + (row + 1);
      var item = cellSnapshot_(values[row][col], displays[row][col], formats[row][col], formulas[row][col], links[row][col], ref, timezone);
      if (item) cells[ref] = item;
    }
    return { name: sheet.getName(), sheetId: sheet.getSheetId(), cells: cells };
  });
  return { spreadsheetName: spreadsheet.getName(), sheetUrl: spreadsheet.getUrl(),
    mappingId: mappingId_(sheets), snapshot: { sheets: sheets } };
}

function mappingId_(sheets) {
  var structural = sheets.map(function (sheet) {
    var cells = Object.keys(sheet.cells).sort().filter(function (ref) {
      return !/^[EF](?:[5-9]|1[0-6])$/.test(ref);
    }).map(function (ref) {
      var cell = sheet.cells[ref];
      return [ref, cell.displayed, cell.numberFormat, cell.formula || "", cell.hyperlink || ""];
    });
    return [sheet.name, sheet.sheetId, cells];
  });
  var text = JSON.stringify(structural), hash = 2166136261;
  for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function validDate_(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  var parts = date.split("-").map(Number);
  var parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return parsed.toISOString().slice(0, 10) === date;
}

function validatedGrid_(spreadsheet, workoutId) {
  if (typeof workoutId !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(workoutId)) connectorError_("BAD_WORKOUT", "Workout identifier is invalid.");
  var sheet = spreadsheet.getSheetByName("TREINO " + workoutId);
  if (!sheet || !String(sheet.getRange("C1").getDisplayValue()).toLowerCase().includes("plano de treino") ||
      !String(sheet.getRange("E4").getDisplayValue()).toLowerCase().includes("dias de treino")) {
    connectorError_("SOURCE_CHANGED", "Workout sheet markers changed. Refresh the training.");
  }
  var ordinals = sheet.getRange("D5:D16").getDisplayValues();
  var range = sheet.getRange("E5:E16"), values = range.getValues(), formats = range.getNumberFormats();
  for (var i = 0; i < 12; i++) {
    if (!String(ordinals[i][0]).startsWith(String(i + 1)) || !/d/i.test(formats[i][0]))
      connectorError_("SOURCE_CHANGED", "Completion grid changed. No date was written.");
    var value = values[i][0];
    if (value !== "" && value !== null && !sourceDate_(value, spreadsheet.getSpreadsheetTimeZone()))
      connectorError_("SOURCE_CHANGED", "Completion grid contains an unsupported date value.");
  }
  return { sheet: sheet, range: range, values: values };
}

function syncSnapshot_(spreadsheet) {
  var current = workbookSnapshot_(spreadsheet);
  return { mappingId: current.mappingId, workouts: workoutSheets_(spreadsheet).map(function (sheet) {
    var id = sheet.getName().replace(/^TREINO\s+/i, "");
    var grid = validatedGrid_(spreadsheet, id);
    return { workoutId: id, dates: grid.values.map(function (row) { return sourceDate_(row[0], spreadsheet.getSpreadsheetTimeZone()) || null; }) };
  }) };
}

function registerCompletion_(spreadsheet, payload) {
  if (!validDate_(payload.localDate) || typeof payload.mappingId !== "string" || !/^[0-9a-f]{8}$/.test(payload.mappingId))
    connectorError_("BAD_REQUEST", "Workout date or mapping identifier is invalid.");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) connectorError_("BUSY", "The Sheet is busy. Retry shortly.");
  try {
    var current = workbookSnapshot_(spreadsheet);
    if (current.mappingId !== payload.mappingId) connectorError_("SOURCE_CHANGED", "Training structure changed. Refresh before syncing.");
    var grid = validatedGrid_(spreadsheet, payload.workoutId), timezone = spreadsheet.getSpreadsheetTimeZone();
    var dates = grid.values.map(function (row) { return sourceDate_(row[0], timezone) || null; });
    if (dates.indexOf(payload.localDate) >= 0) return { status: "duplicate", workoutId: payload.workoutId, localDate: payload.localDate };
    var index = dates.indexOf(null);
    if (index < 0) return { status: "full", workoutId: payload.workoutId, localDate: payload.localDate };
    var destination = grid.sheet.getRange(5 + index, 5);
    if (destination.getValue() !== "") connectorError_("OCCUPIED", "Completion slot became occupied. No date was written.");
    destination.setValue(Utilities.parseDate(payload.localDate, timezone, "yyyy-MM-dd"));
    SpreadsheetApp.flush();
    if (sourceDate_(destination.getValue(), timezone) !== payload.localDate)
      connectorError_("VERIFY_FAILED", "Date write could not be verified. Check the Sheet before retrying.");
    return { status: "synced", workoutId: payload.workoutId, localDate: payload.localDate, sourceSlot: "E" + (5 + index) };
  } finally { lock.releaseLock(); }
}
