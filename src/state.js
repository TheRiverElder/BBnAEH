const base = `${window.location.protocol}//${window.location.host}/`;
// const base = 'http://localhost:9722/';

const state = {
    urlInfo: base + 'info',
    urlDirList: base + 'dir-list',
    urlWorkspace: base + 'workspace',
    urlAct: base + 'act',
    urlVideoDelete: base + 'videos/delete',
    urlAdbInfo: base + 'adb/info',
    urlAdbList: base + 'adb/list',
    urlAdbImport: base + 'adb/import',
    urlAdbDetect: base + 'adb/detect',
    urlAdbBrowse: base + 'adb/browse',
};

export default state;