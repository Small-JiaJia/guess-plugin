export const helpGroups = [
    {
        title: '基础猜图',
        subtitle: '从头像、立绘到名片，找出被遮住的角色',
        items: [
            { command: '#猜头像', description: '猜局部头像' },
            { command: '#猜头像侧脸', description: '猜侧脸头像' },
            { command: '#猜角色', description: '猜局部抽卡立绘' },
            { command: '#猜立绘', description: '猜局部全身立绘' },
            { command: '#猜角色困难', description: '黑白抽卡立绘' },
            { command: '#猜角色地狱', description: '反色抽卡立绘' },
            { command: '#猜角色小名片', description: '猜局部小名片' },
            { command: '#猜角色名片', description: '猜局部角色名片' },
            { command: '#猜生日贺图', description: '猜局部生日贺图' }
        ]
    },
    {
        title: '进阶玩法',
        subtitle: '改变画面表现，或挑战多语言选项',
        items: [
            { command: '#像素猜角色', description: '从 8×8 像素图开始，#提示逐级提升至 32×32' },
            { command: '#剪影猜角色', description: '观察剪影轮廓与逐步显露的内部纹样，#提示可揭示内部' },
            { command: '#多语言猜角色', description: '从 6 个语言选项中选出正确名称，发送 A-F 作答；不支持 #提示' }
        ]
    },
    {
        title: '命座、天赋与料理',
        subtitle: '观察图标，根据提示推理角色',
        items: [
            { command: '#命座猜角色', description: '猜命座图标，初始 1 条提示' },
            { command: '#命座猜角色简单', description: '猜命座图标，初始 2 条提示' },
            { command: '#命座猜角色困难', description: '猜命座图标，无初始提示' },
            { command: '#天赋猜角色', description: '猜天赋图标，初始 1 条提示' },
            { command: '#天赋猜角色简单', description: '猜天赋图标，初始 2 条提示' },
            { command: '#天赋猜角色困难', description: '猜天赋图标，无初始提示' },
            { command: '#料理猜角色', description: '猜特色料理，初始 1 条提示' },
            { command: '#料理猜角色简单', description: '猜特色料理，初始 2 条提示' },
            { command: '#料理猜角色困难', description: '猜特色料理，无初始提示' }
        ]
    },
    {
        title: '碎碎冰拼图',
        subtitle: '不规则碎片打乱位置，逐步拼出角色图像',
        items: [
            { command: '#碎碎冰猜立绘', description: '全身立绘碎片，默认 100 块' },
            { command: '#碎碎冰猜角色', description: '抽卡立绘碎片，默认 100 块' },
            { command: '#碎碎冰猜立绘 120', description: '设置全身立绘碎片数，范围 20–200' },
            { command: '#碎碎冰猜角色 120', description: '设置抽卡立绘碎片数，范围 20–200' }
        ]
    },
    {
        title: '游戏控制',
        subtitle: '游戏进行中可使用以下指令',
        items: [
            { command: '#提示', description: '扩大画面、提升像素清晰度或揭示更多信息' },
            { command: '#看答案', description: '揭晓本局答案' },
            { command: '#结束', description: '结束当前游戏' }
        ]
    }
]

export const helpNotes = [
    {
        title: '剪影玩法',
        items: [
            '初始显示深棕剪影：保留外轮廓，内部完全填平。',
            '#提示 每次随机揭示约五分之一的剪影内部格子。',
            '根据逐步显露的内部纹样推理角色。'
        ]
    },
    {
        title: '碎碎冰规则',
        items: [
            '立绘被分割成不规则碎片并打乱位置，初始随机揭示 2 块。',
            '猜错会增加错误次数并揭示 1 块新碎片。',
            '猜错达到设定次数时，已揭示碎片会自动归位；阈值依碎片数量调整。',
            '#提示 可额外揭示 1 块碎片，不增加猜错次数。',
            '答对或查看答案时会显示碎片合成图。'
        ]
    },
    {
        title: '游戏时限',
        items: ['每局游戏时限为 5 分钟，超时后需要重新开始。']
    }
]

export const answerTip = '普通玩法直接发送角色名或别名作答；多语言玩法发送 A-F 中对应字母（不区分大小写），且不支持 #提示。'

export const helpText = [
    '猜角色帮助',
    ...helpGroups.map(group => [
        `【${group.title}】`,
        group.subtitle ? `  ${group.subtitle}` : '',
        ...group.items.map(item => `  ${item.command} - ${item.description}`)
    ].filter(Boolean).join('\n')),
    ...helpNotes.map(note => `【${note.title}】\n${note.items.map(item => `  - ${item}`).join('\n')}`),
    `【作答方式】\n  ${answerTip}`
].join('\n\n')
