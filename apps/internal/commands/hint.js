import { games, puzzleGames, randomItem, shuffleArray, replyOrThrow, cleanTimeout } from '../../core.js'
import { generateCrop, enlargeCrop, renderPuzzleState } from '../../image.js'
import { buildHintMessage } from '../../icon.js'
import { handlePixelHint } from '../../pixel.js'
import { computeInnerCells, countAllInnerCells, renderShadowImage } from '../../shadow.js'
import { reveal } from './reveal.js'

const hintQueues = new Map()

async function withHintLock(groupId, action) {
    const previous = hintQueues.get(groupId) || Promise.resolve()
    let release
    const current = new Promise(resolve => { release = resolve })
    const tail = previous.then(() => current)
    hintQueues.set(groupId, tail)

    await previous
    try {
        return await action()
    } finally {
        release()
        if (hintQueues.get(groupId) === tail) hintQueues.delete(groupId)
    }
}

// ---------- 提示指令 ----------
export async function hint(e) {
    const groupId = e.group_id
    if (!groupId) return false
    if (cleanTimeout(groupId)) {
        await e.reply('游戏已超时，请重新开始')
        return false
    }

    const game = games.get(groupId)
    const puzzleState = puzzleGames.get(groupId)
    const isCurrentGame = () => games.get(groupId) === game && puzzleGames.get(groupId) === puzzleState

    return withHintLock(groupId, async () => {
        if (!isCurrentGame()) {
            await e.reply('当前游戏状态已变化，请重新发送 #提示')
            return false
        }
        if (cleanTimeout(groupId)) {
            await e.reply('游戏已超时，请重新开始')
            return false
        }
        return hintCurrentGame(e, game, puzzleState, isCurrentGame)
    })
}

async function hintCurrentGame(e, game, puzzleState, isCurrentGame) {
    // 碎碎冰模式
    if (puzzleState) {
        const unrevealed = puzzleState.fragments.filter(f => !f.isRevealed)

        if (unrevealed.length === 0) {
            await e.reply('所有碎片已揭示，请作答或发送 #看答案')
            return true
        }

        const validUnrevealed = unrevealed.filter(f => f.score >= 0.15)
        const targetPool = validUnrevealed.length > 0 ? validUnrevealed : unrevealed
        try {
            if (!game) throw new Error('拼图游戏状态不存在')
            const randomFrag = randomItem(targetPool)
            const fragments = puzzleState.fragments.map(fragment =>
                fragment === randomFrag ? { ...fragment, isRevealed: true } : fragment
            )
            const totalRevealed = fragments.filter(f => f.isRevealed).length
            const buffer = await renderPuzzleState(
                fragments,
                puzzleState.originalWidth,
                puzzleState.originalHeight
            )
            if (!isCurrentGame()) return false
            await replyOrThrow(e, [
                segment.image(buffer),
                `\n📖 #提示 揭示 1 块碎片（已揭示 ${totalRevealed}/${puzzleState.totalCount}）`
            ])
            if (!isCurrentGame()) return false
            randomFrag.isRevealed = true
        } catch (err) {
            logger?.error('[碎碎冰] #提示 揭示碎片失败', err)
            await e.reply(`揭示碎片失败：${err.message}`)
        }
        return true
    }

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
            if (!isCurrentGame()) return false
            await reveal(e)
            return true
        }

        try {
            const nextGame = {
                ...game,
                cropSide: 0,
                cropX: undefined,
                cropY: undefined,
                shownBounds: [...(game.shownBounds || [])],
            }
            const buffer = await generateCrop(nextGame)
            if (!isCurrentGame()) return false
            await replyOrThrow(e, [segment.image(buffer), '\n已刷新视角'])
            if (!isCurrentGame()) return false
            Object.assign(game, {
                cropSide: nextGame.cropSide,
                cropX: nextGame.cropX,
                cropY: nextGame.cropY,
                imageWidth: nextGame.imageWidth,
                imageHeight: nextGame.imageHeight,
                shownBounds: nextGame.shownBounds,
            })
            game.hintCount++
        } catch (err) {
            logger?.error('[猜生日贺图] 重裁失败', err)
            await e.reply(`重裁失败：${err.message}`)
        }
        return true
    }

    // 像素模式：逐步提升分辨率 8→12→16→24→32
    if (game.isPixelMode) {
        try {
            const { buffer, message, nextGridIndex } = await handlePixelHint(game)
            if (!isCurrentGame()) return false
            if (buffer) {
                await replyOrThrow(e, [segment.image(buffer), '\n' + message])
                if (!isCurrentGame()) return false
                game.currentGridIndex = nextGridIndex
            } else {
                await e.reply(message)
            }
        } catch (err) {
            logger?.error('[像素猜角色] 提示失败', err)
            await e.reply(`提示失败：${err.message}`)
        }
        return true
    }

    // ★ 剪影模式：固定步长揭示内部格子
    if (game.shadowMode) {
        const data = game.shadowData
        const gridSize = game.shadowGridSize
        const cellRevealed = game.shadowCellRevealed
            ? [...game.shadowCellRevealed]
            : null

        if (!data || !cellRevealed) {
            await e.reply('游戏状态异常，请重新开始')
            return true
        }

        // 找出所有"内部但未揭示"的格子
        const innerCells = computeInnerCells(data, gridSize, cellRevealed)

        if (innerCells.length === 0) {
            await e.reply('所有剪影内部已揭示，请作答或发送 #看答案')
            return true
        }

        // ★ 固定步长：每次揭示"总内部格数"的 1/5，保证 5 次内完全揭示
        const totalInner = game.shadowTotalInner || countAllInnerCells(data, gridSize)
        const step = Math.max(1, Math.ceil(totalInner / 5))
        const revealCount = Math.min(step, innerCells.length)

        const shuffled = shuffleArray([...innerCells])
        for (let i = 0; i < revealCount && i < shuffled.length; i++) {
            cellRevealed[shuffled[i]] = true
        }

        // 重新渲染
        let buffer
        try {
            buffer = await renderShadowImage(data, { gridSize, cellRevealed })
        } catch (err) {
            logger?.error('[剪影猜角色] 渲染失败', err)
            await e.reply(`渲染失败：${err.message}`)
            return true
        }

        // 统计当前已揭示的内部格子数
        const cellW = data.cropW / gridSize
        const cellH = data.cropH / gridSize
        let revealedInnerCount = 0
        for (let gy = 0; gy < gridSize; gy++) {
            for (let gx = 0; gx < gridSize; gx++) {
                const idx = gy * gridSize + gx
                if (!cellRevealed[idx]) continue
                const x0 = Math.floor(gx * cellW)
                const x1 = Math.floor((gx + 1) * cellW)
                const y0 = Math.floor(gy * cellH)
                const y1 = Math.floor((gy + 1) * cellH)
                let c = 0
                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        if (data.croppedMask[y * data.cropW + x] > 128) c++
                    }
                }
                const area = (x1 - x0) * (y1 - y0)
                if (area > 0 && c / area > 0.10) revealedInnerCount++
            }
        }

        try {
            if (!isCurrentGame()) return false
            await replyOrThrow(e, [
                segment.image(buffer),
                `\n📖 #提示 揭示 ${revealCount} 格（内部进度 ${revealedInnerCount}/${totalInner}）`
            ])
            if (!isCurrentGame()) return false
            game.shadowCellRevealed = cellRevealed
            game.shadowBuffer = buffer
        } catch (err) {
            logger?.error('[剪影猜角色] 发送失败', err)
            await e.reply(`发送失败：${err.message}`)
        }
        return true
    }

    // 图标模式
    if (game.isIconMode) {
        if (!game.hintPool) game.hintPool = []
        if (game.hintIndex === undefined) game.hintIndex = -1

        if (game.hintIndex >= game.hintPool.length - 1) {
            await e.reply('所有提示已给出，请作答或发送 #看答案')
            return true
        }
        const nextHintIndex = game.hintIndex + 1
        const nextGame = { ...game, hintIndex: nextHintIndex }
        const msgParts = buildHintMessage(nextGame)
        try {
            const buffer = await generateCrop(nextGame)
            if (!isCurrentGame()) return false
            await replyOrThrow(e, [...msgParts, segment.image(buffer)])
            if (!isCurrentGame()) return false
            game.hintIndex = nextHintIndex
        } catch (err) {
            logger?.error('[猜角色] 提示失败', err)
            await e.reply(`提示失败：${err.message}`)
        }
        return true
    }

    // 语言模式（不支持提示）
    if (game.isLanguageMode) {
        await e.reply('多语言猜角色模式不支持提示，请直接发送 A-F 作答')
        return true
    }

    // 普通模式：扩大裁剪
    const minSide = Math.min(game.imageWidth, game.imageHeight)
    if (game.cropSide >= minSide) {
        await reveal(e)
        return true
    }

    const nextGame = { ...game, shownBounds: [...(game.shownBounds || [])] }
    const full = enlargeCrop(nextGame)
    try {
        const buffer = await generateCrop(nextGame)
        if (!isCurrentGame()) return false
        await replyOrThrow(e, [segment.image(buffer), '\n已扩大显示区域'])
        if (!isCurrentGame()) return false
        Object.assign(game, {
            cropX: nextGame.cropX,
            cropY: nextGame.cropY,
            cropSide: nextGame.cropSide,
            hints: nextGame.hints,
            shownBounds: nextGame.shownBounds,
            imageWidth: nextGame.imageWidth,
            imageHeight: nextGame.imageHeight,
        })
        if (full) {
            await e.reply('图片已完全显示，再提示将揭示答案')
        }
    } catch (err) {
        logger?.error('[猜角色] 提示生成失败', err)
        await e.reply(`提示失败：${err.message}`)
    }
    return true
}
