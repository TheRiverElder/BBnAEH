// const base = `${window.location.protocol}//${window.location.host}/`;
const base = 'http://localhost:9722/';

const state = {
    urlInfo: base + 'info',
    urlDirList: base + 'dir-list',
    urlWorkspace: base + 'workspace',
    urlAct: base + 'act',
};

export default state;