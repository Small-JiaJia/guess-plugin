// ./guess-plugin/apps/help.js
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import helpCfg from '../config/help.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 功能列表
const helpList = [
  { icon: 1, title: '#猜头像', desc: '显示角色头像局部' },
  { icon: 2, title: '#猜头像侧脸', desc: '显示角色侧脸头像局部' },
  { icon: 3, title: '#猜角色', desc: '显示全身图局部（无滤镜）' },
  { icon: 4, title: '#猜角色普通', desc: '显示全身图局部（无滤镜）' },
  { icon: 5, title: '#猜角色困难', desc: '黑白效果 + 局部' },
  { icon: 6, title: '#猜角色地狱', desc: '反色效果 + 局部' },
  { icon: 7, title: '#命座猜角色', desc: '显示命座图标，初始1条提示' },
  { icon: 8, title: '#命座猜角色简单', desc: '显示命座图标，初始2条提示' },
  { icon: 9, title: '#命座猜角色困难', desc: '显示命座图标，初始无提示' },
  { icon: 10, title: '#天赋猜角色', desc: '显示天赋图标，初始1条提示' },
  { icon: 11, title: '#天赋猜角色简单', desc: '显示天赋图标，初始2条提示' },
  { icon: 12, title: '#天赋猜角色困难', desc: '显示天赋图标，初始无提示' },
  { icon: 13, title: '#提示', desc: '扩大显示区域 / 揭示更多信息' },
  { icon: 14, title: '#看答案', desc: '揭晓答案' },
  { icon: 15, title: '#结束', desc: '结束当前游戏' },
]

export default class Help {
  /**
   * 渲染帮助图片
   * @param {Object} e - 消息事件对象
   * @returns {Promise<Buffer>} 图片 Buffer
   */
  static async render(e) {
    const helpDir = path.join(__dirname, '../resources/help')
    const htmlPath = path.join(helpDir, 'index.html')
    const cssPath = path.join(helpDir, 'index.css')
    const themeConfigPath = path.join(helpDir, 'theme', helpCfg.theme || 'default', 'config.js')
    const iconPath = path.join(helpDir, 'icon.png')

    // 读取模板和样式
    let html = fs.readFileSync(htmlPath, 'utf-8')
    const css = fs.readFileSync(cssPath, 'utf-8')
    let themeCfg = {}
    try {
      const themeModule = await import(themeConfigPath + '?t=' + Date.now())
      themeCfg = themeModule.default || themeModule
    } catch (e) {}

    // 合并配置（主题配置覆盖默认）
    const config = {
      title: helpCfg.title || '猜角色帮助',
      subTitle: helpCfg.subTitle || 'Guess-Plugin',
      colCount: helpCfg.colCount || 3,
      colWidth: helpCfg.colWidth || 265,
      bg: themeCfg.bg || null,
      textColor: themeCfg.textColor || '#ffffff',
      glassColor: themeCfg.glassColor || 'rgba(255,255,255,0.1)',
      ...themeCfg
    }

    // 将功能列表分组（按列数）
    const groups = []
    const perCol = Math.ceil(helpList.length / config.colCount)
    for (let i = 0; i < helpList.length; i += perCol) {
      groups.push(helpList.slice(i, i + perCol))
    }

    // 使用 art-template 渲染（需要安装 art-template）
    // 这里我们用简单的字符串替换，但建议使用 art-template
    // 为了示例，我们使用模板引擎（需先安装）
    const art = (await import('art-template')).default
    const renderData = {
      ...config,
      list: helpList,
      groups: groups,
      iconPath: 'icon.png'
    }
    const renderedHtml = art.render(html, renderData)

    // 使用 puppeteer 截图
    const img = await puppeteer.screenshot('help', {
      html: renderedHtml,
      css: css,
      width: config.colCount * config.colWidth + 30
    })

    return img
  }
}