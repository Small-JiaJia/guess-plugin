// ============================================================
// 插件名称：猜角色 (Guess)
// 功能：通过角色图片局部、命座图标、天赋图标、特色料理、生日贺图等让群友猜角色
// 路径：./plugins/guess-plugin/app/guess.js
// 依赖：roleId.js、roleinformation.js、角色目录下的 data.json、birthdayMessages.json
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'url'
import REGION_MAP from '../data/roleinformation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- 路径常量 ----------
// 角色别名数据文件路径
const ROLE_DATA_PATH = path.join(__dirname, '../data/roleId.js')
// 角色资源目录（包含每个角色的 imgs、icons 等）
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')
// 生日贺语 JSON 数据文件路径
const BIRTHDAY_MSG_PATH = path.join(__dirname, '../data/birthdayMessages.json')

// ---------- 游戏状态 ----------
// 存储每个群正在进行的游戏（groupId → game对象）
const games = new Map()
// 游戏超时时间 5 分钟
const GAME_TIMEOUT = 5 * 60 * 1000

// ---------- 冷却机制 ----------
// 角色冷却时间 24 小时（避免同一角色短时间内频繁出现）
const COOLDOWN_MS = 24 * 60 * 60 * 1000
// 记录每个角色上次出现的时间戳（角色名 → 时间戳）
const recentlyUsed = new Map()

// ---------- 角色别名缓存 ----------
// 所有角色名列表（从 roleId.js 提取的主名）
let roleNames = null
// 别名 → 主名 的映射表
let aliasMap = null
// 防止重复加载的标志
let roleLoading = false

// ---------- 生日贺语缓存 ----------
let birthdayMessages = null
let msgLoading = false

// ---------- 加载角色别名数据 ----------
// 从 roleId.js 中提取所有角色主名和别名，建立映射
async function loadRoleData() {
    if (roleNames && aliasMap) return { roleNames, aliasMap }
    if (roleLoading) {
        while (roleLoading) await new Promise(r => setTimeout(r, 100))
        return { roleNames, aliasMap }
    }
    roleLoading = true
    try {
        // 动态导入 roleId.js（使用 pathToFileURL 解决 Windows 路径问题）
        const fileUrl = pathToFileURL(ROLE_DATA_PATH).href + '?t=' + Date.now()
        const module = await import(fileUrl)
        const data = module.default || module

        const names = []
        const alias = {}
        // 遍历每个角色的数据，数组第一个元素为主名，其余为别名
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
// 使用 fs.readFileSync 直接读取 JSON 文件（避免 ESM import 属性问题）
async function loadBirthdayMessages() {
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
// 从数组中随机取一项
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// Fisher–Yates 洗牌算法，用于打乱提示顺序
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
}

// ---------- 从 data.json 读取角色信息 ----------
// 每个角色目录下的 data.json 包含角色详细信息
function readDataJson(name) {
    const jsonPath = path.join(GENSHIN_CHARACTER_DIR, name, 'data.json')
    if (!fs.existsSync(jsonPath)) return null
    try {
        const content = fs.readFileSync(jsonPath, 'utf-8')
        return JSON.parse(content)
    } catch {
        return null
    }
}

// 获取角色的额外数据（元素、武器、所属、地区、料理等）
// 优先从 data.json 读取，部分字段从 roleinformation.js 补充
function getExtraData(name) {
    const json = readDataJson(name)
    if (!json) return null
    const roleInfo = REGION_MAP[name] || {}

    // 武器类型英文→中文映射
    const weaponMap = {
        'sword': '单手剑',
        'claymore': '双手剑',
        'polearm': '长柄武器',
        'bow': '弓',
        'catalyst': '法器'
    }
    // 元素属性英文→中文映射
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
        star: json.star || 5,                                  // 星级
        rarity: json.star || 5,                                // 同 star
        weapon: weaponMap[json.weapon] || json.weapon || '未知', // 武器类型（中文）
        allegiance: json.allegiance || '未知',                  // 所属（组织/势力）
        region: roleInfo.region || '未知',                      // 所属地区（国家/城市）
        specialDish: roleInfo.specialDish || null,              // 特色料理名称
        element: elementMap[json.elem] || json.elem || '未知',  // 元素属性（中文）
        title: json.title || null,                              // 称号
        astro: json.astro || null,                              // 命之座名称
        birth: json.birth ? json.birth.replace('-', '月') + '日' : null, // 生日（月日）
    }
}

// ---------- 获取生日贺语 ----------
// 根据角色名和年份从 birthdayMessages 中查找对应贺语
function getBirthdayMessage(name, year) {
    if (!birthdayMessages) return null
    const msgs = birthdayMessages[name] || {}
    if (msgs[year]) return msgs[year]
    // 若无该年份，则取最近年份（小于等于当前年份）
    const years = Object.keys(msgs).map(Number).sort((a, b) => b - a)
    for (const y of years) {
        if (y <= year) return msgs[y]
    }
    return null
}

// ---------- 获取生日完整日期 ----------
// 从 data.json 的 birth 字段提取月日，格式化为 "X月Y日"
function getBirthDateString(json) {
    if (!json || !json.birth) return null
    const parts = json.birth.split('-')
    if (parts.length !== 2) return null
    return `${parts[0]}月${parts[1]}日`
}

// ---------- 格式化贺语 ----------
// 将贺语中的 <br> 替换为换行符 \n
function formatBirthdayMessage(msg) {
    if (!msg) return null
    return msg.replace(/<br>/g, '\n').trim()
}

// ---------- 生成信封格式答案 ----------
// 用于生日贺图答对或看答案时显示
function buildEnvelopeAnswer(name, year, extra, msg, json) {
    const dateStr = getBirthDateString(json) || '未知日期'
    const formattedMsg = formatBirthdayMessage(msg)

    let envelope = `发件人：${name}\n`
    envelope += `时间：${year}年 ${dateStr}`
    if (formattedMsg) {
        envelope += `\n\n${formattedMsg}`
    }
    return envelope
}

// ---------- ★ 核心：获取图片路径（支持默认和特殊立绘随机） ----------
// 普通模式（头像/立绘/角色等）支持随机选择默认或特殊立绘
// 特殊立绘命名规则：face2.webp、side2.webp、splash2.webp
function getImagePath(mode, name, fixedPath = null) {
    // 如果传入了固定路径，优先使用（用于生日贺图）
    if (fixedPath) {
        if (fs.existsSync(fixedPath)) return fixedPath
        return null
    }

    // 生日贺图模式：从 imgs 目录中随机选一张 Birthday-年份.webp
    if (mode === 'birthday') {
        const img = getRandomBirthdayImage(name)
        return img ? img.filePath : null
    }

    // ★ 料理模式（包含简单和困难）
    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(p) ? p : null
    }

    // ★ 命座模式：从 cons-1~6.webp 中随机选一张
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        const num = Math.floor(Math.random() * 6) + 1
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', `cons-${num}.webp`)
        return fs.existsSync(p) ? p : null
    }

    // ★ 天赋模式：从 passive-数字.webp 中随机选一张
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return null
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        if (files.length === 0) return null
        return path.join(dir, randomItem(files))
    }

    // ★ 普通模式：根据 mode 获取文件名，随机选择默认或特殊立绘
    const fileNameMap = {
        'avatar': 'face',
        'avatar_side': 'side',
        'splash': 'splash',
        'banner': 'banner',
        'card': 'card',
        'gacha': 'gacha',
        'hard': 'gacha',
        'hell': 'gacha'
    }

    const baseName = fileNameMap[mode]
    if (!baseName) return null

    const imgsDir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(imgsDir)) return null

    // 收集所有可用路径（默认 + 特殊）
    const available = []
    // 特殊立绘只存在于 avatar、avatar_side、splash 三种模式
    const specialModes = ['avatar', 'avatar_side', 'splash']
    const candidates = [`${baseName}.webp`]
    if (specialModes.includes(mode)) {
        candidates.push(`${baseName}2.webp`)
    }

    for (const candidate of candidates) {
        const p = path.join(imgsDir, candidate)
        if (fs.existsSync(p)) available.push(p)
    }

    if (available.length === 0) return null

    // ★ 随机选择一个（如果有多个）
    return randomItem(available)
}

// ---------- 检查图片是否存在 ----------
// 判断角色是否有对应模式的图片（用于筛选可用角色）
function checkImageExists(mode, name) {
    // 料理模式（包含简单和困难）
    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(filePath)
    }
    // 命座模式
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', 'cons-1.webp')
        return fs.existsSync(filePath)
    }
    // 天赋模式
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return false
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        return files.length > 0
    }
    // 普通模式（头像、立绘等）
    const fileNameMap = {
        'avatar': 'face',
        'avatar_side': 'side',
        'splash': 'splash',
        'banner': 'banner',
        'card': 'card',
        'gacha': 'gacha',
        'hard': 'gacha',
        'hell': 'gacha'
    }
    const baseName = fileNameMap[mode]
    if (!baseName) return false

    const imgsDir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(imgsDir)) return false

    const candidates = [`${baseName}.webp`]
    if (['avatar', 'avatar_side', 'splash'].includes(mode)) {
        candidates.push(`${baseName}2.webp`)
    }

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(imgsDir, candidate))) return true
    }
    return false
}

// ---------- 获取固定图标路径（用于命座/天赋/料理/生日） ----------
// 游戏开始时固定图片路径，后续提示不再更改
function getFixedIconPath(mode, name) {
    if (mode === 'birthday') {
        const img = getRandomBirthdayImage(name)
        return img ? img.filePath : null
    }
    // 料理模式（包含简单和困难）
    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(p) ? p : null
    }
    // 命座模式
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        const num = Math.floor(Math.random() * 6) + 1
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', `cons-${num}.webp`)
        return fs.existsSync(p) ? p : null
    }
    // 天赋模式
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return null
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        if (files.length === 0) return null
        return path.join(dir, randomItem(files))
    }
    // 普通模式：调用 getImagePath 获取随机图片（用于预选）
    return getImagePath(mode, name)
}

// ---------- 生日贺图辅助函数 ----------
// 检查角色是否有生日贺图
function hasBirthdayImages(name) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(dir)) return false
    const files = fs.readdirSync(dir)
    return files.some(f => /^Birthday-\d+\.(webp|png|jpg|jpeg)$/i.test(f))
}

// 随机获取一张生日贺图路径和年份
function getRandomBirthdayImage(name) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter(f => /^Birthday-\d+\.(webp|png|jpg|jpeg)$/i.test(f))
    if (files.length === 0) return null
    const selected = randomItem(files)
    const match = selected.match(/Birthday-(\d+)\./i)
    const year = match ? parseInt(match[1]) : null
    return { filePath: path.join(dir, selected), year }
}

// 根据角色名和年份获取对应的生日贺图路径
function getBirthdayImagePath(name, year) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    const exts = ['.webp', '.png', '.jpg', '.jpeg']
    for (const ext of exts) {
        const p = path.join(dir, `Birthday-${year}${ext}`)
        if (fs.existsSync(p)) return p
    }
    return null
}
// ---------- 图像生成核心 ----------
// 根据游戏状态生成裁剪图（普通模式）或全图（图标模式）
async function generateCrop(game) {
    const { mode, name, iconPath, imgPath } = game

    // 命座/天赋/料理模式：直接使用固定图片（不裁剪）
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard' ||
        mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard' ||
        mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        if (!iconPath || !fs.existsSync(iconPath)) {
            throw new Error(`图片不存在: ${name}`)
        }
        const image = sharp(iconPath)
        return await image.webp({ quality: 90 }).toBuffer()
    }

    // 普通模式（包括生日）：使用固定路径
    let filePath = imgPath || iconPath
    if (!filePath) throw new Error(`图片不存在: ${name}`)

    let image = sharp(filePath)
    const metadata = await image.metadata()
    const w = metadata.width, h = metadata.height

    // 如果尚未初始化裁剪参数（首次或提示后重置）
    if (!game.cropSide) {
        const shortSide = Math.min(w, h)
        // 立绘和生日贺图使用更小裁剪比例（10%），其他模式 25%
        let ratio = 0.25
        if (mode === 'splash' || mode === 'birthday') {
            ratio = 0.10
        }
        const side = Math.max(50, Math.round(shortSide * ratio))

        // 智能裁剪分支：立绘（splash）和生日贺图（birthday）
        if (mode === 'splash' || mode === 'birthday') {
            const isBirthday = (mode === 'birthday')
            // 生日模式排除四角 Logo 区域（15% 边距）
            const cornerMargin = isBirthday ? 0.15 : 0.0

            // ★ 距离约束：新裁剪位置与已显示位置的最小间距
            const minDistance = Math.max(30, side * 1.2)
            let candidates = []
            let attempts = 0
            const maxAttempts = 200

            // 生成 30 个候选位置（带距离约束）
            while (candidates.length < 30 && attempts < maxAttempts) {
                attempts++
                const maxX = w - side
                const maxY = h - side
                let x = Math.round(Math.random() * Math.max(0, maxX))
                let y = Math.round(Math.random() * Math.max(0, maxY))

                // 生日模式：硬性排除四角区域
                if (isBirthday) {
                    const cx = x + side / 2
                    const cy = y + side / 2
                    const inCorner = (
                        (cx < w * cornerMargin && cy < h * cornerMargin) ||
                        (cx > w * (1 - cornerMargin) && cy < h * cornerMargin) ||
                        (cx < w * cornerMargin && cy > h * (1 - cornerMargin)) ||
                        (cx > w * (1 - cornerMargin) && cy > h * (1 - cornerMargin))
                    )
                    if (inCorner) continue
                }

                // 检查与所有已显示区域的距离
                let tooClose = false
                if (game.shownBounds && game.shownBounds.length > 0) {
                    const cx = x + side / 2
                    const cy = y + side / 2
                    for (const bounds of game.shownBounds) {
                        const bcx = bounds.left + bounds.width / 2
                        const bcy = bounds.top + bounds.height / 2
                        const dist = Math.sqrt((cx - bcx) ** 2 + (cy - bcy) ** 2)
                        if (dist < minDistance) {
                            tooClose = true
                            break
                        }
                    }
                }

                if (!tooClose) {
                    candidates.push({ x, y })
                }
            }

            // 如果候选不足 10 个，补一些无约束随机位置
            while (candidates.length < 10) {
                const maxX = w - side
                const maxY = h - side
                let x = Math.round(Math.random() * Math.max(0, maxX))
                let y = Math.round(Math.random() * Math.max(0, maxY))
                if (isBirthday) {
                    const cx = x + side / 2
                    const cy = y + side / 2
                    const inCorner = (
                        (cx < w * cornerMargin && cy < h * cornerMargin) ||
                        (cx > w * (1 - cornerMargin) && cy < h * cornerMargin) ||
                        (cx < w * cornerMargin && cy > h * (1 - cornerMargin)) ||
                        (cx > w * (1 - cornerMargin) && cy > h * (1 - cornerMargin))
                    )
                    if (inCorner) continue
                }
                candidates.push({ x, y })
            }

            // ---- 提取图像原始像素数据 ----
            const { data, info } = await image.clone().raw().toBuffer({ resolveWithObject: true })
            const channels = info.channels

            let bestScore = -Infinity
            let bestPos = { x: 0, y: 0 }

            const centerX = w / 2
            const centerY = h / 2
            const maxDist = Math.sqrt(centerX * centerX + centerY * centerY)
            const edgeThreshold = side * 1.5

            const scores = []
            let varianceScores = []

            // 遍历所有候选，计算各项评分指标
            for (const cand of candidates) {
                const cx = cand.x, cy = cand.y

                // ---- 计算各项指标（跳过透明像素） ----
                let sumR = 0, sumG = 0, sumB = 0, count = 0
                const luminances = []
                const hueSet = new Set()
                let lumMin = Infinity, lumMax = -Infinity
                let sumS = 0, sumS2 = 0
                let sCount = 0

                for (let dy = 0; dy < side; dy++) {
                    for (let dx = 0; dx < side; dx++) {
                        const px = cx + dx, py = cy + dy
                        if (px >= w || py >= h) continue
                        const idx = (py * w + px) * channels
                        // 跳过透明像素（alpha < 128）
                        const alpha = data[idx + 3]
                        if (alpha < 128) continue

                        const r = data[idx] / 255
                        const g = data[idx + 1] / 255
                        const b = data[idx + 2] / 255
                        const lum = r * 0.299 + g * 0.587 + b * 0.114

                        sumR += data[idx]
                        sumG += data[idx + 1]
                        sumB += data[idx + 2]
                        count++
                        luminances.push(lum)
                        if (lum < lumMin) lumMin = lum
                        if (lum > lumMax) lumMax = lum

                        // 色相多样度：统计色相类别数（12个bin）
                        const max = Math.max(r, g, b)
                        const min = Math.min(r, g, b)
                        if (max !== min) {
                            let hue = 0
                            if (max === r) hue = ((g - b) / (max - min)) % 6
                            else if (max === g) hue = 2 + (b - r) / (max - min)
                            else hue = 4 + (r - g) / (max - min)
                            const hueBin = Math.floor(((hue + 6) % 6) / 0.5)
                            hueSet.add(hueBin)
                        }

                        // 饱和度（HSV 中的 S 通道）
                        const maxRGB = Math.max(r, g, b)
                        const minRGB = Math.min(r, g, b)
                        const s = (maxRGB === 0) ? 0 : (1 - minRGB / maxRGB)
                        sumS += s
                        sumS2 += s * s
                        sCount++
                    }
                }

                // 有效像素太少则淘汰
                if (count < side * side * 0.3) continue

                // ---- 颜色方差 ----
                const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count
                let varR = 0, varG = 0, varB = 0
                for (let dy = 0; dy < side; dy++) {
                    for (let dx = 0; dx < side; dx++) {
                        const px = cx + dx, py = cy + dy
                        if (px >= w || py >= h) continue
                        const idx = (py * w + px) * channels
                        if (data[idx + 3] < 128) continue
                        const dr = data[idx] - avgR
                        const dg = data[idx + 1] - avgG
                        const db = data[idx + 2] - avgB
                        varR += dr * dr
                        varG += dg * dg
                        varB += db * db
                    }
                }
                const varianceScore = varR + varG + varB
                varianceScores.push(varianceScore)

                // ---- 纹理（亮度标准差） ----
                const meanLum = luminances.reduce((a, b) => a + b, 0) / luminances.length
                let varLum = 0
                for (const lum of luminances) {
                    varLum += (lum - meanLum) ** 2
                }
                const textureScore = Math.sqrt(varLum / luminances.length) / 255

                // ---- 中心贴近度 ----
                const regionCenterX = cx + side / 2
                const regionCenterY = cy + side / 2
                const distToCenter = Math.sqrt(
                    Math.pow(regionCenterX - centerX, 2) +
                    Math.pow(regionCenterY - centerY, 2)
                )
                const centerScore = 1 - (distToCenter / maxDist)

                // ---- 色相多样度 ----
                const hueDiversity = Math.min(hueSet.size / 12, 1.0)

                // ---- 亮度对比度 ----
                const contrastScore = Math.min((lumMax - lumMin), 1.0)

                // ---- 饱和度方差 ----
                const meanS = sumS / sCount
                const varS = sumS2 / sCount - meanS * meanS
                const satStd = Math.sqrt(Math.max(varS, 0))

                // ---- 边缘惩罚（仅左/右/上，跳过底部） ----
                const distToLeft = regionCenterX
                const distToRight = w - regionCenterX
                const distToTop = regionCenterY
                const minDistToEdge = Math.min(distToLeft, distToRight, distToTop)
                let edgePenalty = 0
                if (minDistToEdge < edgeThreshold) {
                    edgePenalty = 1 - (minDistToEdge / edgeThreshold)
                }

                scores.push({
                    cand,
                    varianceScore,
                    textureScore,
                    centerScore,
                    hueDiversity,
                    contrastScore,
                    satStd,
                    edgePenalty
                })
            }

            // 归一化方差和饱和度方差，计算最终得分
            if (varianceScores.length === 0) {
                // 无有效候选，回退随机
                const maxX = w - side, maxY = h - side
                game.cropX = Math.round(Math.random() * Math.max(0, maxX))
                game.cropY = Math.round(Math.random() * Math.max(0, maxY))
            } else {
                const maxVariance = Math.max(...varianceScores)
                const minVariance = Math.min(...varianceScores)
                const varianceRange = maxVariance - minVariance || 1

                const satStds = scores.map(s => s.satStd)
                const maxSat = Math.max(...satStds)
                const minSat = Math.min(...satStds)
                const satRange = maxSat - minSat || 1

                for (const item of scores) {
                    const normVariance = (item.varianceScore - minVariance) / varianceRange
                    const normSat = (item.satStd - minSat) / satRange

                    let combinedScore
                    if (mode === 'birthday') {
                        // ★ 生日贺图专用权重：饱和度方差 28% + 亮度对比度 28% + 中心 24% + 色相 10% + 纹理 10% - 边缘惩罚 10%
                        combinedScore =
                            normSat * 0.28 +
                            item.contrastScore * 0.28 +
                            item.centerScore * 0.24 +
                            item.hueDiversity * 0.10 +
                            item.textureScore * 0.10 -
                            item.edgePenalty * 0.10
                    } else {
                        // ★ 立绘模式（splash）权重：纹理 35% + 方差 25% + 中心 20% + 色相 2.5% + 对比度 2.5% - 边缘惩罚 10%
                        combinedScore =
                            item.textureScore * 0.35 +
                            normVariance * 0.25 +
                            item.centerScore * 0.20 +
                            item.hueDiversity * 0.025 +
                            item.contrastScore * 0.025 -
                            item.edgePenalty * 0.10
                    }

                    if (combinedScore > bestScore) {
                        bestScore = combinedScore
                        bestPos = { x: item.cand.x, y: item.cand.y }
                    }
                }
                game.cropX = bestPos.x
                game.cropY = bestPos.y
            }
        } else {
            // 其他模式：纯随机裁剪
            const maxX = w - side, maxY = h - side
            game.cropX = Math.round(Math.random() * Math.max(0, maxX))
            game.cropY = Math.round(Math.random() * Math.max(0, maxY))
        }

        game.cropSide = side
        game.imageWidth = w
        game.imageHeight = h
        game.hints = 0
        // 仅在首次初始化时创建空数组，保留已有记录（提示时重置不会清空）
        if (!game.shownBounds) {
            game.shownBounds = []
        }
    }

    // 记录当前裁剪区域到历史（用于最终合成图）
    const currentBounds = {
        left: game.cropX,
        top: game.cropY,
        width: game.cropSide,
        height: game.cropSide
    }
    const exists = game.shownBounds.some(b =>
        b.left === currentBounds.left && b.top === currentBounds.top &&
        b.width === currentBounds.width && b.height === currentBounds.height
    )
    if (!exists) {
        game.shownBounds.push(currentBounds)
    }

    // 执行裁剪并生成输出
    let pipeline = image.extract({
        left: game.cropX,
        top: game.cropY,
        width: game.cropSide,
        height: game.cropSide
    }).resize(360, 360, { fit: 'fill' })

    // 困难/地狱模式应用滤镜
    if (mode === 'hard') {
        pipeline = pipeline.grayscale()
    } else if (mode === 'hell') {
        pipeline = pipeline.negate()
    }

    return await pipeline.webp({ quality: 90 }).toBuffer()
}

// ---------- 扩大裁剪区域（用于普通模式提示） ----------
// 每次提示将裁剪框扩大 1.5 倍，直到覆盖全图
function enlargeCrop(game) {
    const { imageWidth, imageHeight, cropX, cropY, cropSide } = game
    const minSide = Math.min(imageWidth, imageHeight)
    let newSide = Math.min(minSide, Math.round(cropSide * 1.5))
    if (newSide <= cropSide) newSide = Math.min(minSide, cropSide + 10)
    const cx = cropX + cropSide / 2, cy = cropY + cropSide / 2
    let newX = Math.round(cx - newSide / 2)
    let newY = Math.round(cy - newSide / 2)
    newX = Math.max(0, Math.min(imageWidth - newSide, newX))
    newY = Math.max(0, Math.min(imageHeight - newSide, newY))
    game.cropX = newX
    game.cropY = newY
    game.cropSide = newSide
    game.hints = (game.hints || 0) + 1

    // 记录新区域
    const newBounds = {
        left: newX,
        top: newY,
        width: newSide,
        height: newSide
    }
    const exists = game.shownBounds.some(b =>
        b.left === newBounds.left && b.top === newBounds.top &&
        b.width === newBounds.width && b.height === newBounds.height
    )
    if (!exists) {
        game.shownBounds.push(newBounds)
    }

    return newSide >= minSide  // 是否已全覆盖
}

// ---------- 生成揭晓合成图（裁剪区域清晰，其余阴影+红框） ----------
// 用于答对或看答案时展示所有历史裁剪区域
async function renderReveal(game) {
    let filePath
    if (game.mode === 'birthday') {
        if (!game.iconPath || !fs.existsSync(game.iconPath)) {
            throw new Error('生日贺图原图不存在')
        }
        filePath = game.iconPath
    } else {
        filePath = game.imgPath
        if (!filePath || !fs.existsSync(filePath)) throw new Error('原图不存在')
    }

    const image = sharp(filePath)
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = info.width
    const height = info.height
    const channels = info.channels

    const shownBounds = game.shownBounds || []

    // 遍历像素：裁剪区域保持原色，其余变暗
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels
            let visible = false
            for (const bounds of shownBounds) {
                if (x >= bounds.left && x < bounds.left + bounds.width &&
                    y >= bounds.top && y < bounds.top + bounds.height) {
                    visible = true
                    break
                }
            }
            if (!visible) {
                data[idx] = Math.round(data[idx] * 0.3)
                data[idx + 1] = Math.round(data[idx + 1] * 0.3)
                data[idx + 2] = Math.round(data[idx + 2] * 0.3)
            }
        }
    }

    // 为每个历史裁剪区域绘制红框
    for (const bounds of shownBounds) {
        const x1 = bounds.left
        const y1 = bounds.top
        const x2 = bounds.left + bounds.width - 1
        const y2 = bounds.top + bounds.height - 1
        for (let x = x1; x <= x2; x++) {
            const idx = (y1 * width + x) * channels
            data[idx] = 255; data[idx+1] = 0; data[idx+2] = 0; data[idx+3] = 255
            const idx2 = (y2 * width + x) * channels
            data[idx2] = 255; data[idx2+1] = 0; data[idx2+2] = 0; data[idx2+3] = 255
        }
        for (let y = y1; y <= y2; y++) {
            const idx = (y * width + x1) * channels
            data[idx] = 255; data[idx+1] = 0; data[idx+2] = 0; data[idx+3] = 255
            const idx2 = (y * width + x2) * channels
            data[idx2] = 255; data[idx2+1] = 0; data[idx2+2] = 0; data[idx2+3] = 255
        }
    }

    return sharp(data, { raw: { width, height, channels } })
        .webp({ quality: 90 })
        .toBuffer()
}

// ---------- 插件主类 ----------
export class Guess extends plugin {
    constructor() {
        super({
            name: '猜角色',
            dsc: '猜原神角色 (头像/侧脸/全身/名片/命座/天赋/料理/生日贺图)',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: '^#猜角色帮助$', fnc: 'help' },
                { reg: '^#命座猜角色(简单|普通|困难)?$', fnc: 'startConstellation' },
                { reg: '^#天赋猜角色(简单|普通|困难)?$', fnc: 'startTalent' },
                { reg: '^#料理猜角色(简单|普通|困难)?$', fnc: 'startFood' },
                { reg: '^#猜生日贺图$', fnc: 'startBirthday' },
                { reg: '^#猜(头像(?:侧脸)?|角色(?:困难|地狱|小名片|名片)?|立绘)$', fnc: 'guessCommand' },
                { reg: '^#提示$', fnc: 'hint' },
                { reg: '^#看答案$', fnc: 'reveal' },
                { reg: '^#结束(猜)?(角色|头像)?$', fnc: 'endGame' },
                { reg: '^(?!#).+$', fnc: 'guess', log: false }
            ]
        })
        this.roleNames = []
        this.aliasMap = {}
        this.loaded = false
        this.loadData()
    }

    // ---------- 初始化加载 ----------
    async loadData() {
        try {
            await Promise.all([loadRoleData(), loadBirthdayMessages()])
            const { roleNames, aliasMap } = await loadRoleData()
            this.roleNames = roleNames
            this.aliasMap = aliasMap
            this.loaded = true
        } catch (e) {
            logger?.error('[猜角色] 加载失败', e)
        }
    }

    // ---------- 清理超时游戏 ----------
    cleanTimeout(groupId) {
        const game = games.get(groupId)
        if (game && Date.now() - game.startedAt > GAME_TIMEOUT) {
            games.delete(groupId)
            return true
        }
        return false
    }

    // ---------- 帮助指令 ----------
    async help(e) {
        const helpText = `
猜角色帮助

【启动游戏】
  #猜头像          - 仅显示角色头像局部
  #猜头像侧脸      - 仅显示角色侧脸头像局部
  #猜角色          - 显示抽卡立绘图局部（无滤镜）
  #猜立绘          - 显示全身立绘图局部（无滤镜）
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

【游戏进行】
  #提示            - 扩大显示区域 / 刷新视角（生日模式）
  #看答案          - 揭晓答案
  #结束            - 结束当前游戏

【作答方式】
  直接发送角色名或别名即可作答
        `.trim()
        await e.reply(helpText)
        return true
    }

    // ---------- 入口方法 ----------
    async startConstellation(e) {
        const match = e.msg.match(/^#命座猜角色(简单|普通|困难)?$/)
        const difficulty = match?.[1] || '普通'
        return this.startIconGame(e, 'constellation', difficulty, '命座')
    }

    async startTalent(e) {
        const match = e.msg.match(/^#天赋猜角色(简单|普通|困难)?$/)
        const difficulty = match?.[1] || '普通'
        return this.startIconGame(e, 'talent', difficulty, '天赋')
    }

    async startFood(e) {
        const match = e.msg.match(/^#料理猜角色(简单|普通|困难)?$/)
        const difficulty = match?.[1] || '普通'
        return this.startIconGame(e, 'food', difficulty, '料理')
    }

    // ---------- 生日贺图专用入口 ----------
    async startBirthday(e) {
        if (!this.loaded) {
            await this.loadData()
            if (!this.loaded || this.roleNames.length === 0) {
                await e.reply('角色数据加载失败，请检查')
                return false
            }
        }
        const groupId = e.group_id
        if (!groupId) return false

        this.cleanTimeout(groupId)
        if (games.has(groupId)) {
            await e.reply('当前群已有游戏，请先结束或等待超时')
            return false
        }

        const now = Date.now()
        // 获取所有有生日贺图的角色（含冷却过滤）
        const allAvailable = this.roleNames.filter(name => hasBirthdayImages(name))
        let availableNames = allAvailable.filter(name => {
            const lastUsed = recentlyUsed.get(name) || 0
            return now - lastUsed >= COOLDOWN_MS
        })
        if (availableNames.length === 0) {
            recentlyUsed.clear()
            availableNames = allAvailable
            logger?.info('[猜角色] 生日贺图冷却已清空，所有角色重新可用')
        }

        if (availableNames.length === 0) {
            await e.reply('未找到任何角色的生日贺图，请检查图片目录')
            return false
        }

        const name = randomItem(availableNames)
        recentlyUsed.set(name, now)  // 记录出场时间

        const extra = getExtraData(name)
        if (!extra) {
            await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
            return false
        }

        // 固定一张生日贺图
        const imgInfo = getRandomBirthdayImage(name)
        if (!imgInfo) {
            await e.reply(`角色 ${name} 的生日贺图不存在，请检查图片`)
            return false
        }

        const iconPath = imgInfo.filePath
        const year = imgInfo.year
        const json = readDataJson(name)

        const game = {
            mode: 'birthday',
            name,
            iconPath,          // 固定图片路径
            year,
            json,
            startedAt: Date.now(),
            groupId,
            extra,
            isBirthday: true,
            cropSide: 0,
            shownBounds: [],
            hintCount: 0,      // 已提示次数
            maxHints: 5,       // 最大提示次数
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

    // ---------- 图标猜角色通用启动器（命座/天赋/料理） ----------
    async startIconGame(e, baseMode, difficulty, modeName) {
        if (!this.loaded) {
            await this.loadData()
            if (!this.loaded || this.roleNames.length === 0) {
                await e.reply('角色数据加载失败，请检查')
                return false
            }
        }
        const groupId = e.group_id
        if (!groupId) return false

        this.cleanTimeout(groupId)
        if (games.has(groupId)) {
            await e.reply('当前群已有游戏，请先结束或等待超时')
            return false
        }

        // 根据难度确定模式和初始提示数
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
        let allAvailable = []
        for (const name of this.roleNames) {
            if (baseMode === 'food') {
                const info = REGION_MAP[name]
                if (!info || !info.specialDish) continue
            }
            if (checkImageExists(mode, name)) {
                allAvailable.push(name)
            }
        }

        // 冷却过滤
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
            await e.reply(`未找到任何角色的${modeName}图标，请检查图片目录`)
            return false
        }

        const name = randomItem(availableNames)
        recentlyUsed.set(name, now)

        const extra = getExtraData(name)
        if (!extra) {
            await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
            return false
        }

        if (baseMode === 'food' && !extra.specialDish) {
            await e.reply(`角色 ${name} 缺少特色料理数据，无法开始游戏`)
            return false
        }

        // 固定图片路径
        const iconPath = getFixedIconPath(mode, name)
        if (!iconPath) {
            await e.reply(`未找到 ${name} 的${modeName}图片文件`)
            return false
        }

        // 构建提示池（打乱顺序）
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
            if (initialHintCount > 0 && game.hintIndex >= 0) {
                const msgParts = this.buildHintMessage(game)
                await e.reply([...msgParts, segment.image(buffer)])
            } else {
                await e.reply(segment.image(buffer))
            }
            games.set(groupId, game)
            const diffName = difficulty === '普通' ? '' : difficulty
            logger?.info(`[猜角色] 群${groupId} 开始${modeName}猜角色${diffName}，角色: ${name}，初始提示: ${initialHintCount}条`)
        } catch (err) {
            logger?.error('[猜角色] 生成图片失败', err)
            await e.reply(`生成图片失败：${err.message}`)
            return false
        }
        return true
    }

    // ---------- 构建提示消息 ----------
    buildHintMessage(game) {
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

    // ---------- 提示指令 ----------
    async hint(e) {
        const groupId = e.group_id
        if (!groupId) return false
        if (this.cleanTimeout(groupId)) {
            await e.reply('游戏已超时，请重新开始')
            return false
        }
        const game = games.get(groupId)
        if (!game) {
            await e.reply('当前没有进行中的游戏')
            return false
        }

        // 生日贺图模式：限制提示次数，达到上限则自动揭示答案
        if (game.mode === 'birthday') {
            if (!game.hintCount) game.hintCount = 0
            if (!game.maxHints) game.maxHints = 5

            if (game.hintCount >= game.maxHints) {
                await e.reply('已达到最大提示次数，即将揭晓答案……')
                await this.reveal(e)
                return true
            }

            // 重置裁剪位置（保留历史区域）
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

        // 图标模式（命座/天赋/料理）
        if (game.isIconMode) {
            if (game.hintIndex >= game.hintPool.length - 1) {
                await e.reply('所有提示已给出，请作答或发送 #看答案')
                return true
            }
            game.hintIndex++
            const msgParts = this.buildHintMessage(game)
            try {
                const buffer = await generateCrop(game)
                await e.reply([...msgParts, segment.image(buffer)])
            } catch (err) {
                logger?.error('[猜角色] 提示失败', err)
                await e.reply(`提示失败：${err.message}`)
            }
            return true
        }

        // 普通模式（头像/角色/立绘等）：扩大裁剪区域
        const minSide = Math.min(game.imageWidth, game.imageHeight)
        if (game.cropSide >= minSide) {
            await this.reveal(e)
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

    // ---------- 作答处理 ----------
    async guess(e) {
        if (e.user_id === e.self_id) return false  // 忽略机器人自己的消息

        const groupId = e.group_id
        if (!groupId) return false
        if (this.cleanTimeout(groupId)) {
            await e.reply('游戏已超时，请重新开始')
            return false
        }
        const game = games.get(groupId)
        if (!game) return false

        if (!e.msg || typeof e.msg !== 'string') return false

        const input = e.msg.trim()
        if (input.startsWith('#')) return false  // 避免干扰其他指令

        // 通过别名映射查找角色名
        const knownName = this.aliasMap[input]
        if (!knownName) return false  // 未知名称不处理

        const isCorrect = (input === game.name) || (knownName === game.name)

        if (isCorrect) {
            // 生日贺图模式：显示合成图 + 贺语
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
                if (revealBuffer) {
                    replyParts.push(segment.image(revealBuffer))
                }
                if (formattedMsg) {
                    replyParts.push(`\n\n${formattedMsg}`)
                }
                await e.reply(replyParts)
            } else if (game.isIconMode) {
                await e.reply([segment.at(e.user_id), ` 恭喜答对！答案是 ${game.name}`])
            } else {
                // 普通模式：显示揭晓合成图
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

    // ---------- 普通猜角色指令解析 ----------
    async guessCommand(e) {
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
        return this.startGame(e, mode)
    }

    // ---------- 普通猜角色启动（头像/立绘/抽卡立绘等） ----------
    async startGame(e, mode) {
        if (!this.loaded) {
            await this.loadData()
            if (!this.loaded || this.roleNames.length === 0) {
                await e.reply('角色数据加载失败，请检查')
                return false
            }
        }
        const groupId = e.group_id
        if (!groupId) return false

        this.cleanTimeout(groupId)
        if (games.has(groupId)) {
            await e.reply('当前群已有游戏，请先结束或等待超时')
            return false
        }

        const now = Date.now()
        const allAvailable = this.roleNames.filter(name => checkImageExists(mode, name))
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

        // ★ 在游戏开始时固定图片路径（确保后续提示不换图）
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

    // ---------- 看答案 ----------
    async reveal(e) {
        const groupId = e.group_id
        if (!groupId) return false
        if (this.cleanTimeout(groupId)) {
            await e.reply('游戏已超时')
            return false
        }
        const game = games.get(groupId)
        if (!game) {
            await e.reply('当前没有进行中的游戏')
            return false
        }

        // 生日贺图模式：显示合成图 + 贺语
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
            if (revealBuffer) {
                replyParts.push(segment.image(revealBuffer))
            }
            if (formattedMsg) {
                replyParts.push(`\n\n${formattedMsg}`)
            }
            await e.reply(replyParts)
            games.delete(groupId)
            return true
        }

        // 图标模式
        if (game.isIconMode) {
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

    // ---------- 结束游戏 ----------
    async endGame(e) {
        const groupId = e.group_id
        if (!groupId) return false
        this.cleanTimeout(groupId)
        const game = games.get(groupId)
        if (!game) {
            await e.reply('当前没有进行中的游戏')
            return false
        }
        games.delete(groupId)
        await e.reply('游戏已结束')
        return true
    }
}