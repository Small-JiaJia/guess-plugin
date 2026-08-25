// ============================================================
// 模块：普通猜角色 (normal)
// 职责：处理 #猜头像、#猜立绘、#猜角色 等指令
// 依赖：core, image
// ============================================================

import {
    games, recentlyUsed, roleNames, aliasMap,
    loadRoleData, loadBirthdayMessages,
    randomItem, shuffleArray,
    cleanTimeout, COOLDOWN_MS
} from './core.js'
import {
    checkImageExists,
    getImagePath,
    generateCrop,
    renderReveal,
    enlargeCrop
} from './image.js'

// ---------- 解析 #猜... 指令 ----------
export async function guessCommand(e) {
    const match = e.msg.match(/^#猜(头像(?:侧脸)?|角色(?:困难|地狱|小名片|名片)?|立绘)$/)
    if (!match) return false
    const fullMatch = match[1]
    let mode = ''

    if (fullMatch === '头像') {
        mode = 'avatar'
    } else if (fullMatch === '头像侧脸') {
        mode = 'avatar_side'
    } else if (fullMatch === '立绘') {
        mode = 'splash'
    } else if (fullMatch.startsWith('角色')) {
        const suffix = fullMatch.replace('角色', '')
        switch (suffix) {
            case '困难':
                mode = 'hard'
                break
            case '地狱':
                mode = 'hell'
                break
            case '小名片':
                mode = 'banner'
                break
            case '名片':
                mode = 'card'
                break
            default:
                mode = 'gacha'
        }
    } else {
        return false
    }
    return await startGame(e, mode)
}

// ---------- 启动普通猜角色 ----------
export async function startGame(e, mode) {
    // 确保数据已加载（如果未加载，需等待，此处直接调用 core 中的加载函数）
    // 注意：主入口会预先加载，但这里为安全可再检查
    const { roleNames: loadedNames } = await loadRoleData()
    if (!loadedNames || loadedNames.length === 0) {
        await e.reply('角色数据加载失败，请检查')
        return false
    }

    const groupId = e.group_id
    if (!groupId) return false

    cleanTimeout(groupId)
    if (games.has(groupId)) {
        await e.reply('当前群已有游戏，请先结束或等待超时')
        return false
    }

    const now = Date.now()
    const allAvailable = loadedNames.filter(name => checkImageExists(mode, name))
    let availableNames = allAvailable.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        recentlyUsed.clear()
        availableNames = allAvailable
        logger?.info('[猜角色] 冷却已清空，所有角色重新可用')
    }

    if (availableNames.length === 0) {
        await e.reply(`未找到可用的角色图片 (模式: ${mode})`)
        return false
    }

    const name = randomItem(availableNames)
    recentlyUsed.set(name, now)

    const imgPath = getImagePath(mode, name)
    if (!imgPath) {
        await e.reply(`未找到可用的角色图片 (模式: ${mode})`)
        return false
    }

    const game = {
        mode,
        name,
        imgPath,
        startedAt: Date.now(),
        groupId,
        cropSide: 0,
        shownBounds: [],
    }

    try {
        const buffer = await generateCrop(game)
        if (mode === 'splash') {
            await e.reply([segment.image(buffer), '\n发送 #提示 获取更多信息'])
        } else {
            await e.reply(segment.image(buffer))
        }
        games.set(groupId, game)
        logger?.info(`[猜角色] 群${groupId} 开始游戏，角色: ${name}, 模式: ${mode}`)
    } catch (err) {
        logger?.error('[猜角色] 生成图片失败', err)
        await e.reply(`生成图片失败：${err.message}`)
        return false
    }
    return true
}