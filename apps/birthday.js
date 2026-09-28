// ============================================================
// 模块：生日贺图猜角色 (birthday)
// 路径：./plugins/guess-plugin/apps/birthday.js
// ============================================================

import {
    games, recentlyUsed,
    loadRoleData,
    randomItem,
    cleanTimeout, COOLDOWN_MS,
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

    // 冷却过滤
    const now = Date.now()
    let availableNames = allAvailable.filter(name => {
        const lastUsed = recentlyUsed.get(name) || 0
        return now - lastUsed >= COOLDOWN_MS
    })
    if (availableNames.length === 0) {
        recentlyUsed.clear()
        availableNames = allAvailable
        logger?.info('[猜生日贺图] 冷却已清空，所有角色重新可用')
    }

    const name = randomItem(availableNames)
    recentlyUsed.set(name, now)

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
        await e.reply([segment.image(buffer), '\n发送 #提示 刷新视角'])
        games.set(groupId, game)
        logger?.info(`[猜生日贺图] 群${groupId} 开始游戏，角色: ${name}, 年份: ${year}`)
    } catch (err) {
        logger?.error('[猜生日贺图] 生成图片失败', err)
        await e.reply(`生成图片失败：${err.message}`)
        return false
    }
    return true
}