// ============================================================
// 模块：生日贺图猜角色 (birthday)
// 职责：处理 #猜生日贺图 指令
// 依赖：core, image
// 路径：./plugins/guess-plugin/apps/birthday.js
// ============================================================

import {
    games, recentlyUsed,
    loadRoleData,
    randomItem,
    withGameStartLock, withRoleReservation, isRoleReserved,
    replyOrThrow, COOLDOWN_MS,
    getExtraData, readDataJson, getBirthdayMessage
} from './core.js'
import {
    hasBirthdayImages,
    getRandomBirthdayImage,
    generateCrop,
    renderReveal
} from './image.js'

// ★ 特殊角色（不在 roleId.js，但资源目录存在且有生日贺图）
const SPECIAL_CHARACTERS = ['派蒙']

export async function startBirthday(e) {
    const groupId = e.group_id
    if (!groupId) return false
    return withGameStartLock(groupId,
        () => e.reply('当前群已有游戏，请先结束或等待超时'),
        () => startBirthdayReserved(e, groupId)
    )
}

async function startBirthdayReserved(e, groupId) {
    const { roleNames: loadedNames } = await loadRoleData()
    if (!loadedNames || loadedNames.length === 0) {
        await e.reply('角色数据加载失败，请检查')
        return false
    }

    // 候选：roleId 里有生日贺图的角色 + 特殊角色（有生日贺图的）
    const candidateNames = new Set()
    for (const name of loadedNames) {
        if (hasBirthdayImages(name)) candidateNames.add(name)
    }
    for (const sp of SPECIAL_CHARACTERS) {
        if (hasBirthdayImages(sp)) {
            candidateNames.add(sp)
            logger?.info(`[猜生日贺图] 特殊角色 ${sp} 已加入候选`)
        }
    }
    const allAvailable = Array.from(candidateNames)

    if (allAvailable.length === 0) {
        await e.reply('未找到任何角色的生日贺图，请检查图片目录')
        return false
    }

    const unreserved = allAvailable.filter(name => !isRoleReserved(name))
    if (unreserved.length === 0) {
        await e.reply('所有可用角色正在生成游戏，请稍后重试')
        return false
    }

    // 冷却过滤
    const now = Date.now()
    let availableNames = unreserved.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        availableNames = unreserved
        logger?.info('[猜生日贺图] 候选角色均在冷却中，本次从全部候选中选择')
    }

    const name = randomItem(availableNames)
    return withRoleReservation(name, commitRole => startBirthdayForRole(e, groupId, name, commitRole))
}

async function startBirthdayForRole(e, groupId, name, commitRole) {
    // ★ extra 允许为空（针对派蒙这类特殊角色）
    let extra = getExtraData(name)
    if (!extra) {
        if (SPECIAL_CHARACTERS.includes(name)) {
            // 特殊角色用占位信息（生日模式本身不依赖这些字段）
            extra = {
                star: 5,
                element: '无',
                weapon: '未知',
                region: '未知',
                allegiance: '未知',
            }
        } else {
            await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
            return false
        }
    }

    const imgInfo = getRandomBirthdayImage(name)
    if (!imgInfo) {
        await e.reply(`角色 ${name} 的生日贺图不存在，请检查图片`)
        return false
    }

    const iconPath = imgInfo.filePath
    const year = imgInfo.year
    const json = readDataJson(name)   // 派蒙可能为 null，不影响生日流程

    const game = {
        mode: 'birthday',
        name,
        iconPath,
        year,
        json,
        startedAt: Date.now(),
        groupId,
        extra,
        isBirthday: true,
        cropSide: 0,
        shownBounds: [],
        hintCount: 0,
        maxHints: 5,
    }

    try {
        const buffer = await generateCrop(game)
        game.startedAt = Date.now()
        games.set(groupId, game)
        await replyOrThrow(e, [segment.image(buffer), '\n发送 #提示 刷新视角'])
        commitRole()
        logger?.info(`[猜生日贺图] 群${groupId} 开始游戏，角色: ${name}, 年份: ${year}`)
    } catch (err) {
        if (games.get(groupId) === game) games.delete(groupId)
        logger?.error('[猜生日贺图] 生成图片失败', err)
        await e.reply(`生成图片失败：${err.message}`)
        return false
    }
    return true
}
