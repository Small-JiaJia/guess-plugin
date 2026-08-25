// ============================================================
// 模块：核心 (core)
// 职责：管理游戏状态、冷却记录、加载角色数据、提供通用工具函数
// 依赖：fs, path, 以及 roleId.js, roleinformation.js, birthdayMessages.json
// ============================================================

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'url'
import REGION_MAP from '../data/roleinformation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- 路径常量 ----------
const ROLE_DATA_PATH = path.join(__dirname, '../data/roleId.js')
const BIRTHDAY_MSG_PATH = path.join(__dirname, '../data/birthdayMessages.json')

// ---------- 游戏状态 ----------
export const games = new Map()                       // 每个群的进行中游戏（普通/生日/图标模式）
export const puzzleGames = new Map()                 // 碎碎冰游戏状态（独立存储）
export const GAME_TIMEOUT = 5 * 60 * 1000            // 游戏超时 5 分钟

// ---------- 冷却机制 ----------
export const COOLDOWN_MS = 24 * 60 * 60 * 1000       // 角色冷却 24 小时
export const recentlyUsed = new Map()                // 角色名 → 上次出现时间戳

// ---------- 角色别名缓存 ----------
export let roleNames = null
export let aliasMap = null
let roleLoading = false

// ---------- 生日贺语缓存 ----------
export let birthdayMessages = null
let msgLoading = false

// ---------- 加载角色别名数据 ----------
export async function loadRoleData() {
    if (roleNames && aliasMap) return { roleNames, aliasMap }
    if (roleLoading) {
        while (roleLoading) await new Promise(r => setTimeout(r, 100))
        return { roleNames, aliasMap }
    }
    roleLoading = true
    try {
        const fileUrl = pathToFileURL(ROLE_DATA_PATH).href + '?t=' + Date.now()
        const module = await import(fileUrl)
        const data = module.default || module

        const names = []
        const alias = {}
        for (const [id, arr] of Object.entries(data)) {
            if (!Array.isArray(arr) || arr.length === 0) continue
            const mainName = arr[0]
            if (!mainName) continue
            names.push(mainName)
            for (const aliasName of arr) {
                if (aliasName && typeof aliasName === 'string') {
                    alias[aliasName] = mainName
                }
            }
        }
        if (names.length === 0) throw new Error('角色列表为空')
        roleNames = names
        aliasMap = alias
        logger?.info(`[猜角色] 加载了 ${names.length} 个角色，${Object.keys(alias).length} 个别名`)
    } catch (err) {
        logger?.error('[猜角色] 加载角色数据失败', err)
        throw err
    } finally {
        roleLoading = false
    }
    return { roleNames, aliasMap }
}

// ---------- 加载生日贺语数据 ----------
export async function loadBirthdayMessages() {
    if (birthdayMessages) return birthdayMessages
    if (msgLoading) {
        while (msgLoading) await new Promise(r => setTimeout(r, 100))
        return birthdayMessages
    }
    msgLoading = true
    try {
        const content = fs.readFileSync(BIRTHDAY_MSG_PATH, 'utf-8')
        birthdayMessages = JSON.parse(content)
        logger?.info(`[猜角色] 加载了 ${Object.keys(birthdayMessages).length} 个角色的生日贺语`)
    } catch (err) {
        logger?.error('[猜角色] 加载生日贺语失败', err)
        birthdayMessages = {}
    } finally {
        msgLoading = false
    }
    return birthdayMessages
}

// ---------- 工具函数 ----------
export function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
}

export function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
}

// ---------- 从 data.json 读取角色信息 ----------
export function readDataJson(name) {
    const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')
    const jsonPath = path.join(GENSHIN_CHARACTER_DIR, name, 'data.json')
    if (!fs.existsSync(jsonPath)) return null
    try {
        const content = fs.readFileSync(jsonPath, 'utf-8')
        return JSON.parse(content)
    } catch {
        return null
    }
}

// ---------- 获取角色额外信息（用于提示） ----------
export function getExtraData(name) {
    const json = readDataJson(name)
    if (!json) return null
    const roleInfo = REGION_MAP[name] || {}

    const weaponMap = {
        'sword': '单手剑',
        'claymore': '双手剑',
        'polearm': '长柄武器',
        'bow': '弓',
        'catalyst': '法器'
    }
    const elementMap = {
        'pyro': '火',
        'hydro': '水',
        'anemo': '风',
        'electro': '雷',
        'geo': '岩',
        'cryo': '冰',
        'dendro': '草',
        'none': '无'
    }

    return {
        star: json.star || 5,
        rarity: json.star || 5,
        weapon: weaponMap[json.weapon] || json.weapon || '未知',
        allegiance: json.allegiance || '未知',
        region: roleInfo.region || '未知',
        specialDish: roleInfo.specialDish || null,
        element: elementMap[json.elem] || json.elem || '未知',
        title: json.title || null,
        astro: json.astro || null,
        birth: json.birth ? json.birth.replace('-', '月') + '日' : null,
    }
}

// ---------- 获取生日贺语 ----------
export function getBirthdayMessage(name, year) {
    if (!birthdayMessages) return null
    const msgs = birthdayMessages[name] || {}
    if (msgs[year]) return msgs[year]
    const years = Object.keys(msgs).map(Number).sort((a, b) => b - a)
    for (const y of years) {
        if (y <= year) return msgs[y]
    }
    return null
}

// ---------- 获取生日完整日期 ----------
export function getBirthDateString(json) {
    if (!json || !json.birth) return null
    const parts = json.birth.split('-')
    if (parts.length !== 2) return null
    return `${parts[0]}月${parts[1]}日`
}

// ---------- 格式化贺语 ----------
export function formatBirthdayMessage(msg) {
    if (!msg) return null
    return msg.replace(/<br>/g, '\n').trim()
}

// ---------- 清理碎碎冰游戏状态 ----------
export function cleanPuzzleGame(groupId) {
    if (puzzleGames.has(groupId)) {
        const pState = puzzleGames.get(groupId)
        if (pState && pState.fragments) {
            pState.fragments = null
        }
        puzzleGames.delete(groupId)
    }
    if (games.has(groupId)) {
        games.delete(groupId)
    }
    if (global.gc) {
        global.gc()
    }
}

// ---------- 检查游戏是否超时 ----------
export function cleanTimeout(groupId) {
    const game = games.get(groupId)
    if (game && Date.now() - game.startedAt > GAME_TIMEOUT) {
        cleanPuzzleGame(groupId)
        return true
    }
    if (puzzleGames.has(groupId)) {
        const pState = puzzleGames.get(groupId)
        if (Date.now() - pState.startedAt > GAME_TIMEOUT) {
            cleanPuzzleGame(groupId)
            return true
        }
    }
    return false
}