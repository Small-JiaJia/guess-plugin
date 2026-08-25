// ============================================================
// 插件主类：猜角色 (Guess)
// 路径：./plugins/guess-plugin/apps/guess.js
// 职责：定义插件类，整合各功能模块，注册规则
// ============================================================

import plugin from '../../../lib/plugins/plugin.js'
import * as normal from './normal.js'
import * as birthday from './birthday.js'
import * as icon from './icon.js'
import * as puzzle from './puzzle.js'
import * as common from './common.js'
import { loadRoleData, loadBirthdayMessages } from './core.js'

export default class Guess extends plugin {
    constructor() {
        super({
            name: '猜角色',
            dsc: '猜原神角色 (头像/侧脸/全身/名片/命座/天赋/料理/生日贺图/碎碎冰猜立绘/角色)',
            event: 'message',
            priority: 1000,
            rule: [
                { reg: '^#猜角色帮助$', fnc: 'help' },
                { reg: '^#命座猜角色(简单|普通|困难)?$', fnc: 'startIconConstellation' },
                { reg: '^#天赋猜角色(简单|普通|困难)?$', fnc: 'startIconTalent' },
                { reg: '^#料理猜角色(简单|普通|困难)?$', fnc: 'startIconFood' },
                { reg: '^#猜生日贺图$', fnc: 'startBirthday' },
                { reg: '^#碎碎冰猜(立绘|角色)\\s*(\\d+)?$', fnc: 'startPuzzle' },
                { reg: '^#猜(头像(?:侧脸)?|角色(?:困难|地狱|小名片|名片)?|立绘)$', fnc: 'guessCommand' },
                { reg: '^#提示$', fnc: 'hint' },
                { reg: '^#看答案$', fnc: 'reveal' },
                { reg: '^#结束(猜)?(角色|头像)?$', fnc: 'endGame' },
                { reg: '^(?!#).+$', fnc: 'guess', log: false }
            ]
        })

        // 预先加载数据
        this.loaded = false
        this.loadData()

        // 将各模块的方法绑定到实例上，供规则调用
        this.help = common.help
        this.hint = common.hint
        this.reveal = common.reveal
        this.endGame = common.endGame
        this.guess = common.guess
        this.guessCommand = normal.guessCommand
        this.startBirthday = birthday.startBirthday

        // 图标模式需要额外包装，因为它们需要传递 baseMode 和 difficulty
        this.startIconConstellation = (e) => {
            const match = e.msg.match(/^#命座猜角色(简单|普通|困难)?$/)
            const difficulty = match?.[1] || '普通'
            return icon.startIconGame(e, 'constellation', difficulty, '命座')
        }
        this.startIconTalent = (e) => {
            const match = e.msg.match(/^#天赋猜角色(简单|普通|困难)?$/)
            const difficulty = match?.[1] || '普通'
            return icon.startIconGame(e, 'talent', difficulty, '天赋')
        }
        this.startIconFood = (e) => {
            const match = e.msg.match(/^#料理猜角色(简单|普通|困难)?$/)
            const difficulty = match?.[1] || '普通'
            return icon.startIconGame(e, 'food', difficulty, '料理')
        }

        this.startPuzzle = puzzle.startPuzzle
    }

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
}