/** Errors with this name mean the code is shaped wrong (no `run`, no validator), not that it failed. */
export const LOAD_ERROR_NAME = 'SandboxLoadError';

/**
 * Runs inside QuickJS before any job code. It removes the clock and randomness, keeps private
 * references to JSON so job code can't tamper with result encoding, and returns the two entry
 * points the host calls. `host` holds the data functions; job code never gets a reference to it.
 */
export const PRELUDE = `(function (host) {
  'use strict';
  var parse = JSON.parse;
  var stringify = JSON.stringify;
  var hasOwn = Object.prototype.hasOwnProperty;
  var construct = Reflect.construct;
  var slice = Array.prototype.slice;
  var RealDate = Date;

  function loadError(message) {
    var error = new Error(message);
    error.name = '${LOAD_ERROR_NAME}';
    return error;
  }

  function noClock() {
    throw new Error('The sandbox has no clock: pass dates in as arguments, like new Date("2026-11-03").');
  }
  function SandboxDate() {
    if (new.target === undefined || arguments.length === 0) noClock();
    return construct(RealDate, slice.call(arguments), new.target);
  }
  SandboxDate.prototype = RealDate.prototype;
  SandboxDate.UTC = RealDate.UTC;
  SandboxDate.parse = RealDate.parse;
  SandboxDate.now = noClock;
  Object.defineProperty(RealDate.prototype, 'constructor', { value: SandboxDate, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'Date', { value: SandboxDate, writable: true, configurable: true });
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

  return {
    checkTool: function () {
      if (typeof run !== 'function') throw loadError('The tool code must define function run(args, ctx).');
      return 'null';
    },
    runTool: function (argsJson) {
      if (typeof run !== 'function') throw loadError('The tool code must define function run(args, ctx).');
      var ctx = Object.freeze({
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
      var ctx = Object.freeze({
        readTable: function readTable(table, query) { return hostCall('readTable', [String(table), options(query)]); },
        readOriginalTable: function readOriginalTable(table, query) { return hostCall('readOriginalTable', [String(table), options(query)]); },
        answer: context.answer,
        finalText: context.finalText,
        toolCalls: context.toolCalls
      });
      return settle(validators[name](parse(paramsJson), ctx));
    }
  };
})`;
