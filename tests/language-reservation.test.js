import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('language start reports when every target is already reserved', async () => {
    const roleNames = Array.from({ length: 7 }, (_, index) => `角色${index}`)
    const games = new Map()
    const recentlyUsed = new Map()
    const context = vm.createContext({ logger: { info() {}, error() {} } })
    const core = {
        games,
        recentlyUsed,
        randomItem: items => items[0],
        shuffleArray: items => items,
        withGameStartLock: async (_groupId, _onBusy, start) => start(),
        withRoleReservation: async () => false,
        isRoleReserved: () => true,
        async replyOrThrow(event, message) {
            const result = await event.reply(message)
            if (result === false || result == null) throw new Error('消息发送失败')
            return result
        },
        COOLDOWN_MS: 24 * 60 * 60 * 1000,
        getExtraData: () => null,
    }
    const exportsModule = (exports, defaults = {}) => new vm.SyntheticModule(
        [...Object.keys(exports), ...Object.keys(defaults)],
        function () {
            for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
            for (const [name, value] of Object.entries(defaults)) this.setExport(name, value)
        },
        { context }
    )
    const path = {
        dirname: value => value.slice(0, value.lastIndexOf('/')),
        join: (...parts) => parts.join('/'),
    }
    const dependencies = new Map([
        ['sharp', exportsModule({}, { default: () => ({ webp() { return this }, async toBuffer() { return Buffer.alloc(0) } }) })],
        ['fs', exportsModule({}, { default: { existsSync: () => true } })],
        ['path', exportsModule({}, { default: path })],
        ['url', exportsModule({ fileURLToPath: () => '/plugin/apps/language.js' })],
        ['./internal/language-data.js', exportsModule({ loadAllRoleData: async () => ({ names: roleNames, data: {} }) })],
        ['./core.js', exportsModule(core)],
    ])
    const source = await readFile(new URL('../apps/language.js', import.meta.url), 'utf8')
    const languageModule = new vm.SourceTextModule(source, {
        context,
        initializeImportMeta(meta) { meta.url = 'file:///plugin/apps/language.js' },
    })
    await languageModule.link(specifier => dependencies.get(specifier))
    await languageModule.evaluate()

    const replies = []
    const result = await languageModule.namespace.startLanguageGame({
        group_id: 123,
        async reply(message) {
            replies.push(message)
            return { message_id: replies.length }
        },
    })

    assert.equal(result, false)
    assert.equal(replies[0], '所有可用角色正在生成游戏，请稍后重试')
    assert.equal(games.size, 0)
})
