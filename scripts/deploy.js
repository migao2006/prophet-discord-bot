import { execFileSync, spawn } from 'node:child_process';

const PROJECT_ID = 'prophet-discord-bot';
const SERVICE_ID = 'prophet-bot';
const WORKFLOW = 'container.yml';
const WAIT_INTERVAL_MS = 5_000;
const RUN_DISCOVERY_TIMEOUT_MS = 120_000;
const BOT_READY_TIMEOUT_MS = 180_000;

const executables = process.platform === 'win32'
  ? { npm: 'npm.cmd', gh: 'gh.exe', northflank: 'northflank.cmd' }
  : { npm: 'npm', gh: 'gh', northflank: 'northflank' };

function capture(command, args) {
  const invocation = resolveInvocation(command, args);
  return execFileSync(invocation.command, invocation.args, { encoding: 'utf8' }).trim();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const invocation = resolveInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code})`));
    });
  });
}

function resolveInvocation(command, args) {
  if (process.platform !== 'win32' || !command.toLowerCase().endsWith('.cmd')) {
    return { command, args };
  }
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', command, ...args],
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertReadyToDeploy() {
  const branch = capture('git', ['branch', '--show-current']);
  if (branch !== 'main') throw new Error(`部署只能從 main 執行，目前分支是 ${branch}`);

  const changes = capture('git', ['status', '--porcelain']);
  if (changes) throw new Error('工作目錄仍有未提交變更，請先提交後再部署。');

  capture(executables.gh, ['auth', 'status']);
  capture(executables.northflank, ['get', 'auth', '--output', 'json']);
}

async function findWorkflowRun(headSha) {
  const deadline = Date.now() + RUN_DISCOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const output = capture(executables.gh, [
      'run', 'list',
      '--workflow', WORKFLOW,
      '--commit', headSha,
      '--limit', '1',
      '--json', 'databaseId,status,conclusion',
    ]);
    const [workflowRun] = JSON.parse(output || '[]');
    if (workflowRun) return workflowRun;
    await sleep(WAIT_INTERVAL_MS);
  }
  throw new Error('等待 GitHub Actions 建立執行項目逾時。');
}

async function waitForBotReady(startTime) {
  const deadline = Date.now() + BOT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const output = capture(executables.northflank, [
        'get', 'service', 'logs',
        '--projectId', PROJECT_ID,
        '--serviceId', SERVICE_ID,
        '--types', 'runtime',
        '--startTime', startTime,
        '--lineLimit', '100',
        '--direction', 'backward',
        '--textIncludes', 'bot_ready',
        '--noDefaults',
        '--output', 'json',
      ]);
      if (output.includes('bot_ready')) return;
    } catch {
      // The replacement container may not have logs yet while it is starting.
    }
    await sleep(WAIT_INTERVAL_MS);
  }
  throw new Error('Northflank 已重新啟動，但等待 bot_ready 逾時，請檢查服務日誌。');
}

async function deploy() {
  assertReadyToDeploy();

  console.log('1/6 執行程式檢查');
  await run(executables.npm, ['run', 'check']);
  await run(executables.npm, ['test']);

  console.log('2/6 推送 main');
  await run('git', ['push', 'origin', 'main']);
  const headSha = capture('git', ['rev-parse', 'HEAD']);

  console.log('3/6 等待 GitHub 建置容器');
  const workflowRun = await findWorkflowRun(headSha);
  await run(executables.gh, ['run', 'watch', String(workflowRun.databaseId), '--exit-status']);

  console.log('4/6 重新啟動 Northflank 服務');
  const restartStartedAt = new Date(Date.now() - 5_000).toISOString();
  await run(executables.northflank, [
    'restart', 'service',
    '--projectId', PROJECT_ID,
    '--serviceId', SERVICE_ID,
    '--noDefaults',
    '--output', 'json',
  ]);

  console.log('5/6 等待 Discord Bot 上線');
  await waitForBotReady(restartStartedAt);

  console.log('6/6 同步 Discord 全域指令');
  await run(executables.npm, ['run', 'register']);
  console.log(`部署完成：${headSha.slice(0, 7)}，已確認 bot_ready。`);
}

deploy().catch((error) => {
  console.error(`部署失敗：${error.message}`);
  process.exitCode = 1;
});
