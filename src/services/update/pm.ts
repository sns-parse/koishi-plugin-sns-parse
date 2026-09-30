/**
 * 包管理器探测与非交互安装执行器。
 *
 * 铁律（2026-09 踩坑沉淀）：
 * - stdin 一律 ignore：yarn/npm 交互提示会把子进程挂到超时
 * - CI=true 强制非交互；YARN_ENABLE_IMMUTABLE_INSTALLS=false 允许 berry 改锁
 * - 有界等待：超时整树击杀（Windows taskkill /T /F），不留孤儿进程
 * - stdout/stderr 只留尾部（报错用），避免大输出占内存
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export interface PackageManager {
  cmd: string
  args: string[]
  label: string
}

/** 按锁文件探测包管理器（yarn 需兼容 classic 与 berry，二者均为 `yarn add`） */
export function detectPackageManager(baseDir: string): PackageManager {
  if (existsSync(join(baseDir, 'pnpm-lock.yaml'))) return { cmd: 'pnpm', args: ['add'], label: 'pnpm' }
  if (existsSync(join(baseDir, 'yarn.lock')) || existsSync(join(baseDir, '.yarnrc.yml'))) {
    return { cmd: 'yarn', args: ['add'], label: 'yarn' }
  }
  return { cmd: 'npm', args: ['install', '--no-audit', '--no-fund'], label: 'npm' }
}

export interface InstallOutcome {
  ok: boolean
  message: string
  pm: string
}

/** 批量安装精确版本（specs 形如 `@sns-parse/core@0.6.0-alpha.6`）；一次包管理器调用 */
export function installSpecs(specs: string[], baseDir: string, registry: string, timeoutMs = 600000): Promise<InstallOutcome> {
  return new Promise((resolve) => {
    const pm = detectPackageManager(baseDir)
    const args = [...pm.args, ...specs]
    let out = ''
    let settled = false
    const child = spawn(pm.cmd, args, {
      cwd: baseDir,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CI: 'true',
        npm_config_yes: 'true',
        npm_config_registry: registry,
        YARN_NPM_REGISTRY_SERVER: registry,
        YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
      },
    })
    const finish = (ok: boolean, message: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, message, pm: pm.label })
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
          else child.kill('SIGKILL')
        }
      } catch {}
      finish(false, `${pm.label} 安装超时（超过 ${Math.round(timeoutMs / 1000)}s，已终止）`)
    }, timeoutMs)
    child.stdout?.on('data', (d) => { out = (out + String(d)).slice(-4000) })
    child.stderr?.on('data', (d) => { out = (out + String(d)).slice(-4000) })
    child.on('error', (e) => finish(false, `无法启动 ${pm.label}：${e.message}`))
    child.on('close', (code) => {
      if (code === 0) finish(true, `${pm.label} 安装完成（${specs.length} 个包）`)
      else finish(false, `${pm.label} 退出码 ${code}：\n${out.split(/\r?\n/).filter(Boolean).slice(-6).join('\n')}`)
    })
  })
}
