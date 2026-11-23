import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const hintPath = new URL('../apps/internal/commands/hint.js', import.meta.url)

function createShadowGame() {
    return {
        shadowMode: true,
        shadowData: {
            cropW: 5,
            cropH: 5,
            croppedMask: new Uint8Array(25).fill(255),
        },
        shadowGridSize: 5,
        shadowTotalInner: 5,
        shadowCellRevealed: new Array(25).fill(false),
    }
}

async function loadHint({
    game = createShadowGame(),
    renderShadowImage,
    handlePixelHint = async currentGame => ({
        buffer: null,
        nextGridIndex: currentGame.currentGridIndex,
        message: 'pixel hint',
    }),
} = {}) {
    const games = new Map([[123, game]])
    const puzzleGames = new Map()
    const context = vm.createContext({
        logger: { error() {} },
        segment: { image: state => ({ type: 'image', state }) },
    })
    const core = {
        games,
        puzzleGames,
        randomItem: items => items[0],
        shuffleArray: items => items,
        cleanTimeout: () => false,
        async replyOrThrow(event, message) {
            const result = await event.reply(message)
            if (result === false || result == null) throw new Error('消息发送失败')
            return result
        },
    }
    const dependencies = {
        '../../core.js': core,
        '../../image.js': { generateCrop() {}, enlargeCrop() {}, renderPuzzleState() {} },
        '../../icon.js': { buildHintMessage() {} },
        '../../pixel.js': { handlePixelHint },
        '../../shadow.js': {
            computeInnerCells: (_data, _gridSize, revealed) => revealed
                .flatMap((value, index) => value ? [] : [index]),
            countAllInnerCells: () => 5,
            renderShadowImage: renderShadowImage || (async (_data, { cellRevealed }) => [...cellRevealed]),
        },
        './reveal.js': { reveal() {} },
    }
    const modules = new Map(Object.entries(dependencies).map(([specifier, exports]) => [
        specifier,
        new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
        }, { context }),
    ]))
    const source = await readFile(hintPath, 'utf8')
    const hintModule = new vm.SourceTextModule(source, { context })
    await hintModule.link(specifier => modules.get(specifier))
    await hintModule.evaluate()
    return { hint: hintModule.namespace.hint, game, games, puzzleGames }
}

test('parallel shadow hints preserve both reveals', async () => {
    let releaseFirstRender
    let firstRenderStarted
    const firstStarted = new Promise(resolve => { firstRenderStarted = resolve })
    const firstRenderGate = new Promise(resolve => { releaseFirstRender = resolve })
    let renderCalls = 0
    const replies = []
    const { hint, game } = await loadHint({
        async renderShadowImage(_data, { cellRevealed }) {
            renderCalls++
            if (renderCalls === 1) {
                firstRenderStarted()
                await firstRenderGate
            }
            return [...cellRevealed]
        },
    })
    const event = {
        group_id: 123,
        async reply(message) {
            replies.push(message)
            return { message_id: replies.length }
        },
    }

    const first = hint(event)
    await firstStarted
    const second = hint(event)
    try {
        await new Promise(resolve => setTimeout(resolve, 0))
        assert.equal(renderCalls, 1, 'the second render waits for the first hint to commit')
    } finally {
        releaseFirstRender()
    }
    await Promise.all([first, second])

    const sentStates = replies
        .filter(message => Array.isArray(message) && message[0]?.type === 'image')
        .map(message => message[0].state.flatMap((revealed, index) => revealed ? [index] : []))
    assert.deepEqual(sentStates, [[0], [0, 1]])
    assert.deepEqual(
        Array.from(game.shadowCellRevealed, (revealed, index) => revealed ? index : -1).filter(index => index >= 0),
        [0, 1]
    )
})

test('failed shadow hint send does not commit revealed cells', async () => {
    const { hint, game } = await loadHint()
    await hint({
        group_id: 123,
        async reply(message) {
            return Array.isArray(message) && message[0]?.type === 'image'
                ? false
                : { message_id: 1 }
        },
    })

    assert.equal(game.shadowCellRevealed.some(Boolean), false)
})

test('parallel pixel hints advance from the latest committed stage', async () => {
    let releaseFirstHint
    let firstHintStarted
    const firstStarted = new Promise(resolve => { firstHintStarted = resolve })
    const firstHintGate = new Promise(resolve => { releaseFirstHint = resolve })
    let hintCalls = 0
    const replies = []
    const game = { isPixelMode: true, currentGridIndex: 0 }
    const { hint } = await loadHint({
        game,
        async handlePixelHint(currentGame) {
            hintCalls++
            const nextGridIndex = currentGame.currentGridIndex + 1
            if (hintCalls === 1) {
                firstHintStarted()
                await firstHintGate
            }
            return { buffer: { stage: nextGridIndex }, nextGridIndex, message: `stage ${nextGridIndex}` }
        },
    })
    const event = {
        group_id: 123,
        async reply(message) {
            replies.push(message)
            return { message_id: replies.length }
        },
    }

    const first = hint(event)
    await firstStarted
    const second = hint(event)
    try {
        await new Promise(resolve => setTimeout(resolve, 0))
        assert.equal(hintCalls, 1, 'the second pixel hint waits for the first stage to commit')
    } finally {
        releaseFirstHint()
    }
    await Promise.all([first, second])

    const sentStages = replies
        .filter(message => Array.isArray(message) && message[0]?.type === 'image')
        .map(message => message[0].state.stage)
    assert.deepEqual(sentStages, [1, 2])
    assert.equal(game.currentGridIndex, 2)
})

test('queued hint is discarded when its game is replaced', async () => {
    let releaseFirstRender
    let firstRenderStarted
    const firstStarted = new Promise(resolve => { firstRenderStarted = resolve })
    const firstRenderGate = new Promise(resolve => { releaseFirstRender = resolve })
    let renderCalls = 0
    const replies = []
    const { hint, games } = await loadHint({
        async renderShadowImage(_data, { cellRevealed }) {
            renderCalls++
            if (renderCalls === 1) {
                firstRenderStarted()
                await firstRenderGate
            }
            return [...cellRevealed]
        },
    })
    const event = {
        group_id: 123,
        async reply(message) {
            replies.push(message)
            return { message_id: replies.length }
        },
    }

    const first = hint(event)
    await firstStarted
    const queued = hint(event)
    const replacementGame = { isPixelMode: true, currentGridIndex: 0 }
    games.set(123, replacementGame)
    releaseFirstRender()
    await Promise.all([first, queued])

    assert.equal(renderCalls, 1)
    assert.equal(replacementGame.currentGridIndex, 0)
    assert.equal(replies.some(message => typeof message === 'string' && message.includes('游戏状态已变化')), true)
    assert.equal(replies.some(message => Array.isArray(message) && message[0]?.type === 'image'), false)
})
