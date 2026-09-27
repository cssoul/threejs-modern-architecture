#!/usr/bin/env node
// Copy the bundled starter project to a new directory.
//
// Deliberately refuses to overwrite: scaffolding over an existing project is
// the one mistake that cannot be undone from here. Uses only Node stdlib; it
// does NOT install packages or start a server.
import { cp, lstat, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-')) {
  console.error('Usage: node scaffold.mjs <new-project-directory>');
  process.exit(1);
}

const destination = resolve(args[0]);
try {
  await lstat(destination);
  console.error('Refusing to overwrite an existing destination: ' + destination);
  process.exit(1);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/starter');
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, errorOnExist: true, force: false });

console.log('Created: ' + destination);
console.log('Next: cd into it, run npm ci, then npm run dev.');
console.log('The dev server listens on 127.0.0.1:5173 (read the terminal if that port is taken).');
