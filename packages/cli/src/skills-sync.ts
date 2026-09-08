import fs from 'node:fs/promises';
import path from 'node:path';
import { Cli, SyncSkills } from 'incur';

// Mirrors Shopify's ucp-cli workaround until Incur supports an explicit
// authored-only mode:
// https://github.com/Shopify/ucp-cli/blob/main/src/cli/skills-sync.ts

export function isSkillsAddInvocation(argv: readonly string[]): boolean {
  return (
    (argv[0] === 'skills' || argv[0] === 'skill') &&
    argv[1] === 'add' &&
    !argv.includes('--help') &&
    !argv.includes('-h')
  );
}

export async function syncAuthoredSkills(options: {
  argv: readonly string[];
  cli: unknown;
  cwd: string;
  description: string;
  stdout?: (text: string) => void;
}): Promise<void> {
  const stdout =
    options.stdout ?? ((text: string) => process.stdout.write(text));
  const { depth, global } = parseAddArgs(options.argv);
  const authoredNames = await readAuthoredSkillNames(options.cwd);
  const commands = (
    Cli as unknown as { toCommands: WeakMap<object, unknown> }
  ).toCommands.get(options.cli as object);

  if (!commands) {
    throw new Error('Could not resolve Link CLI commands for skill sync');
  }

  stdout('Syncing...');
  const result = await SyncSkills.sync('link-cli', commands as never, {
    cwd: options.cwd,
    depth,
    description: options.description,
    global,
    include: ['skills/*'],
  });
  stdout('\r\x1b[K');

  const generatedNames = new Set(
    result.skills
      .filter((skill) => !authoredNames.has(skill.name))
      .map((skill) => skill.name),
  );
  const installedPaths = [
    ...result.paths,
    ...result.agents.map((agent) => agent.path),
  ];

  for (const installedPath of installedPaths) {
    if (generatedNames.has(path.basename(installedPath))) {
      await fs.rm(installedPath, { recursive: true, force: true });
    }
  }

  await copySkillCompanionFiles(options.cwd, authoredNames, result.paths);

  const authoredSkills = result.skills.filter((skill) =>
    authoredNames.has(skill.name),
  );
  printSummary(authoredSkills, stdout);
}

function parseAddArgs(argv: readonly string[]): {
  depth: number;
  global: boolean | undefined;
} {
  const depthIndex = argv.indexOf('--depth');
  const depthArgument = argv.find((argument) =>
    argument.startsWith('--depth='),
  );
  let depth = 1;

  if (depthIndex !== -1) {
    const parsed = Number(argv[depthIndex + 1]);
    if (Number.isFinite(parsed)) depth = parsed;
  } else if (depthArgument) {
    const parsed = Number(depthArgument.split('=')[1]);
    if (Number.isFinite(parsed)) depth = parsed;
  }

  return {
    depth,
    global: argv.includes('--no-global') ? false : undefined,
  };
}

async function readAuthoredSkillNames(cwd: string): Promise<Set<string>> {
  const names = new Set<string>();
  const skillsDirectory = path.join(cwd, 'skills');
  let entries: import('node:fs').Dirent[];

  try {
    entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
  } catch {
    return names;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    try {
      const content = await fs.readFile(
        path.join(skillsDirectory, entry.name, 'SKILL.md'),
        'utf8',
      );
      const frontmatterName = content.match(/^name:\s*(.+)$/m)?.[1];
      names.add(frontmatterName?.trim() ?? entry.name);
    } catch {
      // Incur also skips directories without a readable SKILL.md.
    }
  }

  return names;
}

async function copySkillCompanionFiles(
  cwd: string,
  authoredNames: ReadonlySet<string>,
  canonicalPaths: readonly string[],
): Promise<void> {
  const canonicalPathByName = new Map(
    canonicalPaths.map((canonicalPath) => [
      path.basename(canonicalPath),
      canonicalPath,
    ]),
  );
  const skillsDirectory = path.join(cwd, 'skills');
  let entries: import('node:fs').Dirent[];

  try {
    entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sourceDirectory = path.join(skillsDirectory, entry.name);
    let content: string;
    try {
      content = await fs.readFile(
        path.join(sourceDirectory, 'SKILL.md'),
        'utf8',
      );
    } catch {
      continue;
    }

    const skillName =
      content.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? entry.name;
    if (!authoredNames.has(skillName)) continue;

    const destinationDirectory = canonicalPathByName.get(skillName);
    if (!destinationDirectory) continue;

    const companionEntries = await fs.readdir(sourceDirectory, {
      withFileTypes: true,
    });
    for (const companionEntry of companionEntries) {
      if (companionEntry.name === 'SKILL.md') continue;
      await fs.cp(
        path.join(sourceDirectory, companionEntry.name),
        path.join(destinationDirectory, companionEntry.name),
        { recursive: true, force: true },
      );
    }
  }
}

function printSummary(
  skills: readonly { description?: string; name: string }[],
  stdout: (text: string) => void,
): void {
  if (skills.length === 0) {
    stdout('No authored Link CLI skills found.\n');
    return;
  }

  const width = Math.max(...skills.map((skill) => skill.name.length));
  const lines = skills.map((skill) => {
    const description = skill.description
      ? `${' '.repeat(width - skill.name.length)}  ${skill.description}`
      : '';
    return `  ✓ ${skill.name}${description}`;
  });
  lines.push('', `${skills.length} skills synced`);
  stdout(`${lines.join('\n')}\n`);
}
