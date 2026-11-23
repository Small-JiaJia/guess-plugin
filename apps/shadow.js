// ============================================================
// 模块：剪影猜角色 (shadow)
// 负责开局和游戏状态编排；图像算法位于 ./internal/shadow-engine.js
// ============================================================

import path from 'path'
import {
    games, recentlyUsed,
    loadRoleData,
    randomItem,
    withGameStartLock, withRoleReservation, isRoleReserved,
    replyOrThrow, COOLDOWN_MS,
    getExtraData
} from './core.js'
import {
    GRID_SIZE,
    checkShadowImageExists,
    getRandomShadowImagePath,
    prepareShadowData,
    renderShadowImage,
    computeInnerCells,
    countAllInnerCells
} from './internal/shadow-engine.js'

export {
    prepareShadowData,
    computeInnerCells,
    countAllInnerCells,
    renderShadowImage
} from './internal/shadow-engine.js'

export async function startShadowGame(e) {
    if (!e || !e.group_id) return false
    const groupId = e.group_id
    return withGameStartLock(groupId,
        () => e.reply('当前群已有游戏，请先结束或等待超时'),
        () => startShadowGameReserved(e, groupId)
    )
}

async function startShadowGameReserved(e, groupId) {
    const { roleNames: loadedNames } = await loadRoleData()
    if (!loadedNames || loadedNames.length === 0) {
        await e.reply('角色数据加载失败，请检查')
        return false
    }

    const sourceNames = loadedNames.filter(name => checkShadowImageExists(name))
    if (sourceNames.length === 0) {
        await e.reply('未找到可用的剪影图源，请检查角色资源目录')
        return false
    }
    const allAvailable = sourceNames.filter(name => !isRoleReserved(name))
    if (allAvailable.length === 0) {
        await e.reply('所有可用角色正在生成游戏，请稍后重试')
        return false
    }

    const now = Date.now()
    let availableNames = allAvailable.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        availableNames = allAvailable
        logger?.info('[剪影猜角色] 候选角色均在冷却中，本次从全部候选中选择')
    }

    const name = randomItem(availableNames)
    return withRoleReservation(name, commitRole => startShadowGameForRole(e, groupId, name, commitRole))
}

async function startShadowGameForRole(e, groupId, name, commitRole) {
    const extra = getExtraData(name)
    if (!extra) {
        await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
        return false
    }

    const imgPath = getRandomShadowImagePath(name)
    if (!imgPath) {
        await e.reply(`未找到 ${name} 的可用剪影图源`)
        return false
    }

    let data
    try {
        data = await prepareShadowData(imgPath)
    } catch (err) {
        logger?.error('[剪影猜角色] 预计算失败', err)
        await e.reply(`生成剪影失败：${err.message}`)
        return false
    }

    const cellRevealed = new Array(GRID_SIZE * GRID_SIZE).fill(false)
    const totalInner = countAllInnerCells(data, GRID_SIZE)

    let buffer
    try {
        buffer = await renderShadowImage(data, { gridSize: GRID_SIZE, cellRevealed })
    } catch (err) {
        logger?.error('[剪影猜角色] 生成剪影失败', err)
        await e.reply(`生成剪影失败：${err.message}`)
        return false
    }

    const game = {
        mode: 'shadow',
        name,
        imgPath,
        startedAt: Date.now(),
        groupId,
        extra,
        isIconMode: true,
        shadowMode: true,
        shadowBuffer: buffer,
        shadowData: data,
        shadowGridSize: GRID_SIZE,
        shadowCellRevealed: cellRevealed,
        shadowTotalInner: totalInner,
    }

    const msg = '【剪影猜角色】\n请根据剪影猜角色\n\n发送 #提示 逐步揭示剪影内部，直接发送角色名作答'

    try {
        games.set(groupId, game)
        await replyOrThrow(e, [segment.image(buffer), '\n' + msg])
        commitRole()
        logger?.info(`[剪影猜角色] 群${groupId} 开始游戏，角色: ${name}，图源: ${path.basename(imgPath)}，内部格数: ${totalInner}`)
    } catch (err) {
        if (games.get(groupId) === game) games.delete(groupId)
        logger?.error('[剪影猜角色] 发送失败', err)
        await e.reply(`发送失败：${err.message}`)
        return false
    }
    return true
}
