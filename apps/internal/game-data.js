import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import REGION_MAP from '../../data/roleinformation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROLE_DATA_PATH = path.join(__dirname, '../../data/roleId.js')
const BIRTHDAY_MSG_PATH = path.join(__dirname, '../../data/birthdayMessages.json')
const GENSHIN_CHARACTER_DIR = path.join(__dirname, '../../resources/genshin/character')

export let roleNames = null
export let aliasMap = null
export let birthdayMessages = null

let roleLoading = null
let msgLoading = null

export async function loadRoleData() {
    if (roleNames && aliasMap) return { roleNames, aliasMap }
    if (!roleLoading) {
        roleLoading = (async () => {
            try {
                const fileUrl = pathToFileURL(ROLE_DATA_PATH).href + '?t=' + Date.now()
                const module = await import(fileUrl)
                const data = module.default || module

                const names = []
                const alias = {}
                for (const arr of Object.values(data)) {
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
                return { roleNames, aliasMap }
            } catch (err) {
                logger?.error('[猜角色] 加载角色数据失败', err)
                throw err
            } finally {
                roleLoading = null
            }
        })()
    }
    return roleLoading
}

export async function loadBirthdayMessages() {
    if (birthdayMessages) return birthdayMessages
    if (!msgLoading) {
        msgLoading = fs.promises.readFile(BIRTHDAY_MSG_PATH, 'utf-8')
            .then(content => {
                birthdayMessages = JSON.parse(content)
                logger?.info(`[猜角色] 加载了 ${Object.keys(birthdayMessages).length} 个角色的生日贺语`)
                return birthdayMessages
            })
            .catch(err => {
                logger?.error('[猜角色] 加载生日贺语失败', err)
                return {}
            })
            .finally(() => {
                msgLoading = null
            })
    }
    return msgLoading
}

export function readDataJson(name) {
    const jsonPath = path.join(GENSHIN_CHARACTER_DIR, name, 'data.json')
    if (!fs.existsSync(jsonPath)) return null
    try {
        const content = fs.readFileSync(jsonPath, 'utf-8')
        return JSON.parse(content)
    } catch {
        return null
    }
}

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
