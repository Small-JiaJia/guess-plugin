import { games, puzzleGames, cleanTimeout, cleanPuzzleGame, getBirthdayMessage } from '../../core.js'
import { renderReveal, renderPuzzleReveal } from '../../image.js'
import { renderPixelReveal } from '../../pixel.js'
import { renderShadowImage } from '../../shadow.js'

// ---------- 看答案 ----------
export async function reveal(e) {
    const groupId = e.group_id
    if (!groupId) return false
    if (cleanTimeout(groupId)) {
        await e.reply('游戏已超时')
        return false
    }

    // 碎碎冰模式
    if (puzzleGames.has(groupId)) {
        const puzzleState = puzzleGames.get(groupId)
        if (!puzzleState) {
            await e.reply('当前没有进行中的碎碎冰游戏')
            return false
        }
        let revealBuffer = null
        try {
            revealBuffer = await renderPuzzleReveal(puzzleState)
        } catch (err) {
            logger?.error('[碎碎冰] 生成揭晓图失败', err)
        }
        let replyParts = [`答案是：${puzzleState.name}`]
        if (revealBuffer) replyParts.push(segment.image(revealBuffer))
        await e.reply(replyParts)
        cleanPuzzleGame(groupId)
        return true
    }

    const game = games.get(groupId)
    if (!game) {
        await e.reply('当前没有进行中的游戏')
        return false
    }

    // 生日模式
    if (game.mode === 'birthday' && game.year) {
        const msg = getBirthdayMessage(game.name, game.year)
        const formattedMsg = msg ? msg.replace(/<br>/g, '\n').trim() : null
        let revealBuffer = null
        try {
            revealBuffer = await renderReveal(game)
        } catch (err) {
            logger?.error('[猜生日贺图] 生成揭晓图失败', err)
        }
        let replyParts = [`答案是：\n${game.year}年 『${game.name}』 生日贺图`]
        if (revealBuffer) replyParts.push(segment.image(revealBuffer))
        if (formattedMsg) replyParts.push(`\n\n${formattedMsg}`)
        await e.reply(replyParts)
        games.delete(groupId)
        return true
    }

    // 图标模式
    if (game.isIconMode && !game.shadowMode) {
        await e.reply(`答案是：${game.name}`)
        games.delete(groupId)
        return true
    }

    // 像素模式
    if (game.isPixelMode) {
        let originalBuffer = null
        try {
            originalBuffer = await renderPixelReveal(game)
        } catch (err) {
            logger?.error('[像素猜角色] 生成原图失败', err)
        }
        let replyParts = [`答案是：${game.name}`]
        if (originalBuffer) replyParts.push(segment.image(originalBuffer))
        await e.reply(replyParts)
        games.delete(groupId)
        return true
    }

    // ★ 剪影模式：显示答案 + 全揭示剪影图
    if (game.shadowMode) {
        let revealBuffer = null
        try {
            const data = game.shadowData
            const gridSize = game.shadowGridSize
            if (data && gridSize) {
                // 全部格子标记为已揭示，得到"完全揭开"的剪影图
                const allRevealed = new Array(gridSize * gridSize).fill(true)
                revealBuffer = await renderShadowImage(data, { gridSize, cellRevealed: allRevealed })
            }
        } catch (err) {
            logger?.error('[剪影猜角色] 生成全揭示图失败', err)
        }
        let replyParts = [`答案是：${game.name}`]
        if (revealBuffer) replyParts.push(segment.image(revealBuffer))
        await e.reply(replyParts)
        games.delete(groupId)
        return true
    }

    // 语言模式
    if (game.isLanguageMode) {
        await e.reply(`答案是：${game.name}`)
        games.delete(groupId)
        return true
    }

    // 普通模式
    try {
        const revealBuffer = await renderReveal(game)
        await e.reply([`答案是：${game.name}`, segment.image(revealBuffer)])
    } catch (err) {
        logger?.error('[猜角色] 生成揭晓图失败', err)
        await e.reply(`答案是：${game.name}`)
    }
    games.delete(groupId)
    return true
}
