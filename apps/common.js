// ============================================================
// 模块：公共指令 (common)
// 职责：处理 guess、hint、reveal、endGame、help 等公共功能
// 依赖：core, image, icon（用于 buildHintMessage）
// ============================================================

import {
    games, puzzleGames,
    loadRoleData,
    randomItem, shuffleArray,
    cleanTimeout, cleanPuzzleGame,
    getBirthdayMessage, getBirthDateString, formatBirthdayMessage
} from './core.js'
import {
    generateCrop,
    enlargeCrop,
    renderReveal,
    renderPuzzleReveal
} from './image.js'
import { buildHintMessage } from './icon.js'   // 用于图标模式提示

// ---------- 帮助指令 ----------
export async function help(e) {
    const helpText = `
猜角色帮助

【启动游戏】
  #猜头像          - 仅显示角色头像局部
  #猜头像侧脸      - 仅显示角色侧脸头像局部
  #猜角色          - 显示抽卡立绘图局部（无滤镜）
  #猜立绘          - 显示全身立绘图局部（无滤镜）
  #碎碎冰猜立绘    - 立绘被打碎成不规则碎片（默认100块）
  #碎碎冰猜角色    - 抽卡立绘被打碎成不规则碎片（默认100块）
  #碎碎冰猜立绘 120 - 指定碎片数量（20~200块）
  #碎碎冰猜角色 120 - 指定碎片数量（20~200块）
  #猜角色困难      - 黑白效果 + 抽卡立绘局部
  #猜角色地狱      - 反色效果 + 抽卡立绘局部
  #猜角色小名片    - 显示小名片局部
  #猜角色名片      - 显示名片局部
  #猜生日贺图      - 显示生日贺图局部（无滤镜）

  #命座猜角色      - 显示命座图标，初始1条提示
  #命座猜角色简单  - 显示命座图标，初始2条提示
  #命座猜角色困难  - 显示命座图标，初始无提示

  #天赋猜角色      - 显示天赋图标，初始1条提示
  #天赋猜角色简单  - 显示天赋图标，初始2条提示
  #天赋猜角色困难  - 显示天赋图标，初始无提示

  #料理猜角色      - 显示特色料理，初始1条提示
  #料理猜角色简单  - 显示特色料理，初始2条提示
  #料理猜角色困难  - 显示特色料理，初始无提示

【碎碎冰玩法说明】
  - 立绘/抽卡立绘被打碎成不规则碎片，全部打乱位置
  - 初始只揭示 2 块碎片（随机位置）
  - 发送角色名作答（或使用别名）
  - 猜错一次 → 累计猜错次数 +1，同时揭示 1 块新碎片（优先有效碎片）
  - 猜错累计达到斐波那契式阈值时，已揭示的碎片自动归位
  - #提示 → 揭示 1 块新碎片（不消耗猜错次数，不触发归位）
  - 答对或看答案时显示不规则碎片合成图

【游戏进行】
  #提示            - 扩大显示区域 / 刷新视角（生日模式）/ 碎碎冰模式揭示碎片
  #看答案          - 揭晓答案
  #结束            - 结束当前游戏

【作答方式】
  直接发送角色名或别名即可作答
    `.trim()
    await e.reply(helpText)
    return true
}

// ---------- 提示指令 ----------
export async function hint(e) {
    const groupId = e.group_id
    if (!groupId) return false
    if (cleanTimeout(groupId)) {
        await e.reply('游戏已超时，请重新开始')
        return false
    }

    // 碎碎冰模式
    if (puzzleGames.has(groupId)) {
        const puzzleState = puzzleGames.get(groupId)
        const unrevealed = puzzleState.fragments.filter(f => !f.isRevealed)

        if (unrevealed.length === 0) {
            await e.reply('所有碎片已揭示，请作答或发送 #看答案')
            return true
        }

        const validUnrevealed = unrevealed.filter(f => f.score >= 0.15)
        const targetPool = validUnrevealed.length > 0 ? validUnrevealed : unrevealed
        const randomFrag = randomItem(targetPool)
        randomFrag.isRevealed = true

        const totalRevealed = puzzleState.fragments.filter(f => f.isRevealed).length

        try {
            const game = games.get(groupId)
            if (game) {
                const buffer = await generateCrop(game)
                await e.reply([
                    segment.image(buffer),
                    `\n📖 #提示 揭示 1 块碎片（已揭示 ${totalRevealed}/${puzzleState.totalCount}）`
                ])
            }
        } catch (err) {
            logger?.error('[碎碎冰] #提示 揭示碎片失败', err)
            await e.reply(`揭示碎片失败：${err.message}`)
        }
        return true
    }

    const game = games.get(groupId)
    if (!game) {
        await e.reply('当前没有进行中的游戏')
        return false
    }

    // 生日模式
    if (game.mode === 'birthday') {
        if (!game.hintCount) game.hintCount = 0
        if (!game.maxHints) game.maxHints = 5

        if (game.hintCount >= game.maxHints) {
            await e.reply('已达到最大提示次数，即将揭晓答案……')
            await reveal(e)
            return true
        }

        game.cropSide = 0
        game.cropX = undefined
        game.cropY = undefined

        try {
            const buffer = await generateCrop(game)
            await e.reply([segment.image(buffer), '\n已刷新视角'])
            game.hintCount++
        } catch (err) {
            logger?.error('[猜生日贺图] 重裁失败', err)
            await e.reply(`重裁失败：${err.message}`)
        }
        return true
    }

    // 图标模式
    if (game.isIconMode) {
        // 防御：确保 hintIndex 和 hintPool 存在
        if (!game.hintPool) game.hintPool = []
        if (game.hintIndex === undefined) game.hintIndex = -1

        if (game.hintIndex >= game.hintPool.length - 1) {
            await e.reply('所有提示已给出，请作答或发送 #看答案')
            return true
        }
        game.hintIndex++
        const msgParts = buildHintMessage(game)
        try {
            const buffer = await generateCrop(game)
            await e.reply([...msgParts, segment.image(buffer)])
        } catch (err) {
            logger?.error('[猜角色] 提示失败', err)
            await e.reply(`提示失败：${err.message}`)
        }
        return true
    }

    // 普通模式：扩大裁剪
    const minSide = Math.min(game.imageWidth, game.imageHeight)
    if (game.cropSide >= minSide) {
        await reveal(e)
        return true
    }

    const full = enlargeCrop(game)
    try {
        const buffer = await generateCrop(game)
        await e.reply([segment.image(buffer), '\n已扩大显示区域'])
        if (full) {
            await e.reply('图片已完全显示，再提示将揭示答案')
        }
    } catch (err) {
        logger?.error('[猜角色] 提示生成失败', err)
        await e.reply(`提示失败：${err.message}`)
    }
    return true
}

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

    if (game.isIconMode) {
        await e.reply(`答案是：${game.name}`)
        games.delete(groupId)
        return true
    }

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

// ---------- 结束游戏 ----------
export async function endGame(e) {
    const groupId = e.group_id
    if (!groupId) return false
    cleanTimeout(groupId)
    const game = games.get(groupId)
    if (!game && !puzzleGames.has(groupId)) {
        await e.reply('当前没有进行中的游戏')
        return false
    }
    cleanPuzzleGame(groupId)
    await e.reply('游戏已结束')
    return true
}

// ---------- 作答处理（guess） ----------
export async function guess(e) {
    if (e.user_id === e.self_id) return false

    const groupId = e.group_id
    if (!groupId) return false
    if (cleanTimeout(groupId)) {
        await e.reply('游戏已超时，请重新开始')
        return true
    }

    // 碎碎冰模式
    if (puzzleGames.has(groupId)) {
        const puzzleState = puzzleGames.get(groupId)
        if (!puzzleState) return false

        if (!e.msg || typeof e.msg !== 'string') return false
        const input = e.msg.trim()
        if (input.startsWith('#')) return false

        // 检查是否匹配别名
        const { aliasMap } = await loadRoleData()
        const knownName = aliasMap[input]
        if (!knownName) return false  // 不是角色名，放行

        const isCorrect = (input === puzzleState.name) || (knownName === puzzleState.name)

        if (isCorrect) {
            let revealBuffer = null
            try {
                revealBuffer = await renderPuzzleReveal(puzzleState)
            } catch (err) {
                logger?.error('[碎碎冰] 生成揭晓图失败', err)
            }
            let replyParts = [segment.at(e.user_id), ` 恭喜答对！答案是 ${puzzleState.name}`]
            if (revealBuffer) replyParts.push(segment.image(revealBuffer))
            await e.reply(replyParts)
            cleanPuzzleGame(groupId)
            return true
        }

        // 猜错
        puzzleState.wrongCount++

        let merged = false
        for (const threshold of puzzleState.mergeThresholds) {
            if (puzzleState.wrongCount === threshold) {
                const revealed = puzzleState.fragments.filter(f => f.isRevealed)
                const unplaced = revealed.filter(f => !f.isPlaced)
                for (const frag of unplaced) frag.isPlaced = true
                merged = true
                break
            }
        }

        let newRevealed = false
        if (!merged) {
            const unrevealed = puzzleState.fragments.filter(f => !f.isRevealed)
            const validUnrevealed = unrevealed.filter(f => f.score >= 0.15)
            if (validUnrevealed.length > 0) {
                const randomFrag = randomItem(validUnrevealed)
                randomFrag.isRevealed = true
                newRevealed = true
            } else if (unrevealed.length > 0) {
                const revealed = puzzleState.fragments.filter(f => f.isRevealed)
                const unplaced = revealed.filter(f => !f.isPlaced)
                if (unplaced.length > 0) {
                    for (const frag of unplaced) frag.isPlaced = true
                    merged = true
                }
            }
        }

        const totalRevealed = puzzleState.fragments.filter(f => f.isRevealed).length
        const totalPlaced = puzzleState.fragments.filter(f => f.isPlaced).length
        const nextThreshold = puzzleState.mergeThresholds.find(t => t > puzzleState.wrongCount)

        let replyMsg = `不对哦，再想想~`
        if (merged) {
            replyMsg += `\n🧊 累计猜错 ${puzzleState.wrongCount} 次，已揭示的碎片全部归位！（已归位 ${totalPlaced}/${totalRevealed}）`
        } else if (newRevealed) {
            replyMsg += `\n🧊 新揭示 1 块碎片（已揭示 ${totalRevealed}/${puzzleState.totalCount}）`
            if (nextThreshold) replyMsg += `（下次归位需累计猜错 ${nextThreshold} 次，当前 ${puzzleState.wrongCount}/${nextThreshold}）`
        } else {
            replyMsg += `\n🧊 所有碎片已揭示，继续猜吧！`
            if (nextThreshold) replyMsg += `（下次归位需累计猜错 ${nextThreshold} 次，当前 ${puzzleState.wrongCount}/${nextThreshold}）`
        }

        try {
            const game = games.get(groupId)
            if (game) {
                const buffer = await generateCrop(game)
                await e.reply([replyMsg, segment.image(buffer)])
            } else {
                await e.reply(replyMsg)
            }
        } catch (err) {
            logger?.error('[碎碎冰] 更新失败', err)
            await e.reply(replyMsg)
        }
        return true
    }

    // 普通猜角色模式
    const game = games.get(groupId)
    if (!game) return false

    if (!e.msg || typeof e.msg !== 'string') return false
    const input = e.msg.trim()
    if (input.startsWith('#')) return false

    const { aliasMap } = await loadRoleData()
    const knownName = aliasMap[input]
    if (!knownName) return false

    const isCorrect = (input === game.name) || (knownName === game.name)

    if (isCorrect) {
        if (game.mode === 'birthday' && game.year) {
            const msg = getBirthdayMessage(game.name, game.year)
            const formattedMsg = msg ? msg.replace(/<br>/g, '\n').trim() : null
            let revealBuffer = null
            try {
                revealBuffer = await renderReveal(game)
            } catch (err) {
                logger?.error('[猜生日贺图] 生成揭晓图失败', err)
            }
            let replyParts = [
                segment.at(e.user_id),
                ` 恭喜答对！\n${game.year}年 『${game.name}』 生日贺图`
            ]
            if (revealBuffer) replyParts.push(segment.image(revealBuffer))
            if (formattedMsg) replyParts.push(`\n\n${formattedMsg}`)
            await e.reply(replyParts)
        } else if (game.isIconMode) {
            await e.reply([segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`])
        } else {
            try {
                const revealBuffer = await renderReveal(game)
                await e.reply([segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`, segment.image(revealBuffer)])
            } catch (err) {
                logger?.error('[猜角色] 生成揭晓图失败', err)
                await e.reply([segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`])
            }
        }
        games.delete(groupId)
        return true
    } else {
        await e.reply('不对哦，再想想~')
        return true
    }
}