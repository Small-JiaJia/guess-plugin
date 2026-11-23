import sharp from 'sharp'
import { Delaunay } from 'd3-delaunay'

// ---------- 碎片有效评分函数 ----------
async function calculateFragmentScore(fragmentBuffer) {
    try {
        const { data, info } = await sharp(fragmentBuffer)
            .toColorspace('srgb')
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true })
        const channels = info.channels
        let sumR = 0, sumG = 0, sumB = 0, count = 0
        for (let i = 0; i < data.length; i += channels) {
            const a = data[i + 3]
            if (a < 30) continue // 跳过透明像素
            sumR += data[i]
            sumG += data[i + 1]
            sumB += data[i + 2]
            count++
        }
        if (count === 0) return 0
        const avgLum = (sumR + sumG + sumB) / (count * 3)
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
        const score = (avgLum / 255) * 0.6 + Math.min(variance * 10, 1) * 0.4
        return score
    } catch {
        return 0
    }
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

// ---------- ★ Voronoi 碎片生成核心（带递归深度限制） ----------
export async function generateVoronoiFragments(imagePath, fragmentCount = 100, minScore = 0.15, depth = 0) {
    const MAX_DEPTH = 3 // 防止无限递归

    const image = sharp(imagePath)
    const metadata = await image.metadata()
    const { width, height } = metadata

    // 生成随机点（含边界点）
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

    // 计算 Delaunay 三角网和 Voronoi 图
    const delaunay = Delaunay.from(allPoints)
    const voronoi = delaunay.voronoi([0, 0, width, height])

    // 提取每个单元格多边形
    const polygons = []
    for (let i = 0; i < allPoints.length; i++) {
        const cell = voronoi.cellPolygon(i)
        if (cell && cell.length >= 3) {
            const bounds = getPolygonBounds(cell)
            if (bounds.w > 0 && bounds.h > 0) {
                polygons.push({
                    id: i,
                    points: cell.flat(),
                    bounds: bounds,
                })
            }
        }
    }

    // 提取每个碎片的图片（使用 Alpha 蒙版）
    const fragments = []
    const originalImage = sharp(imagePath)

    for (const poly of polygons) {
        const { x, y, w, h } = poly.bounds
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
                isRevealed: false,
                isPlaced: false,
                randomX: Math.random() * Math.max(0, maxRX) + margin2 / 2,
                randomY: Math.random() * Math.max(0, maxRY) + margin2 / 2,
            })
        } catch (err) {
            continue // 跳过提取失败的碎片
        }
    }

    // 有效像素过滤，如果有效碎片不足且未达到最大递归深度，则降低阈值重试
    const filtered = fragments.filter(f => f.score >= minScore)
    if (filtered.length < Math.min(fragmentCount * 0.5, fragmentCount - 10) && depth < MAX_DEPTH) {
        const retry = await generateVoronoiFragments(imagePath, fragmentCount, minScore * 0.4, depth + 1)
        return retry
    }

    // 按分数排序，取前 fragmentCount 个
    filtered.sort((a, b) => b.score - a.score)
    const result = filtered.slice(0, fragmentCount)

    // 如果结果仍然不足，补一些随机矩形碎片
    const originalImageForFill = sharp(imagePath)
    const maxFillAttempts = Math.max(100, Math.min(10000, fragmentCount * 20))
    let fillAttempts = 0
    while (result.length < fragmentCount && fillAttempts < maxFillAttempts) {
        fillAttempts++
        const extractW = Math.min(width, Math.max(1, Math.ceil(Math.random() * 150 + 40)))
        const extractH = Math.min(height, Math.max(1, Math.ceil(Math.random() * 150 + 40)))
        const maxX = width - extractW
        const maxY = height - extractH
        const x = Math.floor(Math.random() * (maxX + 1))
        const y = Math.floor(Math.random() * (maxY + 1))
        try {
            const extractBuffer = await originalImageForFill.clone()
                .extract({ left: x, top: y, width: extractW, height: extractH })
                .png()
                .toBuffer()
            const score = await calculateFragmentScore(extractBuffer)
            const marginX = Math.min(15, (width - extractW) / 2)
            const marginY = Math.min(15, (height - extractH) / 2)
            result.push({
                id: result.length,
                rect: { x, y, w: extractW, h: extractH },
                buffer: extractBuffer,
                score: score || 0.3,
                isRevealed: false,
                isPlaced: false,
                randomX: Math.random() * Math.max(0, width - extractW - marginX * 2) + marginX,
                randomY: Math.random() * Math.max(0, height - extractH - marginY * 2) + marginY,
            })
        } catch (err) {
            continue
        }
    }

    if (result.length < fragmentCount) {
        throw new Error(`无法生成足够的拼图片段（${result.length}/${fragmentCount}）`)
    }

    return result
}
// ---------- ★ 渲染碎碎冰当前状态 ----------
export async function renderPuzzleState(fragments, originalWidth, originalHeight) {
    // 只取已揭示的碎片
    const revealed = fragments.filter(f => f.isRevealed)

    if (revealed.length === 0) {
        // 如果没有揭示任何碎片，返回全黑背景
        return await sharp({
            create: {
                width: originalWidth,
                height: originalHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        }).webp({ quality: 85 }).toBuffer()
    }

    // 构建合成图层：已揭示的碎片按位置或随机位置放置
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

    // 在黑色背景上合成所有碎片
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
export async function renderPuzzleReveal(puzzleState) {
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

    // 读取原图并整体暗化（作为背景）
    const image = sharp(imgPath)
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = info.width, height = info.height, channels = info.channels

    // 将每个像素的亮度降低到 30%
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
