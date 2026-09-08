import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Cli, z } from 'incur';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSkillsAddInvocation, syncAuthoredSkills } from '../skills-sync';

let temporaryDirectory: string;
const originalXdgDataHome = process.env.XDG_DATA_HOME;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'link-cli-skills-sync-'),
  );
  process.env.XDG_DATA_HOME = path.join(temporaryDirectory, 'data');
});

afterEach(async () => {
  if (originalXdgDataHome === undefined) {
    // Restore absence rather than assigning the string "undefined".
    // biome-ignore lint/performance/noDelete: process.env requires deletion to unset a variable.
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  }
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

async function writeSkill(name: string, companion = false): Promise<void> {
  const directory = path.join(temporaryDirectory, 'skills', name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Authored ${name}\n---\n\nAuthored body\n`,
  );
  if (companion) {
    await fs.mkdir(path.join(directory, 'agents'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'agents', 'openai.yaml'),
      'display_name: Link CLI\n',
    );
  }
}

function createTestCli() {
  return Cli.create('link-cli', { description: 'Test Link CLI' })
    .command(
      Cli.create('auth', { description: 'Authentication commands' }).command(
        'login',
        {
          output: z.object({ authenticated: z.boolean() }),
          run: () => ({ authenticated: true }),
        },
      ),
    )
    .command(
      Cli.create('balances', { description: 'Balance commands' }).command(
        'list',
        {
          output: z.object({ balances: z.array(z.number()) }),
          run: () => ({ balances: [] }),
        },
      ),
    );
}

describe('authored skill sync', () => {
  it('recognizes Incur skill-add invocations only', () => {
    expect(isSkillsAddInvocation(['skills', 'add'])).toBe(true);
    expect(isSkillsAddInvocation(['skill', 'add', '--no-global'])).toBe(true);
    expect(isSkillsAddInvocation(['skills', 'add', '--help'])).toBe(false);
    expect(isSkillsAddInvocation(['skill', 'add', '-h'])).toBe(false);
    expect(isSkillsAddInvocation(['skills', 'list'])).toBe(false);
    expect(isSkillsAddInvocation(['auth', 'login'])).toBe(false);
  });

  it('keeps authored skills and removes generated command skills', async () => {
    await writeSkill('link-cli', true);
    await writeSkill('create-payment-credential');
    await writeSkill('financial-insights');

    const unrelatedDirectory = path.join(
      temporaryDirectory,
      '.agents',
      'skills',
      'unrelated-skill',
    );
    await fs.mkdir(unrelatedDirectory, { recursive: true });
    await fs.writeFile(
      path.join(unrelatedDirectory, 'SKILL.md'),
      '---\nname: unrelated-skill\n---\n',
    );

    let output = '';
    await syncAuthoredSkills({
      argv: ['--no-global'],
      cli: createTestCli(),
      cwd: temporaryDirectory,
      description: 'Test Link CLI',
      stdout: (text) => {
        output += text;
      },
    });

    const installedDirectory = path.join(
      temporaryDirectory,
      '.agents',
      'skills',
    );
    expect((await fs.readdir(installedDirectory)).sort()).toEqual([
      'create-payment-credential',
      'financial-insights',
      'link-cli',
      'unrelated-skill',
    ]);
    expect(output).toContain('3 skills synced');
    expect(output).not.toContain('link-cli-auth');
    expect(output).not.toContain('link-cli-balances');
    expect(
      await fs.readFile(
        path.join(installedDirectory, 'link-cli', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('Authored body');
    expect(
      await fs.readFile(
        path.join(installedDirectory, 'link-cli', 'agents', 'openai.yaml'),
        'utf8',
      ),
    ).toBe('display_name: Link CLI\n');
  });
});
