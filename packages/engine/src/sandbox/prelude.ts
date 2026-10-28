/** Errors with this name mean the code is shaped wrong (no `run`, no validator), not that it failed. */
export const LOAD_ERROR_NAME = 'SandboxLoadError';

/** Characters of printed output the sandbox keeps from one `run`; the host shows less. */
export const PRINT_LIMIT = 100_000;

/**
 * Runs inside QuickJS before any job code. It removes the clock and randomness, keeps private
 * references to JSON so job code can't tamper with result encoding, and returns the entry
 * points the host calls. `host` holds the data functions; job code never gets a reference to it.
 * Code the agent sends to `run` also gets `today`, `files`, `csv`, `print` and `console`.
 */
export const PRELUDE = `(function (host) {
  'use strict';
  var parse = JSON.parse;
  var stringify = JSON.stringify;
  var hasOwn = Object.prototype.hasOwnProperty;
  var defineProperty = Object.defineProperty;
  var freeze = Object.freeze;
  var create = Object.create;
  var isArray = Array.isArray;
  var construct = Reflect.construct;
  var apply = Reflect.apply;
  var slice = Array.prototype.slice;
  var join = Array.prototype.join;
  var toText = String;
  var RealDate = Date;
  var LF = String.fromCharCode(10);
  var CR = String.fromCharCode(13);
  var QUOTE = String.fromCharCode(34);
  var clockHint = 'pass dates in as arguments, like new Date("2026-11-03")';

  function loadError(message) {
    var error = new Error(message);
    error.name = '${LOAD_ERROR_NAME}';
    return error;
  }

  function noClock() {
    throw new Error('The sandbox has no clock: ' + clockHint + '.');
  }
  function SandboxDate() {
    if (new.target === undefined || arguments.length === 0) noClock();
    return construct(RealDate, slice.call(arguments), new.target);
  }
  SandboxDate.prototype = RealDate.prototype;
  SandboxDate.UTC = RealDate.UTC;
  SandboxDate.parse = RealDate.parse;
  SandboxDate.now = noClock;
  defineProperty(RealDate.prototype, 'constructor', { value: SandboxDate, writable: true, configurable: true });
  defineProperty(globalThis, 'Date', { value: SandboxDate, writable: true, configurable: true });
  Math.random = function random() {
    throw new Error('The sandbox has no randomness: Math.random is disabled.');
  };

  function hostCall(name, args) {
    return parse(host[name].apply(undefined, args));
  }
  function options(value) {
    return stringify(value === undefined ? null : value);
  }
  function settle(value) {
    if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
      throw new Error('Return a plain value, not a promise: the sandbox runs code synchronously.');
    }
    var json = stringify(value);
    return json === undefined ? 'null' : json;
  }

  var printed = [];
  var printedChars = 0;
  var printedCut = false;
  /**
   * What run hands back, as an object with no prototype: the code may have changed the built-in
   * prototypes (a toJSON on Object.prototype, say), and none of that may reach the result.
   */
  function output(fields) {
    var out = create(null);
    out.printed = apply(join, printed, ['']);
    out.cut = printedCut;
    for (var key in fields) out[key] = fields[key];
    return stringify(out);
  }
  function show(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return '[function]';
    try {
      var json = stringify(value);
      return json === undefined ? String(value) : json;
    } catch (error) {
      return String(value);
    }
  }
  function print() {
    if (printedCut) return;
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(show(arguments[i]));
    var line = parts.join(' ') + LF;
    if (printedChars + line.length > ${PRINT_LIMIT}) {
      printed.push(line.slice(0, ${PRINT_LIMIT} - printedChars));
      printedChars = ${PRINT_LIMIT};
      printedCut = true;
      return;
    }
    printed.push(line);
    printedChars += line.length;
  }

  function parseCsv(text) {
    if (typeof text !== 'string') {
      throw new TypeError('csv.parse takes the text of a CSV file, like csv.parse(files.read("data/orders.csv")).');
    }
    var records = [];
    var row = [];
    var field = '';
    var quoted = false;
    var i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    function endRow() {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) records.push(row);
      row = [];
    }
    for (; i < text.length; i++) {
      var c = text.charAt(i);
      if (quoted) {
        if (c !== QUOTE) field += c;
        else if (text.charAt(i + 1) === QUOTE) {
          field += QUOTE;
          i++;
        } else quoted = false;
      } else if (c === QUOTE) quoted = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === LF) endRow();
      else if (c === CR) {
        if (text.charAt(i + 1) === LF) i++;
        endRow();
      } else field += c;
    }
    if (quoted) throw new Error('csv.parse: a quoted value is never closed.');
    if (field !== '' || row.length > 0) endRow();
    if (records.length === 0) return [];
    var header = records[0];
    var rows = [];
    for (var r = 1; r < records.length; r++) {
      var cells = records[r];
      if (cells.length !== header.length) {
        throw new Error('csv.parse: row ' + r + ' has ' + cells.length + ' values, but the header has ' + header.length + ' columns.');
      }
      var item = {};
      for (var k = 0; k < header.length; k++) item[header[k]] = cells[k];
      rows.push(item);
    }
    return rows;
  }

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      throw new TypeError('csv.stringify: a value is an object or a list; give text, numbers or true and false.');
    }
    var text = String(value);
    var special = text.indexOf(',') !== -1 || text.indexOf(QUOTE) !== -1 || text.indexOf(LF) !== -1 || text.indexOf(CR) !== -1;
    return special ? QUOTE + text.split(QUOTE).join(QUOTE + QUOTE) + QUOTE : text;
  }
  function stringifyCsv(rows, settings) {
    if (!isArray(rows)) {
      throw new TypeError('csv.stringify takes a list of rows: objects, or lists of values.');
    }
    var columns = settings && settings.columns;
    if (!columns) {
      columns = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row === null || typeof row !== 'object' || isArray(row)) continue;
        for (var key in row) {
          if (hasOwn.call(row, key) && columns.indexOf(key) === -1) columns.push(key);
        }
      }
    }
    var lines = [];
    if (!(settings && settings.header === false) && columns.length > 0) {
      lines.push(columns.map(csvCell).join(','));
    }
    for (var j = 0; j < rows.length; j++) {
      var item = rows[j];
      var values = isArray(item)
        ? item
        : columns.map(function (column) {
            return item === null || item === undefined ? undefined : item[column];
          });
      lines.push(values.map(csvCell).join(','));
    }
    return lines.length === 0 ? '' : lines.join(LF) + LF;
  }

  function setGlobal(name, value) {
    defineProperty(globalThis, name, { value: value, writable: true, configurable: true });
  }

  return {
    checkTool: function () {
      if (typeof run !== 'function') throw loadError('The tool code must define function run(args, ctx).');
      return 'null';
    },
    runTool: function (argsJson) {
      if (typeof run !== 'function') throw loadError('The tool code must define function run(args, ctx).');
      var ctx = freeze({
        readTable: function readTable(name, query) { return hostCall('readTable', [String(name), options(query)]); },
        readText: function readText(name) { return hostCall('readText', [String(name)]); },
        listFiles: function listFiles() { return hostCall('listFiles', []); }
      });
      return settle(run(parse(argsJson), ctx));
    },
    runValidator: function (name, paramsJson, contextJson) {
      if (typeof validators !== 'object' || validators === null) {
        throw loadError('The checker module must define var validators = { name: function (params, ctx) { ... } }.');
      }
      if (!hasOwn.call(validators, name) || typeof validators[name] !== 'function') {
        throw loadError('The checker module has no validator named "' + name + '".');
      }
      var context = parse(contextJson);
      var ctx = freeze({
        readTable: function readTable(table, query) { return hostCall('readTable', [String(table), options(query)]); },
        readOriginalTable: function readOriginalTable(table, query) { return hostCall('readOriginalTable', [String(table), options(query)]); },
        answer: context.answer,
        finalText: context.finalText,
        toolCalls: context.toolCalls
      });
      return settle(validators[name](parse(paramsJson), ctx));
    },
    startCode: function (today) {
      clockHint = 'use today, the working date (' + today + '), or dates from the files';
      setGlobal('today', today);
      setGlobal('print', print);
      setGlobal('console', freeze({ log: print, info: print, warn: print, error: print, debug: print }));
      setGlobal('files', freeze({
        read: function read(path) { return hostCall('readFile', [String(path)]); },
        list: function list(folder) { return hostCall('listFiles', [folder === undefined ? '' : String(folder)]); }
      }));
      setGlobal('csv', freeze({ parse: parseCsv, stringify: stringifyCsv }));
      return 'null';
    },
    finishCode: function (value) {
      var json = null;
      var problem;
      try {
        if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
          problem = 'The last value is a promise, and run works synchronously: use the value itself.';
        } else if (value !== undefined && typeof value !== 'function') {
          json = stringify(value);
          if (typeof json !== 'string') json = null;
        }
      } catch (error) {
        problem = 'The last value could not be turned into JSON: ' + toText(error && error.message);
      }
      var fields = create(null);
      fields.value = json;
      if (problem !== undefined) {
        fields.error = create(null);
        fields.error.kind = 'invalid_result';
        fields.error.message = problem;
      }
      return output(fields);
    },
    output: function () {
      return output(create(null));
    },
    grep: function (pattern, flags, pathsJson, limitText, widthText) {
      var regex = new RegExp(pattern, flags);
      var paths = parse(pathsJson);
      var limit = Number(limitText);
      var width = Number(widthText);
      var matches = [];
      var total = 0;
      for (var p = 0; p < paths.length; p++) {
        var lines = hostCall('readFile', [paths[p]]).split(LF);
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        for (var n = 0; n < lines.length; n++) {
          if (!regex.test(lines[n])) continue;
          total++;
          if (matches.length < limit) {
            var line = lines[n];
            matches.push({ path: paths[p], line: n + 1, text: line.length > width ? line.slice(0, width) + '…' : line });
          }
        }
      }
      return stringify({ matches: matches, total: total });
    }
  };
})`;
