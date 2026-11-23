// ============================================================
// 模块：公共指令入口
// 职责：帮助命令与游戏命令导出
// ============================================================

import { renderHelpImage } from '../utils/help-image.js'
import { helpText } from '../config/help.js'

// ---------- 帮助指令 ----------
export async function help(e) {
    try {
        await e.reply(segment.image(await renderHelpImage()))
    } catch (err) {
        logger?.error('[猜角色] 帮助图渲染失败，回退到文字帮助', err)
        await e.reply(helpText)
    }
    return true
}

export { hint } from './internal/commands/hint.js'
export { reveal } from './internal/commands/reveal.js'
export { endGame } from './internal/commands/end-game.js'
export { guess } from './internal/commands/guess.js'
