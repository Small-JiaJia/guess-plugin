// ============================================================
// 插件名称：猜角色 (Guess)
// 功能：通过角色图片局部、命座图标、天赋图标、特色料理等让群友猜角色
// 路径：./plugins/guess-plugin/app/guess.js
// 依赖：roleId.js、roleinformation.js、角色目录下的 data.json
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'url'
import REGION_MAP from '../data/roleinformation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- 路径常量 ----------
const ROLE_DATA_PATH = path.join(__dirname, '../data/roleId.js')
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')

// ---------- 游戏状态 ----------
const games = new Map()
const GAME_TIMEOUT = 5 * 60 * 1000

// ---------- 角色别名缓存 ----------
let roleNames = null
let aliasMap = null
let roleLoading = false

// ---------- 加载角色别名数据 ----------
async function loadRoleData() {
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

// ---------- 工具函数 ----------
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
}

// ---------- 从 data.json 读取角色信息 ----------
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

function getExtraData(name) {
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

// ---------- 图片处理函数 ----------
function getFileNameByMode(mode) {
    switch (mode) {
        case 'avatar': return 'face.webp'
        case 'avatar_side': return 'side.webp'
        case 'splash': return 'splash.webp'
        case 'banner': return 'banner.webp'
        case 'card': return 'card.webp'
        case 'gacha':
        case 'hard':
        case 'hell':
            return 'gacha.webp'
        default:
            return 'gacha.webp'
    }
}

function checkImageExists(mode, name) {
    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(filePath)
    }
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', 'cons-1.webp')
        return fs.existsSync(filePath)
    }
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return false
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        return files.length > 0
    }
    const fileName = getFileNameByMode(mode)
    const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', fileName)
    return fs.existsSync(filePath)
}

function getImagePath(mode, name, fixedPath = null) {
    if (fixedPath) return fixedPath

    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(filePath) ? filePath : null
    }
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        const num = Math.floor(Math.random() * 6) + 1
        const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', `cons-${num}.webp`)
        return fs.existsSync(filePath) ? filePath : null
    }
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return null
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        if (files.length === 0) return null
        const randomFile = randomItem(files)
        return path.join(dir, randomFile)
    }

    const fileName = getFileNameByMode(mode)
    const filePath = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', fileName)
    return fs.existsSync(filePath) ? filePath : null
}

function getFixedIconPath(mode, name) {
    if (mode === 'food' || mode === 'food_simple' || mode === 'food_hard') {
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs', 'food.webp')
        return fs.existsSync(p) ? p : null
    }
    if (mode === 'constellation' || mode === 'constellation_simple' || mode === 'constellation_hard') {
        const num = Math.floor(Math.random() * 6) + 1
        const p = path.join(GENSHIN_CHARACTER_DIR, name, 'icons', `cons-${num}.webp`)
        return fs.existsSync(p) ? p : null
    }
    if (mode === 'talent' || mode === 'talent_simple' || mode === 'talent_hard') {
        const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'icons')
        if (!fs.existsSync(dir)) return null
        const files = fs.readdirSync(dir).filter(f => /^passive-\d+\.webp$/.test(f))
        if (files.length === 0) return null
        return path.join(dir, randomItem(files))
    }
    return null
}

// ---------- 图像生成核心 ----------
async function generateCrop(game) {
    const { mode, name, iconPath } = game

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

    // 普通模式：裁剪
    const filePath = getImagePath(mode, name)
    if (!filePath) throw new Error(`图片不存在: ${name}`)

    let image = sharp(filePath)
    const metadata = await image.metadata()
    const w = metadata.width, h = metadata.height

    if (!game.cropSide) {
        const shortSide = Math.min(w, h)
        let ratio = 0.25
        if (mode === 'splash') {
            ratio = 0.10   // 立绘模式裁剪比例
        }
        const side = Math.max(50, Math.round(shortSide * ratio))

        // ★ splash 模式：纹理 35% + 方差 25% + 中心 20% + 色相 2.5% + 对比度 2.5% - 边缘惩罚 10%
        if (mode === 'splash') {
            const candidates = []
            for (let i = 0; i < 30; i++) {
                const maxX = w - side
                const maxY = h - side
                const x = Math.round(Math.random() * Math.max(0, maxX))
                const y = Math.round(Math.random() * Math.max(0, maxY))
                candidates.push({ x, y })
            }

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

            for (const cand of candidates) {
                const cx = cand.x, cy = cand.y

                // ---- 计算各项指标（跳过透明像素） ----
                let sumR = 0, sumG = 0, sumB = 0, count = 0
                const luminances = []
                const hueSet = new Set()
                let lumMin = Infinity, lumMax = -Infinity

                for (let dy = 0; dy < side; dy++) {
                    for (let dx = 0; dx < side; dx++) {
                        const px = cx + dx, py = cy + dy
                        if (px >= w || py >= h) continue
                        const idx = (py * w + px) * channels

                        // 跳过透明/半透明像素
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

                        // 色相分组（12个bin）
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
                    edgePenalty
                })
            }

            // 归一化方差并计算最终得分
            if (varianceScores.length === 0) {
                // 无有效候选，回退随机
                const maxX = w - side, maxY = h - side
                game.cropX = Math.round(Math.random() * Math.max(0, maxX))
                game.cropY = Math.round(Math.random() * Math.max(0, maxY))
            } else {
                const maxVariance = Math.max(...varianceScores)
                const minVariance = Math.min(...varianceScores)
                const varianceRange = maxVariance - minVariance || 1

                for (const item of scores) {
                    const normVariance = (item.varianceScore - minVariance) / varianceRange
                    // ★ 权重：纹理 35% + 方差 25% + 中心 20% + 色相 2.5% + 对比度 2.5% - 边缘惩罚 10%
                    const combinedScore =
                        item.textureScore * 0.35 +
                        normVariance * 0.25 +
                        item.centerScore * 0.20 +
                        item.hueDiversity * 0.025 +
                        item.contrastScore * 0.025 -
                        item.edgePenalty * 0.10
                    if (combinedScore > bestScore) {
                        bestScore = combinedScore
                        bestPos = { x: item.cand.x, y: item.cand.y }
                    }
                }
                game.cropX = bestPos.x
                game.cropY = bestPos.y
            }
        } else {
            // 其他模式：纯随机
            const maxX = w - side, maxY = h - side
            game.cropX = Math.round(Math.random() * Math.max(0, maxX))
            game.cropY = Math.round(Math.random() * Math.max(0, maxY))
        }

        game.cropSide = side
        game.imageWidth = w
        game.imageHeight = h
        game.hints = 0
        game.shownBounds = []
    }

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

    let pipeline = image.extract({
        left: game.cropX,
        top: game.cropY,
        width: game.cropSide,
        height: game.cropSide
    }).resize(360, 360, { fit: 'fill' })

    if (mode === 'hard') {
        pipeline = pipeline.grayscale()
    } else if (mode === 'hell') {
        pipeline = pipeline.negate()
    }

    return await pipeline.webp({ quality: 90 }).toBuffer()
}

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

    return newSide >= minSide
}

async function renderReveal(game) {
    const filePath = getImagePath(game.mode, game.name)
    if (!filePath) throw new Error('原图不存在')

    const image = sharp(filePath)
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = info.width
    const height = info.height
    const channels = info.channels

    const shownBounds = game.shownBounds || []

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
            dsc: '猜原神角色 (头像/侧脸/全身/名片/命座/天赋/料理)',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: '^#猜角色帮助$', fnc: 'help' },
                { reg: '^#命座猜角色(简单|普通|困难)?$', fnc: 'startConstellation' },
                { reg: '^#天赋猜角色(简单|普通|困难)?$', fnc: 'startTalent' },
                { reg: '^#料理猜角色(简单|普通|困难)?$', fnc: 'startFood' },
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

    async loadData() {
        try {
            const { roleNames, aliasMap } = await loadRoleData()
            this.roleNames = roleNames
            this.aliasMap = aliasMap
            this.loaded = true
        } catch (e) {
            logger?.error('[猜角色] 加载失败', e)
        }
    }

    cleanTimeout(groupId) {
        const game = games.get(groupId)
        if (game && Date.now() - game.startedAt > GAME_TIMEOUT) {
            games.delete(groupId)
            return true
        }
        return false
    }

    async help(e) {
        const helpText = `
猜角色帮助

【启动游戏】
  #猜头像          - 仅显示角色头像局部
  #猜头像侧脸      - 仅显示角色侧脸头像局部
  #猜角色          - 显示抽卡立绘图局部（无滤镜）
  #猜立绘          - 显示全身立绘图局部（无滤镜，智能裁剪）
  #猜角色困难      - 黑白效果 + 抽卡立绘局部
  #猜角色地狱      - 反色效果 + 抽卡立绘局部
  #猜角色小名片    - 显示小名片局部
  #猜角色名片      - 显示名片局部

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
  #提示            - 扩大显示区域 / 揭示更多角色信息
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

    // ---------- 图标猜角色通用启动器 ----------
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

        let availableNames = []
        for (const name of this.roleNames) {
            if (baseMode === 'food') {
                const info = REGION_MAP[name]
                if (!info || !info.specialDish) continue
            }
            if (checkImageExists(mode, name)) {
                availableNames.push(name)
            }
        }
        if (availableNames.length === 0) {
            await e.reply(`未找到任何角色的${modeName}图标，请检查图片目录`)
            return false
        }

        const name = randomItem(availableNames)
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

        // 普通模式：扩大裁剪区域
        const minSide = Math.min(game.imageWidth, game.imageHeight)
        if (game.cropSide >= minSide) {
            await this.reveal(e)
            return true
        }

        const full = enlargeCrop(game)
        try {
            const buffer = await generateCrop(game)
            await e.reply(segment.image(buffer))
            if (full) await e.reply('图片已完全显示，再提示将揭示答案')
        } catch (err) {
            logger?.error('[猜角色] 提示生成失败', err)
            await e.reply(`提示失败：${err.message}`)
        }
        return true
    }

    // ---------- 作答处理 ----------
    async guess(e) {
        if (e.user_id === e.self_id) return false

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
        if (input.startsWith('#')) return false

        const knownName = this.aliasMap[input]
        if (!knownName) return false

        const isCorrect = (input === game.name) || (knownName === game.name)

        if (isCorrect) {
            if (game.isIconMode) {
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

    // ---------- 普通猜角色启动 ----------
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

        let name = null
        let attempts = 0
        while (attempts < 30) {
            const candidate = randomItem(this.roleNames)
            if (checkImageExists(mode, candidate)) {
                name = candidate
                break
            }
            attempts++
        }
        if (!name) {
            await e.reply(`未找到可用的角色图片 (模式: ${mode})`)
            return false
        }

        const game = { mode, name, startedAt: Date.now(), groupId }
        try {
            const buffer = await generateCrop(game)
            await e.reply(segment.image(buffer))
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