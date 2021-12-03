var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var EventEmitter = require("events");

var async = require("async");
var minimatch = require("minimatch");
var glob = require("glob");
var chalk = require("chalk");

var debug = require("./debug");

function debounceThrottle(fun, debounceDuration, throttleDuration, last) {
	var timeout;
	last = last || 0;

	var debouncer = function() {
		var context = this;
		var args = arguments;

		clearTimeout(timeout);

		var left = Math.max(0, throttleDuration - (Date.now() - last));
		timeout = setTimeout(function () {
			last = Date.now();
			fun.apply(context, args);
		}, Math.max(debounceDuration, left));
	};

	debouncer.cancel = function () {
		clearTimeout(timeout);
	};

	return debouncer;
}

function preprocessGlobPatters(patterns) {
	if (!Array.isArray(patterns)) {
		patterns = patterns.split(",");
	}
	return patterns.map(function (p) {
		if (p.startsWith("!") && p.endsWith("/")) {
			return p + "**";
		} else {
			return p;
		}
	});
}

function uniqArrStr(arr) {
	var hash = {};
	arr.forEach(function (p) {
		hash[p] = true;
	});

	return Object.keys(hash);
}

function isNegate(pattern) {
	return pattern.startsWith("!") && !pattern.startsWith("!(");
}

function sequentialGlob(patterns, callback) {
	patterns = preprocessGlobPatters(patterns);
	var args = [];
	patterns.forEach(function (p, index) {
		if (!isNegate(p)) {
			var ignore = patterns
				.slice(index)
				.filter(isNegate)
				.map(function (p) { return p.substr(1); });
			args.push([p, { ignore: ignore }]);
		}
	});

	var result = [];
	async.each(args, function (args, callback) {
		glob(args[0], args[1], function (err, paths) {
			if (err) {
				return callback(err);
			}
			[].push.apply(result, paths);
			callback();
		});
	}, function (err) {
		if (err) {
			return callback(err);
		}
		var paths = uniqArrStr(result);
		callback(null, paths);
	});
}

function globsMatcher(patterns) {
	patterns = preprocessGlobPatters(patterns);
	var matchers = patterns.map(function (p) {
		return new minimatch.Minimatch(p);
	});
	return function (f) {
		return matchers.every(function (m) { return m.match(f); })
	};
}

function md5(filePath, callback) {
	var fd = fs.createReadStream(filePath);
	var hash = crypto.createHash("md5");
	hash.setEncoding("hex");

	fd.on("end", function() {
		hash.end();
		callback(null, hash.read());
	});

	fd.on("error", callback);

	fd.pipe(hash);
}

var watcherDefaults = {
	debounce: 50,
	throttle: 0,
	reglob: 1000,
	events: ["create", "change", "delete"],
	combineEvents: true,
	checkMD5: false,
	checkMtime: true,
	deleteCheckInterval: 25,
	deleteCheckTimeout: 100,
	callOnStart: false,
	debug: false
};

/*
	new Watcher(globs)
	new Watcher(globs, options)
	new Watcher(globs, callback)
	new Watcher(globs, options, callback)
*/
function Watcher(globs) {
	var options, callback;
	if (arguments.length == 1) {
		options = {};
		callback = function () {};
	} else if (arguments.length == 2) {
		if (typeof(arguments[1]) == "function") {
			callback = arguments[1];
		} else {
			options = arguments[1];
			callback = function () {};
		}
	} else {
		options = arguments[1];
		callback = arguments[2];
	}

	this.options = Object.assign({}, watcherDefaults, options);
	this.options.globs = globs;
	this.options.callback = callback;

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
	this.once = this.ee.once.bind(this.ee);
	this.off = this.ee.off.bind(this.ee);

	this._runState = "stopped";
	this._matcher = globsMatcher(this.options.globs);
}

Watcher.prototype.start = function (callback) {
	if (this._runState === "running") {
		var err = new Error("Watcher already started");
		if (callback) {
			return callback(err);
		} else {
			throw err;
		}
	}
	this._runState = "running";
	this._firstTime = true;

	this._debouncers = {};
	this._watchers = {};
	this._dirWatchers = {};
	this._changed = {};
	this._md5s = {};
	this._mtimes = {};

	var last = 0;
	if (this.options.callOnStart) {
		last = Date.now();
	}

	if (this.options.combineEvents) {
		this._callbackCombinedDebounced = debounceThrottle(this._callbackCombined.bind(this), this.options.debounce, this.options.throttle, last);
	}

	this._debouncers = {};

	this._reglobInterval = setInterval(this._reglob.bind(this), this.options.reglob);

	this._reglob(function () {
		this.ee.emit("start");
		if (callback) {
			callback();
		}
	}.bind(this));
};

Watcher.prototype._callbackCombined = function () {
	if (this._runState != "running") {
		return;
	}

	if (this.options.debug) {
		debug(chalk.green("Call") + " callback for " + chalk.yellow(Object.keys(this._changed).join(", ")));
	}

	var filePaths = Object.keys(this._changed);
	this.ee.emit("change", filePaths);
	this.ee.emit("all", filePaths);
	if (this.options.callback) {
		this.options.callback(filePaths);
	}
	this._changed = {};
}

Watcher.prototype._callbackSingle = function (filePath, action) {
	if (this._runState != "running") {
		return;
	}

	if (this.options.debug) {
		debug(chalk.green("Call") + " callback for path=" + chalk.yellow(filePath) + " action=" + action);
	}

	this._changed[filePath] = null;
	this.ee.emit(action, filePath);
	this.ee.emit("all", filePath, action);
	if (this.options.callback) {
		this.options.callback(filePath, action);
	}
}

Watcher.prototype._fireEvent = function (filePath, action) {
	if (this._runState != "running") {
		return;
	}

	if (this.options.debug) {
		debug(chalk.green("Fire") + " watcher: path=" + chalk.yellow(filePath) + " action=" + action);
	}

	var events = this.options.events;
	if (events.indexOf(action) == -1) {
		return;
	}
	this._changed[filePath] = { action: action, filePath: filePath };

	if (this.restart) {
		this._changed[filePath] = { action: action, filePath: filePath };
		this._callbackCombinedDebounced();
	} else {
		if (this.options.combineEvents) {
			this._callbackCombinedDebounced();
		} else {
			if (!this._debouncers[filePath]) {
				this._debouncers[filePath] = debounceThrottle(function (filePath, action) {
					this._callbackSingle(filePath, action);
				}.bind(this), this.options.debounce, this.options.throttle);
			}
			this._debouncers[filePath](filePath, action);
		}
	}
};

Watcher.prototype._checkDelete = function (p) {
	var interval = setInterval(function () {
		try {
			var stat = fs.statSync(p);
		} catch (err) {}

		if (stat) {
			clearInterval(interval);
			clearTimeout(timeout);
			this._rewatchFile(p);
			this._optionalMtimeCheck(p, function () {
				this._optionalMD5Check(p, function () {
					this._fireEvent(p, "change");
				}.bind(this));
			}.bind(this));
		}
	}.bind(this), this.options.deleteCheckInterval);

	var timeout = setTimeout(function () {
		clearInterval(interval);
		if (!this.options.combineEvents) {
			delete this._debouncers[p];
		}
		delete this._watchers[p];
		if (this.options.debug) {
			debug(chalk.red("Deleted") + " watcher: path=" + chalk.yellow(p));
		}
		this._fireEvent(p, "delete");
	}.bind(this), this.options.deleteCheckTimeout);
};

Watcher.prototype._optionalMD5 = function (fileName, callback) {
	if (!this.options.checkMD5) {
		return callback();
	}

	md5(fileName, function (err, hash) {
		if (err) {
			this.ee.emit("error", err);
			return callback();
		}
		this._md5s[fileName] = hash;

		if (this.options.debug) {
			debug(chalk.green("MD5") + " for path=" + chalk.yellow(fileName) + " md5=" + hash);
		}
		callback();
	}.bind(this));
};

Watcher.prototype._optionalMD5Check = function (fileName, callback) {
	if (!this.options.checkMD5) {
		return callback();
	}

	md5(fileName, function (err, hash) {
		if (err) {
			this.ee.emit("error", err);
			return callback();
		}

		if (this.options.debug) {
			debug(chalk.green("Compare MD5") + " for path=" + chalk.yellow(fileName) + " old=" + this._md5s[fileName] + " new=" + hash);
		}

		if (this._md5s[fileName] != hash) {
			this._md5s[fileName] = hash;
			callback();
		}
	}.bind(this));
};

Watcher.prototype._optionalMtime = function (fileName, callback) {
	if (!this.options.checkMtime) {
		return callback();
	}

	fs.stat(fileName, function (err, stat) {
		if (err && err.code != "ENOENT") {
			this.ee.emit("error", err);
			return callback();
		}

		if (!stat) {
			return callback();
		}

		var mtime = stat.mtimeMs;

		this._mtimes[fileName] = mtime;

		if (this.options.debug) {
			debug(chalk.green("Mtime") + " for path=" + chalk.yellow(fileName) + " mtime=" + mtime);
		}

		callback();
	}.bind(this));
};

Watcher.prototype._optionalMtimeCheck = function (fileName, callback) {
	if (!this.options.checkMtime) {
		return callback();
	}

	fs.stat(fileName, function (err, stat) {
		if (err && err.code != "ENOENT") {
			this.ee.emit("error", err);
			return callback();
		}

		if (!stat) {
			return callback();
		}

		var mtime = stat.mtimeMs;

		if (this.options.debug) {
			debug(chalk.green("Compare mtime") + " for path=" + chalk.yellow(fileName) + " old=" + this._mtimes[fileName] + " new=" + mtime);
		}

		if (this._mtimes[fileName] != mtime) {
			this._mtimes[fileName] = mtime;
			callback();
		}
	}.bind(this));
};

Watcher.prototype._rewatchFile = function (p) {
	this._watchers[p].close();
	delete this._watchers[p];
	if (this.options.debug) {
		debug(chalk.red("Deleted") + " watcher: path=" + chalk.yellow(p));
	}
	this._watchFile(p);
};

Watcher.prototype._watchFile = function (p) {
	this._watchers[p] = fs.watch(p, function (action) {
		if (this._runState !== "running") {
			return;
		}

		if (this.options.debug) {
			debug(chalk.yellow("Raw event") + " watcher: path=" + chalk.yellow(p) + " action=" + action);
		}


		if (action == "rename") {
			if (this._watchers[p]) {
				this._watchers[p].close();
			}

			fs.stat(p, function (err, stat) {
				if (err && err.code != "ENOENT") {
					this.ee.emit("error", err);
				}

				if (stat) {
					if (this.options.debug) {
						debug(chalk.red("Replaced") + " watcher: path=" + chalk.yellow(p));
					}

					this._rewatchFile(p);
					this._optionalMtimeCheck(p, function () {
						this._optionalMD5Check(p, function () {
							this._fireEvent(p, "change");
						}.bind(this));
					}.bind(this));
				} else {
					this._checkDelete(p);
				}
			}.bind(this));
		} else {
			this._optionalMtimeCheck(p, function () {
				this._optionalMD5Check(p, function () {
					this._fireEvent(p, "change");
				}.bind(this));
			}.bind(this));
		}
	}.bind(this));

	if (this.options.debug) {
		debug(chalk.green("Created") + " watcher: path=" + chalk.yellow(p));
	}
};

Watcher.prototype._watchDir = function (d) {
	this._dirWatchers[d] = fs.watch(d, function (action, fileName) {
		if (this._runState !== "running") {
			return;
		}

		var filePath = path.join(d, fileName);
		if (this._watchers[filePath]) {
			return;
		}

		if (this._matcher(filePath)) {
			try {
				var stat = fs.statSync(filePath);
			} catch (err) {
			}

			if (stat) {
				this._fireEvent(filePath, "create");
				this._optionalMtime(filePath, function () {
					this._optionalMD5(filePath, function () {
						this._watchFile(filePath);
					}.bind(this));
				}.bind(this));
			}
		}
	}.bind(this));

	if (this.options.debug) {
		debug(chalk.green("Created") + " watcher: path=" + chalk.yellow(d));
	}
};

Watcher.prototype._reglob = function (callback) {
	if (this._runState !== "running") {
		return;
	}

	if (this.options.debug) {
		debug(chalk.yellow("Reglob"));
	}

	sequentialGlob(this.options.globs, function (err, paths) {
		if (err) {
			this.ee.emit("error", err);
		}

		paths.forEach(function (p) {
			if (this._watchers[p]) {
				return;
			}

			this._optionalMtime(p, function () {
				this._optionalMD5(p, function () {
					this._watchFile(p);
				}.bind(this));
			}.bind(this));

			if (!this._firstTime) {
				this._fireEvent(p, "create");
			}
		}.bind(this));
		
		var dirs = paths.map(function (p) { return path.dirname(p); });
		dirs.forEach(function (d) {
			if (!this._dirWatchers[d]) {
				this._watchDir(d);
			}
		}.bind(this));

		Object.keys(this._dirWatchers).forEach(function (d) {
			if (dirs.indexOf(d) == -1) {
				this._dirWatchers[d].close();
				delete this._dirWatchers[d];
				if (this.options.debug) {
					debug(chalk.red("Deleted") + " watcher: path=" + chalk.yellow(d));
				}
			}
		}.bind(this));

		this._firstTime = false;

		if (callback) {
			callback();
		}
	}.bind(this));
};

Watcher.prototype.stop = function (callback) {
	var _callback = function () {
		if (this.options.debug) {
			debug(chalk.green("Stoped") + " watcher");
		}
		if (callback) {
			callback();
		}
	}.bind(this);
	if (this._runState == "stopped") {
		if (callback) {
			callback();
		}
		return;
	}
	this._runState = "stopped";

	clearInterval(this._reglobInterval);

	if (this._callbackCombinedDebounced) {
		this._callbackCombinedDebounced.cancel();
	}

	Object.values(this._debouncers).forEach(function (d) {
		d.cancel();
	});
	this._debouncers = {};

	Object.values(this._watchers).forEach(function (w) {
		w.close();
	}.bind(this));
	this._watchers = {};

	Object.values(this._dirWatchers).forEach(function (w) {
		w.close();
	}.bind(this));
	this._dirWatchers = {};

	setImmediate(_callback);
};

module.exports = Watcher;
