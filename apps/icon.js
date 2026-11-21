// ============================================================
// 模块：图标猜角色 (icon)
// 职责：处理 #命座猜角色、#天赋猜角色、#料理猜角色 及其难度变体
// 依赖：core, image
// ============================================================

import {
    games, recentlyUsed,
    loadRoleData,
    randomItem, shuffleArray,
    withGameStartLock, withRoleReservation, isRoleReserved,
    replyOrThrow, COOLDOWN_MS,
    getExtraData
} from './core.js'
import {
    checkImageExists,
    getFixedIconPath,
    generateCrop
} from './image.js'
import REGION_MAP from '../data/roleinformation.js'

// ---------- 启动图标游戏 ----------
export async function startIconGame(e, baseMode, difficulty, modeName) {
    const groupId = e.group_id
    if (!groupId) return false
    return withGameStartLock(groupId,
        () => e.reply('当前群已有游戏，请先结束或等待超时'),
        () => startIconGameReserved(e, baseMode, difficulty, modeName, groupId)
    )
}

async function startIconGameReserved(e, baseMode, difficulty, modeName, groupId) {
    const { roleNames: loadedNames } = await loadRoleData()
    if (!loadedNames || loadedNames.length === 0) {
        await e.reply('角色数据加载失败，请检查')
        return false
    }

    let mode, initialHintCount
    switch (difficulty) {
        case '简单':
            mode = baseMode + '_simple'
            initialHintCount = 2
            break
        case '困难':
            mode = baseMode + '_hard'
            initialHintCount = 0
            break
        default:
            mode = baseMode
            initialHintCount = 1
            break
    }

    const now = Date.now()
    let imageNames = []
    for (const name of loadedNames) {
        if (baseMode === 'food') {
            const info = REGION_MAP[name]
            if (!info || !info.specialDish) continue
        }
        if (checkImageExists(mode, name)) imageNames.push(name)
    }

    if (imageNames.length === 0) {
        await e.reply(`未找到任何角色的${modeName}图标，请检查图片目录`)
        return false
    }

    const allAvailable = imageNames.filter(name => !isRoleReserved(name))
    if (allAvailable.length === 0) {
        await e.reply('所有可用角色正在生成游戏，请稍后重试')
        return false
    }

    let availableNames = allAvailable.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        availableNames = allAvailable
        logger?.info('[猜角色] 图标模式候选均在冷却中，本次从全部候选中选择')
    }

    if (availableNames.length === 0) {
        await e.reply(`未找到任何角色的${modeName}图标，请检查图片目录`)
        return false
    }

    const name = randomItem(availableNames)
    return withRoleReservation(name, commitRole => startIconGameForRole(
        e, baseMode, difficulty, modeName, groupId, name, mode, initialHintCount, commitRole
    ))
}

async function startIconGameForRole(e, baseMode, difficulty, modeName, groupId, name, mode, initialHintCount, commitRole) {
    const extra = getExtraData(name)
    if (!extra) {
        await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
        return false
    }

    if (baseMode === 'food' && !extra.specialDish) {
        await e.reply(`角色 ${name} 缺少特色料理数据，无法开始游戏`)
        return false
    }

    const iconPath = getFixedIconPath(mode, name)
    if (!iconPath) {
        await e.reply(`未找到 ${name} 的${modeName}图片文件`)
        return false
    }

    const hintPool = [
        { key: 'star', label: '稀有度', value: extra.star === 5 ? '五星 ★★★★★' : '四星 ★★★★' },
        { key: 'element', label: '元素属性', value: extra.element },
        { key: 'weapon', label: '武器类型', value: extra.weapon },
        { key: 'region', label: '所属地区', value: extra.region },
        { key: 'allegiance', label: '所属', value: extra.allegiance },
        { key: 'astro', label: '命之座', value: extra.astro },
        { key: 'title', label: '称号', value: extra.title },
        { key: 'birth', label: '生日', value: extra.birth },
    ].filter(h => h.value !== null && h.value !== undefined && h.value !== '')

    const shuffledPool = shuffleArray([...hintPool])
    const initialIndex = Math.min(initialHintCount, shuffledPool.length) - 1

    const game = {
        mode,
        name,
        iconPath,
        startedAt: Date.now(),
        groupId,
        extra,
        hintIndex: initialIndex,
        hintPool: shuffledPool,
        isIconMode: true,
    }

    try {
        const buffer = await generateCrop(game)
        game.startedAt = Date.now()
        games.set(groupId, game)
        if (initialHintCount > 0 && game.hintIndex >= 0) {
            const msgParts = buildHintMessage(game)
            await replyOrThrow(e, [...msgParts, segment.image(buffer)])
        } else {
            await replyOrThrow(e, segment.image(buffer))
        }
        commitRole()
        const diffName = difficulty === '普通' ? '' : difficulty
        logger?.info(`[猜角色] 群${groupId} 开始${modeName}猜角色${diffName}，角色: ${name}，初始提示: ${initialHintCount}条`)
    } catch (err) {
        if (games.get(groupId) === game) games.delete(groupId)
        logger?.error('[猜角色] 生成图片失败', err)
        await e.reply(`生成图片失败：${err.message}`)
        return false
    }
    return true
}

// ---------- 构建提示消息 ----------
export function buildHintMessage(game) {
    // 防御：确保 game 及必要属性存在
    if (!game || !game.hintPool) {
        return ['游戏状态异常，请重新开始']
    }
    const revealedCount = Math.min(game.hintIndex + 1, game.hintPool.length)
    const revealedHints = game.hintPool.slice(0, revealedCount)

    let modeName = ''
    if (game.mode.startsWith('constellation')) modeName = '命座'
    else if (game.mode.startsWith('talent')) modeName = '天赋'
    else if (game.mode.startsWith('food')) modeName = '料理'
    else modeName = '猜角色'

    const msgParts = [`【${modeName}猜角色】\n`]
    for (const h of revealedHints) {
        msgParts.push(`${h.label}：${h.value}\n`)
    }

    if (revealedCount < game.hintPool.length) {
        msgParts.push('\n发送 #提示 获取更多信息')
    } else {
        msgParts.push('\n所有提示已给出，请作答！')
    }
    return msgParts
}
