var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var EventEmitter = require("events");

var minimatch = require("minimatch");
var glob = require("glob");
var chalk = require("chalk");
var async = require("async");

var debug = require("./debug");
var RestartRunner = require("./restart-runner");
var QueueRunner = require("./queue-runner");
var AlivePassThrough = require("./alive-pass-through");

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
	var additional = [];
	patterns.forEach(function (p) {
		if (p.startsWith("!") && !p.endsWith("**/*")) {
			if (p.endsWith("/")) {
				additional.push(p+"**/*");
			}
		}
	});
	return patterns.concat(additional);
}

function uniqArrStr(arr) {
	var hash = {};
	arr.forEach(function (p) {
		hash[p] = true;
	});

	return Object.keys(hash);
}

function sequentialGlob(patterns) {
	patterns = preprocessGlobPatters(patterns);
	var result = [];
	patterns.forEach(function (p) {
		if (p.startsWith("!") && !p.startsWith("!(")) {
			var mm = new minimatch.Minimatch(p);
			result = result.filter(function (f) {
				return mm.match(f);
			});
		} else {
			var paths = glob.sync(p);
			[].push.apply(result, paths);
		}
	});

	return uniqArrStr(result);
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

/*
	new Watcher(globs, options, callback)
	new Watcher(globs, options, cmd)
*/

function Watcher(globs, options) {
	var callback, cmd;
	if (typeof(arguments[2]) == "function") {
		callback = arguments[2];
	} else {
		cmd = arguments[2];
	}

	this.options = Object.assign({}, this.defaults, options);
	this.options.globs = this.options.globs || globs;
	this.options.cmd = cmd;
	this.options.callback = callback;

	this.options.kill = Object.assign({}, this.defaults.kill, options.kill || {});

	if (this.options.restart) {
		this.options.combineEvents = true;
		if (!options.hasOwnProperty("restartOnError")) {
			this.options.restartOnError = true;
		}
		if (!options.hasOwnProperty("restartOnSuccess")) {
			this.options.restartOnSuccess = true;
		}
	}

	if (this.options.debug && options.kill && !options.kill.hasOwnProperty("debug")) {
		this.options.kill.debug = true;
	}

	if (this.options.stdio) {
		if (this.options.stdio[1] == "pipe") {
			this.stdout = new AlivePassThrough();
		}

		if (this.options.stdio[2] == "pipe") {
			this.stderr = new AlivePassThrough();
		}
	}

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
	this.once = this.ee.once.bind(this.ee);
	this.off = this.ee.off.bind(this.ee);

	this._runState = "stopped";
	this._matcher = globsMatcher(this.options.globs);
}

Watcher.prototype.defaults = {
	debounce: 50, // exec/reload only after no events for N ms
	throttle: 0, // exec/reload no more then once every N ms
	reglob: 1000, // perform reglob to watch added files
	restartOnError: false, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	restart: false, // run as persistent process
	events: ["create", "change", "delete"],
	combineEvents: true, // run single cmd for all changes or separate
	checkMD5: false,
	checkMtime: true, // check modified time before firing events, to handle 2 stage save in editors
	deleteCheckInterval: 25, // check if file reappeared
	deleteCheckTimeout: 100, // "debounce" for delete for 2 stage save, when file is renamed and replaced with new one
	parallelLimit: 4, // max parallel running cmds in combineEvents == true mode
	shell: true, // run in shell or pass custom shell
	stdio: [null, "ignore", "ignore"],
	kill: {
		signal: ["SIGTERM", "SIGTERM", "SIGKILL"]
	},
	debug: false, // debug logging
};


Watcher.prototype.start = function (callback) {
	if (this._runState === "running") {
		var err = new Error("Process already started");
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
	this._changed = {};
	this._md5s = {};
	this._mtimes = {};

	if (this.options.cmd) {
		if (this.options.restart) {
			this._restartRunner = new RestartRunner(this.options);
			this._restartRunner.options.cmd = this._interpolateCombinedCmd.bind(this);
			this.options.callback = function (filePaths) {
				this._restartRunner.restart(filePaths);
			}.bind(this);

			if (this.options.stdio) {
				if (this.options.stdio[1] == "pipe") {
					this._restartRunner.stdout.pipe(this.stdout);
				}

				if (this.options.stdio[2] == "pipe") {
					this._restartRunner.stderr.pipe(this.stderr);
				}
			}

			// HACK: substitute ee to passthrough events
			this._restartRunner.ee = this.ee;

			this._restartRunner.start();
		} else {
			this._queueRunner = new QueueRunner(this.options);
			if (this.options.combineEvents) {
				if (this.options.waitDone) {
					this._queueRunner.options.parallelLimit = 1;
				}
				this._queueRunner.options.cmd = this._interpolateCombinedCmd.bind(this);
				this._queueRunner.options.reducer = function (queue) {
					var last = queue.pop();
					var filePaths = last.filePaths.filter(function (f) {
						return !queue.find(function (e) { return e.filePaths.indexOf(f) != -1; });
					});
					if (filePaths.length) {
						queue.push({ filePaths });
					}
					return queue;
				};
				this.options.callback = function (filePaths) {
					this._queueRunner.push({ filePaths });
				}.bind(this);
			} else {
				this._queueRunner.options.cmd = this._interpolateSeparateCmd.bind(this);
				this._queueRunner.options.reducer = function (queue) {
					var last = queue.pop();
					;
					var found = queue.find(function (e) { return e.filePath == last.filePath; });
					if (found) {
						found.action = last.action;
					} else {
						queue.push(last);
					}
					return queue;
				};
				this._queueRunner.options.skip = function (entry, running) {
					if (this.options.waitDone) {
						var inProcessing = running.find(function (r) { return r.filePath == entry.filePath; });
						return inProcessing;
					} else {
						return false;
					}
				}.bind(this);
				this.options.callback = function (filePath, action) {
					this._queueRunner.push({ filePath, action });
				}.bind(this);
			}

			if (this.options.stdio) {
				if (this.options.stdio[1] == "pipe") {
					this._queueRunner.stdout.pipe(this.stdout);
				}

				if (this.options.stdio[2] == "pipe") {
					this._queueRunner.stderr.pipe(this.stderr);
				}
			}

			// HACK: substitute ee to passthrough events
			this._queueRunner.ee = this.ee;

			this._queueRunner.start();
		}
	}

	var last = 0;
	if (this.options.restart) {
		last = Date.now();
	}

	if (this.options.callback || this.options.combineEvents) {
		this._callbackCombinedDebounced = debounceThrottle(this._callbackCombined.bind(this), this.options.debounce, this.options.throttle, last);
	}


	this._reglob(callback);
	this._debouncers = {};

	this._reglobInterval = setInterval(this._reglob.bind(this), this.options.reglob);
};

Watcher.prototype._callbackCombined = function () {
	if (this._runState != "running") {
		return;
	}

	if (this.options.debug) {
		debug(chalk.green("Call") + " callback for " + chalk.yellow(Object.keys(this._changed).join(", ")));
	}

	var filePaths = Object.keys(this._changed);
	if (this.options.callback) {
		this.options.callback(filePaths);
	}
	this.ee.emit("change", filePaths);
	this.ee.emit("all", filePaths);
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
	if (this.options.callback) {
		this.options.callback(filePath, action);
	}
	this.ee.emit(action, filePath);
	this.ee.emit("all", filePath, action);
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
			this._watchers[p].close();

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
	this._watchers[d] = fs.watch(d, function (action, fileName) {
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

	var paths = sequentialGlob(this.options.globs);
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
		if (this._watchers[d]) {
			return;
		}

		this._watchDir(d);
	}.bind(this));

	this._firstTime = false;

	if (callback) {
		callback();
	}
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

	if (this._restartRunner) {
		this._restartRunner.stop(_callback);
	} else if (this._queueRunner) {
		this._queueRunner.stop(_callback);
	} else {
		setImmediate(_callback);
	}
};

Watcher.prototype._interpolateCombinedCmd = function (options) {
	options = options || [];
	var filePaths = options.filePaths || [];
	var cmd;
	if (this.options.cmd.indexOf("%") !== -1) {
		var cwd = path.resolve(".")
		var relFiles = filePaths.join(" ");
		var files = filePaths.map(function (f) { return path.resolve(f); }).join(" ");
		cmd = this.options.cmd
			.replace("%cwd", cwd)
			.replace("%relFiles", relFiles || "")
			.replace("%files", files || "");
	} else {
		cmd = this.options.cmd;
	}

	return cmd;
}

Watcher.prototype._interpolateSeparateCmd = function (options) {
	var filePath = options.filePath;
	var action = options.action;
	var cmd;
	if (this.options.cmd.indexOf("%") !== -1) {
		var cwd = path.resolve(".")
		var relFile = filePath;
		var file = path.resolve(filePath);
		var relDir = path.dirname(filePath);
		var dir = path.resolve(path.dirname(filePath));
		cmd = this.options.cmd
			.replace("%cwd", cwd)
			.replace("%event", action || "")
			.replace("%relFile", relFile || "")
			.replace("%file", file || "")
			.replace("%relDir", relDir || "")
			.replace("%dir", dir || "");
	} else {
		cmd = this.options.cmd;
	}

	return cmd;
};

module.exports = Watcher;
