#!/usr/bin/env node
// The architect command in development: its TypeScript sources, run through tsx. The installed
// app runs a bundle of the same sources on its own Node instead (docs/CLI.md).
import { register } from 'tsx/esm/api';

register();
await import('../src/main.ts');
