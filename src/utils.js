
// 单个歌姬的正式名称
// const SINGERS = [
//     '洛天依',
//     '乐正绫',
//     '徵羽摩柯',
//     '乐正龙牙',
//     '墨清弦',
//     '言和',
//     '心华',
//     '星尘',
//     '海伊',
//     '赤羽',
//     '诗岸',
//     '鏡音リン',
//     '鏡音レン',
//     '初音ミク',
// ];

// 单个歌姬的别名
const SINGER_ALIASES = {
    '洛天依': ['洛天依', '天依'],
    '乐正绫': ['乐正绫', '阿凌'],
    '徵羽摩柯': ['徵羽摩柯', '摩柯', 'MOKE'],
    '乐正龙牙': ['乐正龙牙', '龙牙'],
    '墨清弦': ['墨清弦'],
    '言和': ['言和'],
    '心华': ['心华'],
    '星尘': ['星尘'],
    '海伊': ['海伊'],
    '赤羽': ['赤羽'],
    '鏡音レン': ['鏡音レン', '鏡音连', '镜音レン', '镜音连', 'KAGAMINELEN', 'REN'],
    '鏡音リン': ['鏡音リン', '鏡音铃', '镜音リン', '镜音铃', 'KAGAMINERIN', 'RIN'],
    '初音ミク': ['初音ミク', '初音MIKU', 'MIKU', '初音气', 'HATSUNE', 'HATSUNEMIKU', '初音', '初音未来'],
};

// 歌姬组合
const SINGER_GROUPS = {
    '南北组': ['洛天依', '乐正绫'],
    '龙言': ['乐正龙牙', '言和'],
    '鏡音リン・レン': ['鏡音レン', '鏡音リン'],
};

// 歌姬组合的别名
const SINGER_GROUP_ALIASES = {
    '南北组': ['南北'],
    '龙言': ['龙言'],
    '鏡音リン・レン': ['鏡音リン・レン', '镜音双子', '鏡音双子', 'KAGAMINE', '镜音リン・レン', '镜音LEN・RIN', '鏡音レン・リン', '蕉橘'],
};

const MAPPER = (function() {
    const m = {...SINGER_GROUPS};
    Object.entries(SINGER_GROUP_ALIASES).forEach(([name, aliases]) => aliases.forEach(alias => m[alias] = SINGER_GROUPS[name]));
    Object.entries(SINGER_ALIASES).forEach(([name, aliases]) => aliases.forEach(alias => m[alias] = [name]));
    return m;
})();
const kEYWORDS = Object.keys(MAPPER);

function predicateSongName(title) {
    const slist = title.split(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FA5A-Za-z・ ]+/g).filter(s => !!s);
    const singers = new Set();
    let name = '';
    slist.forEach(s => {
        let flag = false;
        kEYWORDS.forEach(kw => {
            if (!singers.has(kw) && s.indexOf(kw) >= 0) {
                MAPPER[kw].forEach(singer => singers.add(singer));
                flag = true;
            }
        });
        if (!flag) {
            name = s.length > name.length ? s : name;
        }
    });
    return [...singers].join(' & ') + ' - ' + name;
}

export {
    predicateSongName,
};