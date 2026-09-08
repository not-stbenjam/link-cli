import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repositoryDirectory = path.resolve(packageDirectory, '..', '..');

await fs.cp(
  path.join(repositoryDirectory, 'skills'),
  path.join(packageDirectory, 'dist', 'skills'),
  { recursive: true, force: true },
);
