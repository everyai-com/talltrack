import { claudeEngine, CLAUDE_DEFAULT_MODEL, CLAUDE_JUDGE_MODEL } from './claude'
import { codexEngine, CODEX_DEFAULT_MODEL, CODEX_JUDGE_MODEL } from './codex'
import type { Engine, EngineCredential } from './types'

export * from './types'
export { CLAUDE_DEFAULT_MODEL, CLAUDE_JUDGE_MODEL, CODEX_DEFAULT_MODEL, CODEX_JUDGE_MODEL }

export function engineFor(cred: EngineCredential): Engine {
  return cred.engine === 'claude' ? claudeEngine(cred) : codexEngine(cred)
}

/**
 * The judge must not be the writer. Same subscription, deliberately a different
 * call and a cheaper model — an editor allowed to grade its own draft accepts
 * its own merely-competent one. This is the same separation the Editor OS
 * module is built on.
 */
export function judgeEngineFor(cred: EngineCredential): Engine {
  return engineFor({
    ...cred,
    model: cred.engine === 'claude' ? CLAUDE_JUDGE_MODEL : CODEX_JUDGE_MODEL,
  })
}
