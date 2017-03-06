const WebTorrent = require('webtorrent');
const client = new WebTorrent();
const {dialog} = require('electron').remote;
require('events').EventEmitter.prototype._maxListeners = 1000;
const moment = require('moment');
const RSSParse = require('./lib/rssparse').RSSParse;
const ProgressBar = require('progressbar.js');
const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');
const _ = require('underscore');
const url = 'mongodb://localhost:27017/media_mate';
let i = 0;
let bar;
let dbindex = 0;
const magnetURI = [];
const prog = _.throttle(dlProgress, 10000);
window.onload = () => {
	getRSSURI(callback => {
		document.getElementById('rss').value = callback;
	});
	bar = new ProgressBar.Line('#Progress', {
		strokeWidth: 4,
		easing: 'easeInOut',
		duration: 1400,
		color: '#FFEA82',
		trailColor: '#eee',
		trailWidth: 1,
		svgStyle: {width: '100%', height: '100%'},
		text: {
			style: {
				// Text color.
				// Default: same as stroke color (options.color)
				color: '#999',
				position: 'absolute',
				right: '0',
//				top: '30px',
				padding: 0,
				margin: 0,
				transform: null
			},
			autoStyleContainer: false
		},
		from: {color: '#FFEA82'},
		to: {color: '#ED6A5A'},
		step: (state, bar) => {
			bar.setText(Math.round(bar.value() * 100) + ' %');
		}
	});
};
function dlProgress(torrent, magnet) {
	const animateThrottled = _.throttle(
		_.bind(bar.animate, bar),
		500
	);
	const percent = Math.round(torrent.progress * 100 * 100) / 100;
	document.getElementsByName(magnet)[0].parentNode.firstChild.nodeValue = percent.toString() + '% downloaded, ' + moment.duration(torrent.timeRemaining / 1000, 'seconds').humanize() + ' remaining.';
	animateThrottled(client.progress);
}
client.on('error', err => {
	console.error('ERROR: ' + err.message);
});
function getRSSURI(callback) {
	MongoClient.connect(url, (err, db) => {
		const collection = db.collection('uri');
		if (collection.find() !== undefined || collection.find() !== null) {
			collection.find().toArray((err, docs) => {
				if (docs.length > 0) {
					callback(docs[0].showRSSURI);
					db.close();
				}	else {
					callback('');
					db.close();
				}
			});
		} else {
			callback('');
		}
	});
}
function ignoreDupeTorrents(torrent, db, callback) {
	const collection = db.collection('torrents');
	if (collection.find() !== null) {
		collection.findOne({magnet: torrent.link}, (err, docs) => {
			if (docs === null) {
				collection.insertOne({magnet: torrent.link, title: torrent.title, downloaded: false}, (err, res) => {
					if (err) {
						throw err;
					}
					callback();
					db.close();
				});
			} else if (docs.downloaded === true) {
				callback('dupe');
				db.close();
			} else if (docs.downloaded === false) {
				callback();
				db.close();
			}
		});
	} else {
		collection.insertOne({magnet: torrent.link, title: torrent.title, downloaded: false}, (err, res) => {
			callback();
			db.close();
		});
	}
}
function getTorIndex(magnet, callback) {
	MongoClient.connect(url)
		.then((err, db) => {
			assert.equal(err, null);
			const collection = db.collection('torrents');
			collection.findOne({magnet})
				.then((err, docs) => {
					assert.equal(err, null);
					if (docs !== null) {
						const index = docs.index;
						callback(index);
						db.close();
					}
				});
		});
}
function dropTorrents(callback) {
	MongoClient.connect(url, (err, db) => {
		const collection = db.collection('torrents');
		collection.drop()
			.then(() => {
				db.close();
			});
	});
}
function updateURI(uri, db, callback) {
	// Get the documents collection
	const collection = db.collection('uri');
	// Update document where a is 2, set b equal to 1
	collection.drop();
	collection.insertOne({showRSSURI: uri}, (err, res) => {
		assert.equal(err, null);
		console.log('Updated the showRSS uri');
		callback(res);
		db.close();
	});
}
function findDocuments(db, col, callback) {
	// Get the documents collection
	const collection = db.collection(col || 'uri');
	// Find some documents
	collection.find({}).toArray((err, docs) => {
		assert.equal(err, null);
		console.log('Current contents of ' + col);
		console.log(docs);
		callback(docs);
		db.close();
	});
}
// Use connect method to connect to the Server
MongoClient.connect(url, (err, db) => {
	assert.equal(null, err);
	console.log('Connected correctly to server');
	findDocuments(db, 'torrents', () => {
		db.close();
	});
});
function dlAll() {
	MongoClient.connect(url, (err, db) => {
		assert.equal(err, null);
		const collection = db.collection('torrents');
		collection.find({downloaded: {$ne: true}}).toArray((err, docs) => {
			assert.equal(err, null);
			_.each(docs, (elem, index, list) => {
				addTor(elem.magnet, index, document.getElementById(index));
			});
			db.close();
		});
	});
}

function getDlPath(callback) {
	MongoClient.connect(url, (err, db) => {
		const collection = db.collection('path');
		if (collection.find() !== undefined || collection.find() !== null) {
			collection.find().toArray((err, docs) => {
				if (docs.length > 0) {
					callback(docs[0].path);
					db.close();
				}				else {
					callback('');
					db.close();
				}
			});
		} else {
			callback('');
		}
	});
}

function insertDlPath(callback) {
	const tb = document.getElementById('dlpath');
	const dlpath = dialog.showOpenDialog({properties: ['openDirectory']});
	MongoClient.connect(url, (err, db) => {
		const collection = db.collection('path');
		collection.drop();
		collection.insertOne({path: dlpath[0]})
			.then(() => {
			});
	});
}

function addTor(magnet, index) {
	document.getElementById('Progress').style.display = '';
	let dlpath;
	getDlPath(callback => {
		dlpath = callback;
	});

	client.add(magnet, {path: dlpath}, torrent => {
		torrent.index = index;
		document.getElementsByName(magnet)[0].checked = true;
		document.getElementsByName(magnet)[0].disabled = true;
		torrent.on('download', bytes => {
			prog(torrent, magnet);

		});
		torrent.on('done', () => {
			MongoClient.connect(url, (err, db) => {
				const collection = db.collection('torrents');
				collection.updateOne({magnet: document.getElementsByName(magnet)[0].name}, {$set: {downloaded: true}}, (err, res) => {
					assert.equal(err, null);
					document.getElementsByName(magnet)[0].parentNode.style.display = 'none';
					db.close();
				});
			});
			console.log('done');
			torrent.destroy();
		});
	});
}
function addIndexToDB(magnet, callback) {
	MongoClient.connect(url, (err, db) => {
		assert.equal(err, null);
		const collection = db.collection('torrents');
		collection.updateOne({magnet}, {$set: {index: dbindex}})
			.then(() => {
				dbindex++;
				callback();
				db.close();
			});
	});
}
function runScript(e) {
	if (e.keyCode == 13) {
		const tb = document.getElementById('rss');
		// Use connect method to connect to the Server
		MongoClient.connect(url, (err, db) => {
			assert.equal(null, err);
			console.log('Connected correctly to server');
			updateURI(tb.value, db, () => {
				db.close();
			});
		});
		const dl = document.getElementById('dlbox');
		document.getElementById('dls').style.display = 'inline';
		const RSS = new RSSParse(tb.value);
		RSS.on('data', data => {
			MongoClient.connect(url, (err, db) => {
				assert.equal(null, err);
				console.log('Connected correctly to server');
				document.getElementById('dlAll').style.display = 'block';
				data = _.omit(data, '_id');
				ignoreDupeTorrents(data, db, dupe => {
					if (!dupe) {
						const br = document.createElement('br');
						const label = document.createElement('label');
						const input = document.createElement('input');
						const inputName = document.createTextNode(data.title);
						label.appendChild(inputName);
						label.id = i;
						input.type = 'checkbox';
						input.className = 'checkbox';
						input.name = data.link;
						input.addEventListener('click', () => {
							addTor(input.name, input.id);
						});
						magnetURI.push(data.link);
						label.appendChild(input);
						dlbox.appendChild(document.createElement('br'));
						document.getElementById('dlbox').appendChild(label);
						addIndexToDB(input.name, () => {
						});
						i++;
						db.close();
					} else {
						console.log('dupe');
						db.close();
					}
				});
			});
		});
		return false;
	}
}
