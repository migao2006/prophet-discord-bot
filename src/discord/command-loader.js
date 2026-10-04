import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_COMMANDS_DIRECTORY = path.join(import.meta.dirname, '..', 'commands');

async function findJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  }));
  return nested.flat().sort();
}

export async function loadCommands(directory = DEFAULT_COMMANDS_DIRECTORY) {
  const files = await findJavaScriptFiles(directory);
  const commands = new Map();

  for (const file of files) {
    const module = await import(pathToFileURL(file).href);
    if (!module.data?.name || typeof module.data.toJSON !== 'function' || typeof module.execute !== 'function') {
      throw new Error(`指令模組格式錯誤：${path.relative(directory, file)}`);
    }
    if (commands.has(module.data.name)) {
      throw new Error(`指令名稱重複：${module.data.name}`);
    }
    commands.set(module.data.name, { data: module.data, execute: module.execute });
  }

  return commands;
}
