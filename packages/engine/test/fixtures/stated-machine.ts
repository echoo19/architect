import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { MachineSchema } from '@architect/shared';

/*
 * Loaded with --import into one of Architect's processes ahead of its entry, so a test says which
 * computer the process is on rather than taking the one the tests run on: node:os reports the
 * platform, architecture and memory of the machine in ARCHITECT_TEST_MACHINE (a `Machine` as
 * JSON). That is all installation checks and a graduate's record of where it was tested read.
 * Node itself, paths and the processes it starts still follow the real platform.
 */

const stated = process.env.ARCHITECT_TEST_MACHINE;
if (!stated) throw new Error('Set ARCHITECT_TEST_MACHINE to the computer the process is on.');
const machine = MachineSchema.parse(JSON.parse(stated));

Reflect.set(os, 'platform', () => machine.os);
Reflect.set(os, 'arch', () => machine.arch);
Reflect.set(os, 'totalmem', () => machine.memoryBytes);
// Modules that import these by name, as the engine does, see the stated computer too.
syncBuiltinESMExports();
