const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser')
const opn = require('opn');
const child_process = require('child_process');
const adb = require('./server/adb.cjs');

const PORT = Number(process.env.PORT) || 9722;
// 只监听本机：这个服务能读任意目录、还能删除 videos 下的内容，不应该暴露到局域网。
// 确实需要从别的设备访问时，显式设置 HOST=0.0.0.0。
const HOST = process.env.HOST || '127.0.0.1';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const DEFAULT_WORKSPACE_PATH = path.resolve('./');
const RECORD_PATH = path.resolve('./record.json');
const ROOTS = ['C:/', 'D:/', 'E:/'];
let record = readRecord() || {
	workspacePath: DEFAULT_WORKSPACE_PATH,
};

const server = express();

server.use(bodyParser.json()) // for parsing application/json
server.use(bodyParser.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

server.use(express.static(path.resolve('./dist')));

// 设置跨域
server.all('*', function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', '*');
    next();
});

// 获取基本信息，包括：根目录列表、推荐工作文件夹
server.get('/info', (req, res) => {
	console.log('info');
	try {
		res.json({succeed: true, info: {
			roots: ROOTS,
			recommandWorkspacePath: record.workspacePath
		}});
	} catch (e) {
		res.json({succeed: false, err: "获取初始信息失败"});
	}
});

// 获取该目录下的文件列表
server.get('/dir-list', (req, res) => {
	console.log('dir-list', req.query.path || "Empty");
	try {
		const list = getDirList(req.query.path);
		res.json({succeed: true, list: list});
	} catch (e) {
		res.json({succeed: false, err: (req.query.path || '<空路径>') + " 读取失败"});
	}
});

// 获取工作文件夹下的信息，包括：视频信息、已有歌曲信息
server.get('/workspace', (req, res) => {
	console.log('workspace', req.query.path || "Empty");
	const wsp = req.query.path;
	if (!wsp) {
		res.json({succeed: false, err: "缺少工作目录"});
		return;
	}
	try {
		// 目录不存在时按空列表处理：选到一个还没建 videos/audios 的文件夹时，
		// 页面应该显示“0 个视频”，而不是整页报错。
		const videos = getVideoList(path.resolve(wsp, 'videos'));
		const audios = getAudioList(path.resolve(wsp, 'audios'));
		res.json({succeed: true, workspace: {videos, audios}});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: (wsp || '<空路径>') + " 读取失败"});
	}
});

// 最后的行动：等 ffmpeg 全部转完再回复，前端才能显示真实结果并刷新列表
server.post('/act', (req, res) => {
	const config = req.body;
	console.log('act:');
	console.dir(config);
	let result;
	try {
		result = act(config || {});
		res.json({succeed: true, result});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: String((e && e.message) || e)});
	}
});

// 删除 videos 目录下的选定视频（清理误复制进来的缓存）
server.post('/videos/delete', (req, res) => {
	const config = req.body || {};
	console.log('delete videos:');
	console.dir(config);
	try {
		const result = deleteVideos(config.workspacePath, config.list);
		res.json({succeed: true, result});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: String((e && e.message) || e)});
	}
});

// adb 环境：是否找到 adb、已连接设备、默认缓存目录
server.get('/adb/info', (req, res) => {
	try {
		res.json({succeed: true, ...adb.describe()});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: String((e && e.message) || e)});
	}
});

// 读取设备上指定缓存目录里的视频列表
server.post('/adb/list', (req, res) => {
	const body = req.body || {};
	console.log('adb list:', body.device, body.root || adb.DEFAULT_DEVICE_ROOT);
	try {
		const info = adb.describe();
		if (!info.available) throw new Error(info.hint || '未找到 adb');
		const serial = adb.requireDevice(body.device, info.devices);
		const root = adb.requireDeviceRoot(body.root);
		const started = Date.now();
		const listed = adb.listCache(info.adbPath, serial, root);
		res.json({
			succeed: true,
			device: serial,
			root,
			mode: listed.mode,
			entries: listed.entries,
			ms: Date.now() - started,
		});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: String((e && e.message) || e)});
	}
});

// 自动查找设备上的 B 站缓存目录（支持多个包名 / SD 卡）
server.post('/adb/detect', (req, res) => {
	const body = req.body || {};
	console.log('adb detect:', body.device);
	try {
		const info = adb.describe();
		if (!info.available) throw new Error(info.hint || '未找到 adb');
		const serial = adb.requireDevice(body.device, info.devices);
		const result = adb.detectRoots(info.adbPath, serial);
		console.log('adb detect done:', result.roots.map(root => `${root.path}(${root.entries})`).join(', '));
		res.json({succeed: true, ...result});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: String((e && e.message) || e)});
	}
});

// 浏览设备目录（手动定位缓存目录）
server.post('/adb/browse', (req, res) => {
	const body = req.body || {};
	try {
		const info = adb.describe();
		if (!info.available) throw new Error(info.hint || '未找到 adb');
		const serial = adb.requireDevice(body.device, info.devices);
		const result = adb.browse(info.adbPath, serial, body.path);
		res.json({succeed: true, ...result});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: String((e && e.message) || e)});
	}
});

// 把设备上选中的视频复制到工作文件夹的 videos/ 或本地临时文件夹
server.post('/adb/import', (req, res) => {
	const body = req.body || {};
	const target = body.target || {};
	console.log('adb import:', body.device, target.mode, body.entries && body.entries.length);
	try {
		const info = adb.describe();
		if (!info.available) throw new Error(info.hint || '未找到 adb');
		const serial = adb.requireDevice(body.device, info.devices);
		const root = adb.requireDeviceRoot(body.root);
		const targetDir = adb.resolveTarget({
			mode: target.mode,
			dir: target.dir,
			workspacePath: target.workspacePath || body.workspacePath || record.workspacePath,
		});
		const result = adb.importEntries({
			adbPath: info.adbPath,
			serial,
			root,
			entries: body.entries,
			targetDir,
		});
		console.log('adb import done:', result.imported, '->', targetDir);
		res.json({succeed: true, result});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: String((e && e.message) || e)});
	}
});

server.listen(PORT, HOST, () => {
	const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
	console.log(`BBnAEH server: http://${shown}:${PORT}/ (bind ${HOST})`);
	// NO_OPEN=1 时不自动打开浏览器（便于脚本化测试 / 无桌面环境）。
	if (!process.env.NO_OPEN) opn(`http://${shown}:${PORT}/`);
});

// Utils

// 获取该文件夹下的子项信息
function getDirList(qureyDir) {
    const dirStats = fs.statSync(qureyDir);
    const list = [];
    if (!dirStats.isDirectory()) {
        return qureyDir + ' 不是目录';
    }
    for (let sd of fs.readdirSync(qureyDir)) {
		try {
			const sds = fs.statSync(path.resolve(qureyDir, sd));
			list.push({name: sd, isDir: sds.isDirectory()});
		} catch (e) { /* 无权限的条目直接跳过 */ }
    }
    return list;
}

// 确保工作目录处于可用状态
function ensureWorkspaceValid(dir) {
	[
		path.resolve(dir, 'videos'),
		path.resolve(dir, 'audios'),
		path.resolve(dir, 'tmp'),
	].forEach(p => fs.existsSync(p) || fs.mkdirSync(p, {recursive: true}));
}

// 获取该目录下的B站视频缓存信息
function getVideoList(dir) {
    const list = [];
	if (!fs.existsSync(dir)) {
		return list;
	}
    for (let videoDir of fs.readdirSync(dir)) {
        const videoDirPath = path.resolve(dir, videoDir);
		try {
			// 跳过非目录（例如 B 站缓存目录旁边的 .DS_Store）
			if (!fs.statSync(videoDirPath).isDirectory()) continue;
			for (let videoPartDir of fs.readdirSync(videoDirPath)) {
				const videoPartDirPath = path.resolve(videoDirPath, videoPartDir);
				const entryPath = path.resolve(videoPartDirPath, 'entry.json');
				try {
					const entryJson = fs.readFileSync(entryPath, 'utf-8');
					// 有些 entry.json 带 UTF-8 BOM，JSON.parse 会直接报错。
					const entry = JSON.parse(entryJson.replace(/^\uFEFF/, ''));
					list.push({path: path.relative(dir, videoPartDirPath), entry: entry});
				} catch (e) { /* 跳过坏条目 */ }
			}
		} catch (e) { /* 跳过无法访问的子目录 */ }
    }
    return list;
}

const MUSIC_EXT = new Set([
	'mp3', 'flac', 'wav', 'ogg', 'ape', 'm4a'
]);

// 获取该目录下的音乐信息
function getAudioList(dir) {
    const list = [];
	if (!fs.existsSync(dir)) {
		return list;
	}
    for (let audioName of fs.readdirSync(dir)) {
        const audioPath = path.resolve(dir, audioName);
		try {
			let s = fs.statSync(audioPath);
			if (s.isFile()) {
				const index = audioName.lastIndexOf('.');
				const name = index >= 0 ? audioName.slice(0, index) : audioName;
				const ext = index >= 0 ? audioName.slice(index + 1) : '';
				if (MUSIC_EXT.has(ext.toLowerCase())) {
					list.push({path: path.relative(dir, audioPath), name});
				}
			}
		} catch(e) { /* 跳过无法读取的文件 */ }
    }
    return list;
}

const ORIGINAL_FILE_NAMES = ['0.blv', 'audio.m4s'];

// 实际提取行动
function act(config) {
	const wsp = config.workspacePath;
	if (!wsp || typeof wsp !== 'string') {
		throw new Error('缺少工作目录 workspacePath');
	}
	if (!Array.isArray(config.list)) {
		throw new Error('缺少待提取列表 list');
	}
	ensureWorkspaceValid(wsp);
	const videosPath = path.resolve(wsp, 'videos');
	const audiosPath = path.resolve(wsp, 'audios');
	const tmpPath = path.resolve(wsp, 'tmp');
	// 复制带有音频信息的源文件
	const srcFiles = [];
	config.list.forEach(entry => {
		try {
			const dir = getTheOnlySubdir(path.resolve(videosPath, entry.path));
			if (dir) {
				const possibleFilePath = ORIGINAL_FILE_NAMES.map(e => path.resolve(dir, e));
				for (let filePath of possibleFilePath) {
					if (fs.existsSync(filePath)) {
						const targetName = path.format({
							dir: tmpPath,
							name: entry.name,
							ext: path.extname(filePath),
						});
						fs.copyFileSync(filePath, targetName)
						srcFiles.push({
							src: targetName,
							name: entry.name,
						});
					}
				}
			} else {
				console.log('skip: 找不到视频的音频目录', entry.path);
			}
		} catch (e) { console.log(e); }
	});
	// 使用ffmpeg进行转换
	const summary = {requested: config.list.length, copied: srcFiles.length, converted: 0, skipped: 0, failed: 0};
	srcFiles.forEach(({src, name}, index) => {
		const audioPath = path.format({
			dir: audiosPath,
			name: name,
			ext: '.mp3',
		});
		if (fs.existsSync(audioPath)) {
			summary.skipped += 1;
			console.log(`convert abanden(${index + 1}/${srcFiles.length}): already exists file `, audioPath);
			return;
		}
		// 用数组传参而不是拼 shell 字符串：文件名里的引号/&/空格不会再出问题。
		const result = child_process.spawnSync(FFMPEG, ['-n', '-i', src, audioPath], {encoding: 'utf-8'});
		if (result.error || result.status !== 0) {
			summary.failed += 1;
			console.log(`convert failed(${index + 1}/${srcFiles.length}): ${name}`);
			console.log(result.error || result.stderr);
			return;
		}
		summary.converted += 1;
		console.log(`converted(${index + 1}/${srcFiles.length}): ${name} `);
	});
	record = {
		workspacePath: wsp,
	};
	fs.writeFileSync(RECORD_PATH, JSON.stringify(record));
	console.log('done', summary);
	return summary;
}

// 把「视频相对路径」解析成 videos 目录内的绝对路径；任何越界都拒绝。
// 注意：前端传来的是 getVideoList() 里的 path（如 `BV1xx\1`），不是绝对路径。
function resolveVideoDir(workspacePath, videoPath) {
	if (!workspacePath || typeof workspacePath !== 'string') {
		throw new Error('缺少工作目录 workspacePath');
	}
	if (!videoPath || typeof videoPath !== 'string') {
		throw new Error('缺少视频路径');
	}
	if (path.isAbsolute(videoPath)) {
		throw new Error(`不允许绝对路径：${videoPath}`);
	}
	const videosRoot = path.resolve(workspacePath, 'videos');
	const target = path.resolve(videosRoot, videoPath);
	if (target === videosRoot) {
		throw new Error('不允许删除 videos 根目录');
	}
	if (!target.startsWith(videosRoot + path.sep)) {
		throw new Error(`路径不在 videos 目录内：${videoPath}`);
	}
	return {videosRoot, target};
}

// 删除成功后，顺手清掉 videos 下变空的上级目录（如 videos/<avid>），
// 避免误复制进来的空壳一直留在列表里看不到。
function pruneEmptyParents(from, videosRoot) {
	let current = from;
	while (current !== videosRoot && current.startsWith(videosRoot + path.sep)) {
		try {
			const stat = fs.lstatSync(current);
			// 符号链接只删链接本身，不顺着链接删；这里遇到就停手。
			if (!stat.isDirectory() || stat.isSymbolicLink()) return;
			if (fs.readdirSync(current).length > 0) return;
			fs.rmdirSync(current);
			console.log('removed empty dir:', current);
		} catch (e) {
			return;
		}
		current = path.dirname(current);
	}
}

// 删除一组视频目录（逐个执行，单个失败不影响其它）
function deleteVideos(workspacePath, list) {
	if (!Array.isArray(list) || list.length === 0) {
		throw new Error('缺少待删除列表 list');
	}
	const results = [];
	let deleted = 0;
	list.forEach(item => {
		const videoPath = typeof item === 'string' ? item : (item && item.path);
		try {
			const {videosRoot, target} = resolveVideoDir(workspacePath, videoPath);
			if (!fs.existsSync(target)) {
				throw new Error('目录不存在');
			}
			const stat = fs.lstatSync(target);
			if (stat.isSymbolicLink()) {
				// 只删链接本身，绝不顺着链接删到工作目录之外。
				fs.unlinkSync(target);
			} else if (stat.isDirectory()) {
				fs.rmSync(target, {recursive: true, force: true});
			} else {
				throw new Error('不是视频目录');
			}
			deleted += 1;
			results.push({path: videoPath, ok: true});
			console.log('deleted video:', target);
			pruneEmptyParents(path.dirname(target), videosRoot);
		} catch (e) {
			results.push({path: videoPath, ok: false, err: String((e && e.message) || e)});
			console.log('delete failed:', videoPath, (e && e.message) || e);
		}
	});
	return {requested: list.length, deleted, failed: list.length - deleted, results};
}

// 获取一个文件夹下的第一个子文件夹
function getTheOnlySubdir(dirPath) {
	if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
		return null;
	}
	let dir = null;
	for (let se of fs.readdirSync(dirPath)) {
		const p = path.resolve(dirPath, se);
		if (fs.statSync(p).isDirectory()) {
			dir = p;
			break;
		}
	}
	return dir;
}

// 读取记录
function readRecord() {
	if (fs.existsSync(RECORD_PATH) && fs.statSync(RECORD_PATH).isFile()) {
		try {
			const r = JSON.parse(fs.readFileSync(RECORD_PATH));
			return r;
		} catch (e) { 
			console.log(e);
			return null;
		}
	} else {
		return null;
	}
}
