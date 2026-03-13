#!/usr/bin/env node

const readline = require('readline');
const { createUsageDb } = require('../server/db');
const { createLocalAuth } = require('../server/localAuth');

let nonTtyLinesPromise = null;
let nonTtyLineIndex = 0;

function readNonTtyLine(promptText) {
  process.stdout.write(promptText);

  if (!nonTtyLinesPromise) {
    nonTtyLinesPromise = new Promise((resolve, reject) => {
      let raw = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        raw += chunk;
      });
      process.stdin.on('end', () => {
        resolve(raw.split(/\r?\n/));
      });
      process.stdin.on('error', reject);
    });
  }

  return nonTtyLinesPromise.then((lines) => {
    process.stdout.write('\n');
    const value = Array.isArray(lines) ? lines[nonTtyLineIndex] : '';
    nonTtyLineIndex += 1;
    return typeof value === 'string' ? value : '';
  });
}

function promptLine(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return readNonTtyLine(promptText);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptLine(promptText);
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';

    stdout.write(promptText);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    const handleData = (chunk) => {
      const input = String(chunk);

      if (input === '\u0003') {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handleData);
        process.exit(130);
      }

      if (input === '\r' || input === '\n') {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handleData);
        resolve(value);
        return;
      }

      if (input === '\u007f') {
        value = value.slice(0, -1);
        return;
      }

      value += input;
    };

    stdin.on('data', handleData);
  });
}

async function main() {
  const usageDb = createUsageDb();
  const { resetSingleAdminPassword } = createLocalAuth({ usageDb });

  try {
    const nextPassword = await promptHidden('请输入新的管理员密码: ');
    const confirmPassword = await promptHidden('请再次输入新的管理员密码: ');

    if (nextPassword !== confirmPassword) {
      throw new Error('两次输入的密码不一致');
    }

    const user = resetSingleAdminPassword(nextPassword);
    process.stdout.write(`管理员 ${user.username} 的密码已重置，现有登录会话已失效。\n`);
  } finally {
    usageDb.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exit(1);
});
