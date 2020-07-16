const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser')
const opn = require('opn');
const child_process = require('child_process');

const PORT = 9722;
const DEFAULT_WORKSPACE_PATH = path.resolve('./test/');
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
    res.end();
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
    res.end();
});

// 获取工作文件夹下的信息，包括：视频信息、已有歌曲信息
server.get('/workspace', (req, res) => {
	console.log('workspace', req.query.path || "Empty");
	const wsp = req.query.path;
	try {
		const videos = getVideoList(path.resolve(wsp, 'videos'));
		const audios = getAudioList(path.resolve(wsp, 'audios'));
		res.json({succeed: true, workspace: {videos, audios}});
	} catch (e) {
		console.log(e);
		res.json({succeed: false, err: (wsp || '<空路径>') + " 读取失败"});
	}
    res.end();
});

// 最后的行动
server.post('/act', (req, res) => {
	const config = req.body;
	console.log('act:');
	console.dir(config);
	res.json({succeed: true, config});
	res.end();
	try {
		act(config);
	} catch (e) {
		console.log(e);
	}
});

server.listen(PORT, () => opn(`http://localhost:${PORT}/`));

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
		} catch (e) { }
    }
    return list;
}

// 确保工作目录处于可用状态
function ensureWorkspaceValid(dir) {
	[
		path.resolve(dir, 'videos'),
		path.resolve(dir, 'audios'),
		path.resolve(dir, 'tmp'),
	].forEach(p => fs.existsSync(p) || fs.mkdirSync(p));
}

// 获取该目录下的B站视频缓存信息
function getVideoList(dir) {
    const list = [];
    for (let videoDir of fs.readdirSync(dir)) {
        const videoDirPath = path.resolve(dir, videoDir);
        for (let videoPartDir of fs.readdirSync(videoDirPath)) {
            const videoPartDirPath = path.resolve(videoDirPath, videoPartDir);
            const entryPath = path.resolve(videoPartDirPath, 'entry.json');
			try {
				const entryJson = fs.readFileSync(entryPath, 'utf-8');
				const entry = JSON.parse(entryJson);
				list.push({path: path.relative(dir, videoPartDirPath), entry: entry});
			} catch (e) { }
        }
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
		} catch(e) { }
    }
    return list;
}

const ORIGINAL_FILE_NAMES = ['0.blv', 'audio.m4s'];

// 实际提取行动
function act(config) {
	const wsp = config.workspacePath;
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
			}
		} catch (e) { console.log(e); }
	});
	// 使用ffmpeg进行转换
	srcFiles.forEach(({src, name}, index) => {
		try {
			const audioPath = path.format({
				dir: audiosPath,
				name: name,
				ext: '.mp3',
			});
			if (fs.existsSync(audioPath)) {
				console.log(`convert abanden(${index + 1}/${srcFiles.length}): already exists file `, audioPath);
				return;
			}
			const cmd = `ffmpeg -n -i "${escapePath(src)}" "${escapePath(audioPath)}"`;
			console.log('converting:', cmd);
			child_process.execSync(cmd, {encoding: 'utf-8'})
			console.log(`converted(${index + 1}/${srcFiles.length}): {name} `);
		} catch(e) {
			console.log(e);
		}
	})
	record = {
		workspacePath: wsp,
	};
	fs.writeFileSync(RECORD_PATH, JSON.stringify(record));
	console.log('done');
}

// 转义路径字符串
function escapePath(raw) {
	return raw.replace(/\\/g, '/').replace(/"/g, '\\"');
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
