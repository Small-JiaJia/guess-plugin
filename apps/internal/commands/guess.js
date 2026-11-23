import { games, puzzleGames, loadRoleData, randomItem, cleanTimeout, cleanPuzzleGame, getBirthdayMessage } from '../../core.js'
import { generateCrop, renderReveal, renderPuzzleReveal } from '../../image.js'
import { renderPixelReveal } from '../../pixel.js'
import { renderShadowImage } from '../../shadow.js'

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

        const { aliasMap } = await loadRoleData()
        const knownName = aliasMap[input]
        const isCorrect = (input === puzzleState.name) || (knownName === puzzleState.name)

        if (!isCorrect && !knownName) return false

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

    // 普通猜角色模式（含像素、语言、剪影、图标、生日）
    const game = games.get(groupId)
    if (!game) return false

    if (!e.msg || typeof e.msg !== 'string') return false
    const input = e.msg.trim()
    if (input.startsWith('#')) return false

    // 语言模式：只处理 A-F 字母作答
    if (game.isLanguageMode) {
        const letter = input.toUpperCase()
        if (!/^[A-F]$/.test(letter)) {
            return false
        }
        const idx = letter.charCodeAt(0) - 65
        const chosen = game.options[idx]
        if (!chosen) {
            await e.reply('无效选项，请发送 A-F')
            return true
        }
        if (chosen.isCorrect) {
            await e.reply([segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`])
            games.delete(groupId)
            return true
        } else {
            await e.reply('不对哦，再想想~')
            return true
        }
    }

    // 通用角色名匹配
    const { aliasMap } = await loadRoleData()
    const knownName = aliasMap[input]
    const isCorrect = (input === game.name) || (knownName === game.name)

    if (!isCorrect && !knownName) return false

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
        } else if (game.shadowMode) {
            // ★ 剪影模式：附带全揭示剪影图
            let revealBuffer = null
            try {
                const data = game.shadowData
                const gridSize = game.shadowGridSize
                if (data && gridSize) {
                    const allRevealed = new Array(gridSize * gridSize).fill(true)
                    revealBuffer = await renderShadowImage(data, { gridSize, cellRevealed: allRevealed })
                }
            } catch (err) {
                logger?.error('[剪影猜角色] 生成全揭示图失败', err)
            }
            let replyParts = [segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`]
            if (revealBuffer) replyParts.push(segment.image(revealBuffer))
            await e.reply(replyParts)
        }else if (game.isIconMode) {
            await e.reply([segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`])
        } else if (game.isPixelMode) {
            let originalBuffer = null
            try {
                originalBuffer = await renderPixelReveal(game)
            } catch (err) {
                logger?.error('[像素猜角色] 生成原图失败', err)
            }
            let replyParts = [segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`]
            if (originalBuffer) replyParts.push(segment.image(originalBuffer))
            await e.reply(replyParts)
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
