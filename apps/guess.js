// ============================================================
// 插件名称：猜角色 (Guess)
// 功能：通过角色图片局部、命座图标、天赋图标、特色料理、生日贺图、碎碎冰猜立绘/角色等让群友猜角色
// 路径：./plugins/guess-plugin/app/guess.js
// 依赖：roleId.js、roleinformation.js、角色目录下的 data.json、birthdayMessages.json、d3-delaunay
// ============================================================

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pathToFileURL } from 'url'
import { Delaunay } from 'd3-delaunay'
import REGION_MAP from '../data/roleinformation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- 路径常量 ----------
const ROLE_DATA_PATH = path.join(__dirname, '../data/roleId.js')
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../resources/genshin/character')
const BIRTHDAY_MSG_PATH = path.join(__dirname, '../data/birthdayMessages.json')

// ---------- 游戏状态 ----------
const games = new Map()                       // 每个群的进行中游戏
const GAME_TIMEOUT = 5 * 60 * 1000            // 游戏超时 5 分钟

// ---------- 冷却机制 ----------
const COOLDOWN_MS = 24 * 60 * 60 * 1000       // 角色冷却 24 小时
const recentlyUsed = new Map()                // 角色名 → 上次出现时间戳

// ---------- 角色别名缓存 ----------
let roleNames = null
let aliasMap = null
let roleLoading = false

// ---------- 生日贺语缓存 ----------
let birthdayMessages = null
let msgLoading = false

// ---------- 碎碎冰游戏状态 ----------
const puzzleGames = new Map()                 // groupId → puzzleState

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

// ---------- 加载生日贺语数据 ----------
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

// ---------- 获取生日贺语 ----------
function getBirthdayMessage(name, year) {
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
function getBirthDateString(json) {
    if (!json || !json.birth) return null
    const parts = json.birth.split('-')
    if (parts.length !== 2) return null
    return `${parts[0]}月${parts[1]}日`
}

// ---------- 格式化贺语 ----------
function formatBirthdayMessage(msg) {
    if (!msg) return null
    return msg.replace(/<br>/g, '\n').trim()
}

// ---------- 生成信封格式答案 ----------
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

// ---------- ★ 碎片有效评分函数 ----------
// 计算碎片的有效分数（基于像素亮度和方差，避免纯黑/纯白/透明碎片）
async function calculateFragmentScore(fragmentBuffer) {
    try {
        const { data, info } = await sharp(fragmentBuffer)
            .raw()
            .toBuffer({ resolveWithObject: true })
        const channels = info.channels
        let sumR = 0, sumG = 0, sumB = 0, count = 0
        for (let i = 0; i < data.length; i += channels) {
            const a = data[i + 3]
            if (a < 30) continue  // 跳过透明像素
            sumR += data[i]
            sumG += data[i + 1]
            sumB += data[i + 2]
            count++
        }
        if (count === 0) return 0
        // 亮度均值
        const avgLum = (sumR + sumG + sumB) / (count * 3)
        // 计算方差
        let varR = 0, varG = 0, varB = 0
        const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count
        for (let i = 0; i < data.length; i += channels) {
            const a = data[i + 3]
            if (a < 30) continue
            const dr = data[i] - avgR
            const dg = data[i + 1] - avgG
            const db = data[i + 2] - avgB
            varR += dr * dr
            varG += dg * dg
            varB += db * db
        }
        const variance = (varR + varG + varB) / count / (255 * 255)
        // 综合评分：亮度均值 × 0.6 + 方差 × 0.4
        const score = (avgLum / 255) * 0.6 + Math.min(variance * 10, 1) * 0.4
        return score
    } catch {
        return 0
    }
}

// ---------- ★ Voronoi 碎片生成核心 ----------
// 使用 d3-delaunay 生成 Voronoi 分割，提取每个碎片（含有效像素过滤）
async function generateVoronoiFragments(imagePath, fragmentCount = 100, minScore = 0.15) {
    const image = sharp(imagePath)
    const metadata = await image.metadata()
    const { width, height } = metadata

    // ---- 生成随机点（边界点确保覆盖完整画面） ----
    const points = []
    const margin = 0.05
    const boundaryPoints = [
        [width * margin, height * margin],
        [width * (1 - margin), height * margin],
        [width * margin, height * (1 - margin)],
        [width * (1 - margin), height * (1 - margin)],
        [width / 2, height * margin],
        [width / 2, height * (1 - margin)],
        [width * margin, height / 2],
        [width * (1 - margin), height / 2],
    ]
    for (let i = 0; i < fragmentCount - boundaryPoints.length; i++) {
        points.push([
            Math.random() * width * 0.9 + width * 0.05,
            Math.random() * height * 0.9 + height * 0.05,
        ])
    }
    const allPoints = [...boundaryPoints, ...points]

    // ---- 计算 Delaunay 三角网和 Voronoi 图 ----
    const delaunay = Delaunay.from(allPoints)
    const voronoi = delaunay.voronoi([0, 0, width, height])

    // 提取每个单元格的多边形
    const polygons = []
    for (let i = 0; i < allPoints.length; i++) {
        const cell = voronoi.cellPolygon(i)
        if (cell && cell.length >= 3) {
            const bounds = getPolygonBounds(cell)
            // ★ 修复：检查边界框是否有效
            if (bounds.w > 0 && bounds.h > 0) {
                polygons.push({
                    id: i,
                    points: cell.flat(),
                    bounds: bounds,
                })
            }
        }
    }

    // ---- 提取每个碎片的图片（使用 Alpha 蒙版） ----
    const fragments = []
    const originalImage = sharp(imagePath)

    for (const poly of polygons) {
        const { x, y, w, h } = poly.bounds
        // ★ 确保宽度和高度为正整数
        const extractW = Math.max(1, Math.ceil(w))
        const extractH = Math.max(1, Math.ceil(h))

        try {
            const extractBuffer = await originalImage.clone()
                .extract({ left: Math.floor(x), top: Math.floor(y), width: extractW, height: extractH })
                .png()
                .toBuffer()

            const maskBuffer = await generatePolygonMask(
                poly.points,
                extractW,
                extractH,
                { offsetX: Math.floor(x), offsetY: Math.floor(y) }
            )

            const fragmentBuffer = await sharp(extractBuffer)
                .composite([{ input: maskBuffer, blend: 'dest-in' }])
                .png()
                .toBuffer()

            const score = await calculateFragmentScore(fragmentBuffer)

            const margin2 = 30
            const maxRX = width - extractW - margin2
            const maxRY = height - extractH - margin2

            fragments.push({
                id: poly.id,
                rect: { x: Math.floor(x), y: Math.floor(y), w: extractW, h: extractH },
                polygon: poly.points,
                buffer: fragmentBuffer,
                score: score,
                isRevealed: false,   // 是否已揭示
                isPlaced: false,     // 是否已归位
                randomX: Math.random() * Math.max(0, maxRX) + margin2 / 2,
                randomY: Math.random() * Math.max(0, maxRY) + margin2 / 2,
            })
        } catch (err) {
            // 提取失败则跳过该碎片
            logger?.debug(`[Voronoi] 跳过碎片 ${poly.id}: ${err.message}`)
            continue
        }
    }

    // ★ 有效像素过滤
    const filtered = fragments.filter(f => f.score >= minScore)
    if (filtered.length < Math.min(fragmentCount * 0.5, fragmentCount - 10)) {
        // 有效碎片严重不足（<50% 或少于 fragmentCount-10），降低阈值重试
        const retry = await generateVoronoiFragments(imagePath, fragmentCount, minScore * 0.4)
        return retry
    }

    // 按分数排序，取前 fragmentCount 个
    filtered.sort((a, b) => b.score - a.score)
    const result = filtered.slice(0, fragmentCount)

    // ★ 如果结果不足，补一些随机矩形碎片
    const originalImageForFill = sharp(imagePath)
    while (result.length < fragmentCount) {
        const w = Math.random() * 150 + 40
        const h = Math.random() * 150 + 40
        const x = Math.random() * (width - w)
        const y = Math.random() * (height - h)
        try {
            const extractBuffer = await originalImageForFill.clone()
                .extract({ left: Math.floor(x), top: Math.floor(y), width: Math.ceil(w), height: Math.ceil(h) })
                .png()
                .toBuffer()
            const score = await calculateFragmentScore(extractBuffer)
            result.push({
                id: result.length,
                rect: { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(w), h: Math.ceil(h) },
                buffer: extractBuffer,
                score: score || 0.3,
                isRevealed: false,
                isPlaced: false,
                randomX: Math.random() * Math.max(0, width - Math.ceil(w) - 30) + 15,
                randomY: Math.random() * Math.max(0, height - Math.ceil(h) - 30) + 15,
            })
        } catch (err) {
            continue
        }
    }

    return result
}

// ---------- 计算多边形边界框 ----------
function getPolygonBounds(polygon) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of polygon) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ---------- 生成多边形蒙版 ----------
// 使用 SVG 路径生成白色多边形，背景透明
async function generatePolygonMask(points, width, height, offset = { offsetX: 0, offsetY: 0 }) {
    let pathD = 'M'
    for (let i = 0; i < points.length; i += 2) {
        const x = points[i] - offset.offsetX
        const y = points[i + 1] - offset.offsetY
        if (i === 0) {
            pathD += `${x},${y}`
        } else {
            pathD += ` L${x},${y}`
        }
    }
    pathD += ' Z'

    const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <path d="${pathD}" fill="white" />
        </svg>
    `

    return await sharp(Buffer.from(svg)).png().toBuffer()
}

// ---------- ★ 渲染碎碎冰当前状态 ----------
// 已揭示且已归位 → 正确位置；已揭示但未归位 → 随机位置；未揭示 → 不显示
async function renderPuzzleState(fragments, originalWidth, originalHeight) {
    const revealed = fragments.filter(f => f.isRevealed)

    if (revealed.length === 0) {
        return await sharp({
            create: {
                width: originalWidth,
                height: originalHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).webp({ quality: 85 }).toBuffer()
    }

    const layers = []
    for (const frag of revealed) {
        const posX = frag.isPlaced ? frag.rect.x : frag.randomX
        const posY = frag.isPlaced ? frag.rect.y : frag.randomY
        layers.push({
            input: frag.buffer,
            left: Math.round(posX),
            top: Math.round(posY),
        })
    }

    return await sharp({
        create: {
            width: originalWidth,
            height: originalHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 }
        }
    })
        .composite(layers)
        .webp({ quality: 85 })
        .toBuffer()
}

// ---------- ★ 碎碎冰揭晓合成图（保留不规则形状） ----------
// 已揭示碎片保持原色，其余部分阴影
async function renderPuzzleReveal(puzzleState) {
    const { imgPath, fragments, originalWidth, originalHeight } = puzzleState
    const revealed = fragments.filter(f => f.isRevealed)

    if (revealed.length === 0) {
        return await sharp({
            create: {
                width: originalWidth,
                height: originalHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).webp({ quality: 85 }).toBuffer()
    }

    // 读取原图并暗化
    const image = sharp(imgPath)
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = info.width, height = info.height, channels = info.channels

    for (let i = 0; i < data.length; i += channels) {
        data[i] = Math.round(data[i] * 0.3)
        data[i + 1] = Math.round(data[i + 1] * 0.3)
        data[i + 2] = Math.round(data[i + 2] * 0.3)
    }

    const darkenedBuffer = await sharp(data, { raw: { width, height, channels } })
        .webp({ quality: 85 })
        .toBuffer()

    // 叠加已揭示碎片（正确位置）
    const layers = revealed.map(frag => ({
        input: frag.buffer,
        left: frag.rect.x,
        top: frag.rect.y,
        blend: 'over'
    }))

    if (layers.length === 0) return darkenedBuffer

    return await sharp(darkenedBuffer)
        .composite(layers)
        .webp({ quality: 85 })
        .toBuffer()
}

// ---------- ★ 图片路径获取（支持默认和特殊立绘随机） ----------
function getImagePath(mode, name, fixedPath = null) {
    if (fixedPath) {
        if (fs.existsSync(fixedPath)) return fixedPath
        return null
    }

    if (mode === 'birthday') {
        const img = getRandomBirthdayImage(name)
        return img ? img.filePath : null
    }

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

    const fileNameMap = {
        'avatar': 'face',
        'avatar_side': 'side',
        'splash': 'splash',
        'banner': 'banner',
        'card': 'card',
        'gacha': 'gacha',
        'hard': 'gacha',
        'hell': 'gacha',
        'puzzle': 'splash',
    }

    const baseName = fileNameMap[mode]
    if (!baseName) return null

    const imgsDir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(imgsDir)) return null

    const available = []
    const specialModes = ['avatar', 'avatar_side', 'splash', 'puzzle']
    const candidates = [`${baseName}.webp`]
    if (specialModes.includes(mode)) {
        candidates.push(`${baseName}2.webp`)
    }

    for (const candidate of candidates) {
        const p = path.join(imgsDir, candidate)
        if (fs.existsSync(p)) available.push(p)
    }

    if (available.length === 0) return null
    return randomItem(available)
}

// ---------- 检查图片是否存在 ----------
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
    const fileNameMap = {
        'avatar': 'face',
        'avatar_side': 'side',
        'splash': 'splash',
        'banner': 'banner',
        'card': 'card',
        'gacha': 'gacha',
        'hard': 'gacha',
        'hell': 'gacha',
        'puzzle': 'splash',
    }
    const baseName = fileNameMap[mode]
    if (!baseName) return false

    const imgsDir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(imgsDir)) return false

    const candidates = [`${baseName}.webp`]
    if (['avatar', 'avatar_side', 'splash', 'puzzle'].includes(mode)) {
        candidates.push(`${baseName}2.webp`)
    }

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(imgsDir, candidate))) return true
    }
    return false
}

// ---------- 获取固定图标路径 ----------
function getFixedIconPath(mode, name) {
    if (mode === 'birthday') {
        const img = getRandomBirthdayImage(name)
        return img ? img.filePath : null
    }
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
    return getImagePath(mode, name)
}

// ---------- 生日贺图辅助函数 ----------
function hasBirthdayImages(name) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    if (!fs.existsSync(dir)) return false
    const files = fs.readdirSync(dir)
    return files.some(f => /^Birthday-\d+\.(webp|png|jpg|jpeg)$/i.test(f))
}

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

function getBirthdayImagePath(name, year) {
    const dir = path.join(GENSHIN_CHARACTER_DIR, name, 'imgs')
    const exts = ['.webp', '.png', '.jpg', '.jpeg']
    for (const ext of exts) {
        const p = path.join(dir, `Birthday-${year}${ext}`)
        if (fs.existsSync(p)) return p
    }
    return null
}
// ---------- ★ 清理碎碎冰游戏状态 ----------
function cleanPuzzleGame(groupId) {
    if (puzzleGames.has(groupId)) {
        const pState = puzzleGames.get(groupId)
        // ★ 手动解除碎片 buffer 引用，帮助 GC 回收
        if (pState && pState.fragments) {
            pState.fragments = null
        }
        puzzleGames.delete(groupId)
    }
    if (games.has(groupId)) {
        games.delete(groupId)
    }
    // ★ 主动触发 GC（需要 Node 启动时加 --expose-gc）
    if (global.gc) {
        global.gc()
    }
}

// ---------- 图像生成核心 ----------
async function generateCrop(game) {
    const { mode, name, iconPath, imgPath } = game

    // ★ 碎碎冰模式：返回当前拼图状态
    if (mode === 'puzzle') {
        const puzzleState = puzzleGames.get(game.groupId)
        if (!puzzleState) {
            throw new Error('拼图状态不存在，请重新开始游戏')
        }
        return await renderPuzzleState(
            puzzleState.fragments,
            puzzleState.originalWidth,
            puzzleState.originalHeight
        )
    }

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

    // 普通模式（头像/立绘/角色/生日贺图）：裁剪局部
    let filePath = imgPath || iconPath
    if (!filePath) throw new Error(`图片不存在: ${name}`)

    let image = sharp(filePath)
    const metadata = await image.metadata()
    const w = metadata.width, h = metadata.height

    // 初始化裁剪参数
    if (!game.cropSide) {
        const shortSide = Math.min(w, h)
        let ratio = 0.25
        if (mode === 'splash' || mode === 'birthday') {
            ratio = 0.10   // 立绘和生日贺图使用更小裁剪
        }
        const side = Math.max(50, Math.round(shortSide * ratio))

        // 智能裁剪：立绘和生日贺图使用内容感知算法
        if (mode === 'splash' || mode === 'birthday') {
            const isBirthday = (mode === 'birthday')
            const cornerMargin = isBirthday ? 0.15 : 0.0

            // ---- 候选生成（带距离约束和四角排除） ----
            const minDistance = Math.max(30, side * 1.2)
            let candidates = []
            let attempts = 0
            const maxAttempts = 200

            while (candidates.length < 30 && attempts < maxAttempts) {
                attempts++
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

            // 候选不足时补随机
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
                        const alpha = data[idx + 3]
                        if (alpha < 128) continue  // 跳过透明像素

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

                        // 饱和度（HSV 中的 S 通道）
                        const maxRGB = Math.max(r, g, b)
                        const minRGB = Math.min(r, g, b)
                        const s = (maxRGB === 0) ? 0 : (1 - minRGB / maxRGB)
                        sumS += s
                        sumS2 += s * s
                        sCount++
                    }
                }

                if (count < side * side * 0.3) continue

                // 颜色方差
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

                // 纹理（亮度标准差）
                const meanLum = luminances.reduce((a, b) => a + b, 0) / luminances.length
                let varLum = 0
                for (const lum of luminances) {
                    varLum += (lum - meanLum) ** 2
                }
                const textureScore = Math.sqrt(varLum / luminances.length) / 255

                // 中心贴近度
                const regionCenterX = cx + side / 2
                const regionCenterY = cy + side / 2
                const distToCenter = Math.sqrt(
                    Math.pow(regionCenterX - centerX, 2) +
                    Math.pow(regionCenterY - centerY, 2)
                )
                const centerScore = 1 - (distToCenter / maxDist)

                // 色相多样度
                const hueDiversity = Math.min(hueSet.size / 12, 1.0)
                // 亮度对比度
                const contrastScore = Math.min((lumMax - lumMin), 1.0)
                // 饱和度方差
                const meanS = sumS / sCount
                const varS = sumS2 / sCount - meanS * meanS
                const satStd = Math.sqrt(Math.max(varS, 0))

                // 边缘惩罚（仅左/右/上，跳过底部）
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

            // 归一化并计算最终得分
            if (varianceScores.length === 0) {
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
                        // 生日贺图专用权重
                        combinedScore =
                            normSat * 0.28 +
                            item.contrastScore * 0.28 +
                            item.centerScore * 0.24 +
                            item.hueDiversity * 0.10 +
                            item.textureScore * 0.10 -
                            item.edgePenalty * 0.10
                    } else {
                        // 立绘模式（splash）
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
            // 其他模式：纯随机
            const maxX = w - side, maxY = h - side
            game.cropX = Math.round(Math.random() * Math.max(0, maxX))
            game.cropY = Math.round(Math.random() * Math.max(0, maxY))
        }

        game.cropSide = side
        game.imageWidth = w
        game.imageHeight = h
        game.hints = 0
        if (!game.shownBounds) {
            game.shownBounds = []
        }
    }

    // 记录当前裁剪区域到历史
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

// ---------- 扩大裁剪区域（用于普通模式提示） ----------
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

// ---------- 普通揭晓合成图（矩形区域） ----------
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
            dsc: '猜原神角色 (头像/侧脸/全身/名片/命座/天赋/料理/生日贺图/碎碎冰猜立绘/角色)',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: '^#猜角色帮助$', fnc: 'help' },
                { reg: '^#命座猜角色(简单|普通|困难)?$', fnc: 'startConstellation' },
                { reg: '^#天赋猜角色(简单|普通|困难)?$', fnc: 'startTalent' },
                { reg: '^#料理猜角色(简单|普通|困难)?$', fnc: 'startFood' },
                { reg: '^#猜生日贺图$', fnc: 'startBirthday' },
                { reg: '^#碎碎冰猜(立绘|角色)\\s*(\\d+)?$', fnc: 'startPuzzle' },
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

    // ---------- 帮助指令 ----------
    async help(e) {
        const helpText = `
猜角色帮助

【启动游戏】
  #猜头像          - 仅显示角色头像局部
  #猜头像侧脸      - 仅显示角色侧脸头像局部
  #猜角色          - 显示抽卡立绘图局部（无滤镜）
  #猜立绘          - 显示全身立绘图局部（无滤镜）
  #碎碎冰猜立绘    - 立绘被打碎成不规则碎片（默认100块）
  #碎碎冰猜角色    - 抽卡立绘被打碎成不规则碎片（默认100块）
  #碎碎冰猜立绘 120 - 指定碎片数量（20~200块）
  #碎碎冰猜角色 120 - 指定碎片数量（20~200块）
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

【碎碎冰玩法说明】
  - 立绘/抽卡立绘被打碎成不规则碎片，全部打乱位置
  - 初始只揭示 2 块碎片（随机位置）
  - 发送角色名作答（或使用别名）
  - 猜错一次 → 累计猜错次数 +1，同时揭示 1 块新碎片（优先有效碎片）
  - 猜错累计达到斐波那契式阈值时，已揭示的碎片自动归位
  - #提示 → 揭示 1 块新碎片（不消耗猜错次数，不触发归位）
  - 答对或看答案时显示不规则碎片合成图

【游戏进行】
  #提示            - 扩大显示区域 / 刷新视角（生日模式）/ 碎碎冰模式揭示碎片
  #看答案          - 揭晓答案
  #结束            - 结束当前游戏

【作答方式】
  直接发送角色名或别名即可作答
        `.trim()
        await e.reply(helpText)
        return true
    }

    // ---------- ★ 碎碎冰猜角色/立绘入口 ----------
    async startPuzzle(e) {
        if (!this.loaded) {
            await this.loadData()
            if (!this.loaded || this.roleNames.length === 0) {
                await e.reply('角色数据加载失败，请检查')
                return false
            }
        }

        const groupId = e.group_id
        if (!groupId) return false

        if (puzzleGames.has(groupId)) {
            await e.reply('当前群已有碎碎冰游戏，请先结束或等待超时')
            return false
        }

        // ★ 解析指令
        const cmdMatch = e.msg.match(/^#碎碎冰猜(立绘|角色)\s*(\d+)?$/)
        if (!cmdMatch) return false

        const imageType = cmdMatch[1] // '立绘' 或 '角色'
        const imageMode = imageType === '立绘' ? 'splash' : 'gacha'
        const modeName = imageType === '立绘' ? '立绘' : '角色'

        let fragmentCount = 100
        if (cmdMatch[2]) {
            const num = parseInt(cmdMatch[2])
            if (num >= 20 && num <= 200) {
                fragmentCount = num
            } else {
                await e.reply('碎片数量请设置在 20~200 之间，已使用默认值 100')
            }
        }

        // ★ 自适应斐波那契阈值（占比 5%、10%、15%、25%、40%）
        const ratios = [0.05, 0.10, 0.15, 0.25, 0.40]
        const mergeThresholds = ratios.map(r => Math.max(3, Math.round(fragmentCount * r)))
        const thresholdDesc = mergeThresholds.join('、')

        // 冷却过滤
        const now = Date.now()
        const allAvailable = this.roleNames.filter(name => checkImageExists(imageMode, name))
        let availableNames = allAvailable.filter(name => {
            const lastUsed = recentlyUsed.get(name) || 0
            return now - lastUsed >= COOLDOWN_MS
        })
        if (availableNames.length === 0) {
            recentlyUsed.clear()
            availableNames = allAvailable
            logger?.info(`[猜角色] 碎碎冰${modeName}冷却已清空，所有角色重新可用`)
        }

        if (availableNames.length === 0) {
            await e.reply(`未找到可用的${modeName}图片`)
            return false
        }

        const name = randomItem(availableNames)
        recentlyUsed.set(name, now)

        const extra = getExtraData(name)
        if (!extra) {
            await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
            return false
        }

        // ★ 使用 imageMode 获取图片
        const imgPath = getImagePath(imageMode, name)
        if (!imgPath) {
            await e.reply(`未找到 ${name} 的${modeName}图片，请检查`)
            return false
        }

        let fragments
        let originalWidth, originalHeight
        try {
            await e.reply(`⏳ 正在生成碎碎冰${modeName}碎片，请稍候…`)
            const meta = await sharp(imgPath).metadata()
            originalWidth = meta.width
            originalHeight = meta.height
            fragments = await generateVoronoiFragments(imgPath, fragmentCount, 0.15)
            logger?.info(`[碎碎冰猜${modeName}] 已生成 ${fragments.length} 个碎片`)
        } catch (err) {
            logger?.error(`[碎碎冰猜${modeName}] 生成碎片失败`, err)
            await e.reply(`生成碎片失败：${err.message}`)
            cleanPuzzleGame(groupId)
            return false
        }

        // 初始揭示 2 块碎片
        const shuffled = shuffleArray([...fragments])
        for (let i = 0; i < Math.min(2, shuffled.length); i++) {
            shuffled[i].isRevealed = true
        }

        const puzzleState = {
            fragments,
            originalWidth,
            originalHeight,
            name,
            groupId,
            startedAt: Date.now(),
            imgPath,
            extra,
            wrongCount: 0,
            mergeThresholds: mergeThresholds,
            totalCount: fragments.length,
            imageType: imageType,
        }

        puzzleGames.set(groupId, puzzleState)

        const game = {
            mode: 'puzzle',
            name,
            imgPath,
            startedAt: Date.now(),
            groupId,
        }
        games.set(groupId, game)

        try {
            const buffer = await generateCrop(game)
            await e.reply([
                segment.image(buffer),
                `\n🧊 已分割为 ${fragmentCount} 块碎片（${modeName}），初始揭示 2 块（随机位置）\n猜错一次揭示 1 块并累计猜错次数，累计猜错 ${thresholdDesc} 次时自动归位\n#提示 可额外揭示 1 块碎片（不消耗猜错次数）`
            ])
            logger?.info(`[碎碎冰猜${modeName}] 群${groupId} 开始游戏，角色: ${name}，碎片: ${fragmentCount}块`)
        } catch (err) {
            logger?.error(`[碎碎冰猜${modeName}] 发送初始碎片失败`, err)
            await e.reply(`发送碎片失败：${err.message}`)
            cleanPuzzleGame(groupId)
            return false
        }
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
        recentlyUsed.set(name, now)

        const extra = getExtraData(name)
        if (!extra) {
            await e.reply(`角色 ${name} 的 data.json 不存在，无法开始游戏`)
            return false
        }

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

        // ★ 碎碎冰模式：#提示 揭示 1 块碎片（不消耗猜错次数，不触发归位）
        if (puzzleGames.has(groupId)) {
            const puzzleState = puzzleGames.get(groupId)
            const unrevealed = puzzleState.fragments.filter(f => !f.isRevealed)

            if (unrevealed.length === 0) {
                await e.reply('所有碎片已揭示，请作答或发送 #看答案')
                return true
            }

            // 优先选择有效碎片
            const validUnrevealed = unrevealed.filter(f => f.score >= 0.15)
            const targetPool = validUnrevealed.length > 0 ? validUnrevealed : unrevealed
            const randomFrag = randomItem(targetPool)
            randomFrag.isRevealed = true

            const totalRevealed = puzzleState.fragments.filter(f => f.isRevealed).length

            try {
                const game = games.get(groupId)
                if (game) {
                    const buffer = await generateCrop(game)
                    await e.reply([
                        segment.image(buffer),
                        `\n📖 #提示 揭示 1 块碎片（已揭示 ${totalRevealed}/${puzzleState.totalCount}）`
                    ])
                }
            } catch (err) {
                logger?.error('[碎碎冰] #提示 揭示碎片失败', err)
                await e.reply(`揭示碎片失败：${err.message}`)
            }
            return true
        }

        const game = games.get(groupId)
        if (!game) {
            await e.reply('当前没有进行中的游戏')
            return false
        }

        if (game.mode === 'birthday') {
            if (!game.hintCount) game.hintCount = 0
            if (!game.maxHints) game.maxHints = 5

            if (game.hintCount >= game.maxHints) {
                await e.reply('已达到最大提示次数，即将揭晓答案……')
                await this.reveal(e)
                return true
            }

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
        if (e.user_id === e.self_id) return false

        const groupId = e.group_id
        if (!groupId) return false
        if (this.cleanTimeout(groupId)) {
            await e.reply('游戏已超时，请重新开始')
            return false
        }

        // ★ 碎碎冰模式
        if (puzzleGames.has(groupId)) {
            const puzzleState = puzzleGames.get(groupId)
            if (!puzzleState) return false

            if (!e.msg || typeof e.msg !== 'string') return false
            const input = e.msg.trim()
            if (input.startsWith('#')) return false

            // ★ 检查输入是否为角色名或别名
            const knownName = this.aliasMap[input]
            if (!knownName) {
                return false  // 无关内容，静默忽略
            }

            const isCorrect = (input === puzzleState.name) || (knownName === puzzleState.name)

            if (isCorrect) {
                // ★ 答对：使用碎碎冰专用不规则合成图
                let revealBuffer = null
                try {
                    revealBuffer = await renderPuzzleReveal(puzzleState)
                } catch (err) {
                    logger?.error('[碎碎冰] 生成揭晓图失败', err)
                }
                let replyParts = [segment.at(e.user_id), ` 恭喜答对！答案是 ${puzzleState.name}`]
                if (revealBuffer) {
                    replyParts.push(segment.image(revealBuffer))
                }
                await e.reply(replyParts)
                cleanPuzzleGame(groupId)
                return true
            }

            // ★ 猜错：累加 wrongCount
            puzzleState.wrongCount++

            // ★ 检查是否触发归位
            let merged = false
            for (const threshold of puzzleState.mergeThresholds) {
                if (puzzleState.wrongCount === threshold) {
                    const revealed = puzzleState.fragments.filter(f => f.isRevealed)
                    const unplaced = revealed.filter(f => !f.isPlaced)
                    for (const frag of unplaced) {
                        frag.isPlaced = true
                    }
                    merged = true
                    break
                }
            }

            // ★ 如果没有触发归位，尝试揭示 1 块有效碎片
            let newRevealed = false
            if (!merged) {
                const unrevealed = puzzleState.fragments.filter(f => !f.isRevealed)
                const validUnrevealed = unrevealed.filter(f => f.score >= 0.15)
                if (validUnrevealed.length > 0) {
                    const randomFrag = randomItem(validUnrevealed)
                    randomFrag.isRevealed = true
                    newRevealed = true
                } else if (unrevealed.length > 0) {
                    // 只有无效碎片，直接归位
                    const revealed = puzzleState.fragments.filter(f => f.isRevealed)
                    const unplaced = revealed.filter(f => !f.isPlaced)
                    if (unplaced.length > 0) {
                        for (const frag of unplaced) {
                            frag.isPlaced = true
                        }
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
                if (nextThreshold) {
                    replyMsg += `（下次归位需累计猜错 ${nextThreshold} 次，当前 ${puzzleState.wrongCount}/${nextThreshold}）`
                }
            } else {
                replyMsg += `\n🧊 所有碎片已揭示，继续猜吧！`
                if (nextThreshold) {
                    replyMsg += `（下次归位需累计猜错 ${nextThreshold} 次，当前 ${puzzleState.wrongCount}/${nextThreshold}）`
                }
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

        // 普通模式/图标模式/生日模式
        const game = games.get(groupId)
        if (!game) return false

        if (!e.msg || typeof e.msg !== 'string') return false

        const input = e.msg.trim()
        if (input.startsWith('#')) return false

        const knownName = this.aliasMap[input]
        if (!knownName) return false

        const isCorrect = (input === game.name) || (knownName === game.name)

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

        // ★ 碎碎冰模式：使用不规则合成图
        if (puzzleGames.has(groupId)) {
            const puzzleState = puzzleGames.get(groupId)
            if (!puzzleState) {
                await e.reply('当前没有进行中的碎碎冰游戏')
                return false
            }
            let revealBuffer = null
            try {
                revealBuffer = await renderPuzzleReveal(puzzleState)
            } catch (err) {
                logger?.error('[碎碎冰] 生成揭晓图失败', err)
            }
            let replyParts = [`答案是：${puzzleState.name}`]
            if (revealBuffer) {
                replyParts.push(segment.image(revealBuffer))
            }
            await e.reply(replyParts)
            cleanPuzzleGame(groupId)
            return true
        }

        const game = games.get(groupId)
        if (!game) {
            await e.reply('当前没有进行中的游戏')
            return false
        }

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
        if (!game && !puzzleGames.has(groupId)) {
            await e.reply('当前没有进行中的游戏')
            return false
        }
        cleanPuzzleGame(groupId)
        await e.reply('游戏已结束')
        return true
    }
}