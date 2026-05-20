/**
 * 13-copilot-cli-launch.spec.ts
 *
 * INVARIANT: "Launch Copilot CLI and ask Squad" is an explicit live gate.
 *
 * What does the system do when CI lacks an authenticated Copilot CLI? The
 * deterministic runner still proves the generated projection + launch contract,
 * while the real Copilot invocation is skipped unless a human opts in.
 */
import { test, expect, request } from '@playwright/test'
import { API_BASE, createProjectViaApiDetails } from './fixtures.ts'

interface CommandInvocation {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
}

interface CommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
}

type CommandRunner = (invocation: CommandInvocation) => Promise<CommandResult>

function copilotCommand(): string {
  return process.env.SQUADBOARD_E2E_COPILOT_COMMAND?.trim() || 'copilot'
}

function copilotArgs(cwd: string, prompt: string): string[] {
  const raw = process.env.SQUADBOARD_E2E_COPILOT_ARGS_JSON
  if (!raw) {
    return [
      '-C',
      cwd,
      '--agent',
      'Squad',
      '--prompt',
      prompt,
      '--output-format',
      'text',
      '--no-color',
      '--no-auto-update',
      '--allow-all',
    ]
  }
  const parsed = JSON.parse(raw) as string[]
  const args = parsed.map((arg) => arg.replaceAll('{prompt}', prompt).replaceAll('{cwd}', cwd))
  return args.some((arg) => arg.includes(prompt)) ? args : [...args, prompt]
}

function buildCopilotAskSquadInvocation(input: {
  cwd: string
  prompt: string
  timeoutMs?: number
}): CommandInvocation {
  return {
    command: copilotCommand(),
    args: copilotArgs(input.cwd, input.prompt),
    cwd: input.cwd,
    timeoutMs: input.timeoutMs ?? Number(process.env.SQUADBOARD_E2E_COPILOT_TIMEOUT_MS ?? 60_000),
  }
}

async function spawnRunner(invocation: CommandInvocation): Promise<CommandResult> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, invocation.timeoutMs)

    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr, timedOut })
    })
  })
}

async function askSquadWithCopilot(
  input: { cwd: string; prompt: string; timeoutMs?: number },
  runner: CommandRunner,
): Promise<CommandResult> {
  return runner(buildCopilotAskSquadInvocation(input))
}

async function generateProjection(projectId: string, projectPath: string): Promise<string> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const ctx = await request.newContext({ baseURL: API_BASE })
  const res = await ctx.post(`/api/projects/${projectId}/squad-sync/generate-github-agent`, {
    data: { dryRun: false },
  })
  const text = await res.text()
  await ctx.dispose()
  expect(res.status(), `generate projection: ${text}`).toBe(200)
  const agentPath = path.join(projectPath, '.github', 'agents', 'squad.agent.md')
  const content = await fs.readFile(agentPath, 'utf-8')
  expect(content).toContain('Squad')
  return agentPath
}

test.describe('Copilot CLI launch and ask Squad', () => {
  test('What does the deterministic runner prove before the live gate? Generated projection, cwd, Squad agent, and prompt are wired.', async () => {
    const path = await import('node:path')
    const project = await createProjectViaApiDetails(`copilot-runner-${Date.now()}`)
    const agentPath = await generateProjection(project.projectId, project.projectPath)
    const prompt = 'Summarize the Squadboard team-sync state in one sentence.'
    const seen: CommandInvocation[] = []

    const result = await askSquadWithCopilot(
      { cwd: project.projectPath, prompt, timeoutMs: 1_000 },
      async (invocation) => {
        seen.push(invocation)
        return {
          exitCode: 0,
          stdout: `fake Copilot asked Squad with ${path.relative(project.projectPath, agentPath)}`,
          stderr: '',
        }
      },
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('.github/agents/squad.agent.md')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      command: copilotCommand(),
      cwd: project.projectPath,
    })
    expect(seen[0].args.join('\n')).toContain('Squad')
    expect(seen[0].args.join('\n')).toContain(prompt)
  })

  test('What happens when a real authenticated Copilot CLI is available? It launches from the project and asks Squad.', async () => {
    test.skip(
      process.env.SQUADBOARD_E2E_LIVE_COPILOT !== '1',
      'Live gate: set SQUADBOARD_E2E_LIVE_COPILOT=1 with an authenticated Copilot CLI. Deterministic runner coverage above is not a live pass.',
    )

    const project = await createProjectViaApiDetails(`copilot-live-${Date.now()}`)
    await generateProjection(project.projectId, project.projectPath)
    const prompt = process.env.SQUADBOARD_E2E_COPILOT_PROMPT
      ?? 'Read .github/agents/squad.agent.md and answer: what is the active Squad authority?'

    const result = await askSquadWithCopilot(
      { cwd: project.projectPath, prompt },
      spawnRunner,
    )

    expect(result.timedOut, `${result.stdout}\n${result.stderr}`).not.toBeTruthy()
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(`${result.stdout}${result.stderr}`.trim().length).toBeGreaterThan(0)
  })
})
