var fs = require("fs");
var globby = require("globby");
var underscore = require("underscore");
var child = require('child_process');
var moment = require("moment");
var clc = require('cli-color');

debugLog = function () {
	console.log(moment().format("hh:mm:ss: ") + [].slice.call(arguments).join(" "));
}

function exec(cmd, options) {
	if (options.writeToConsole) {
		var childRunning = child.spawn(cmd, { shell: true, stdio: "inherit" });
	} else {
		var childRunning = child.spawn(cmd, { shell: true });
	}

	return childRunning;
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
			} else {
				additional.push(p+"/**/*");
			}
		}
	});
	return patterns.concat(additional);
}

function Rule(ruleOptions, watcher) {
	if (!(this instanceof Rule)) { return new Rule(ruleOptions, watcher); }

	this._ruleOptions = ruleOptions || {};
	this._watcher = watcher;
}

var gid = 0;
Rule.prototype.start = function () {
	this._watchers = {};

	this._childRunning = null;

	var restart = function () {
		this._childRunning = exec(this._ruleOptions.cmdOrFun, { writeToConsole: this.getOption("writeToConsole") });
		this._childRunning.on("exit", function (code) {
			if (code !== null) { // not killed
				if (this.getOption("restartOnSuccess") && code === 0) {
					restart();
				}
				if (this.getOption("restartOnError") && code !== 0) {
					restart();
				}
			}
		}.bind(this));
	}.bind(this);

	var firstTime = true;
	var reglob = function () {
		var paths = globby.sync(preprocessGlobPatters(this._ruleOptions.globPatterns));
		paths.forEach(function (p) {
			if (!this._watchers[p]) {
				var execCallback = underscore.debounce(function (action) {
					if (this._ruleOptions.type === "exec") {
						if (typeof(this._ruleOptions.cmdOrFun) === "function") {
							this._ruleOptions.cmdOrFun(p, action);
						} else {
							this._childRunning = exec(this._ruleOptions.cmdOrFun, { writeToConsole: this.getOption("writeToConsole") });
							this._childRunning.on("exit", function () {
								this._childRunning = null;
							}.bind(this));
						}
					} else if (this._ruleOptions.type === "restart") {
						if (this._childRunning) {
							this._childRunning.on("close", restart);
							this._childRunning.kill(this.getOption("restartSignal"));
						} else {
							restart();
						}
					}
					/*
					if (callback.name) {
					}
					*/
				}.bind(this), this.getOption("debounce"));

				var rewatch = function () {
					if (this._watchers[p]) {
						if (this.getOption("debug")) {
							debugLog(clc.red("Deleted")+" watcher: path="+clc.yellow(p)+" id="+this._watchers[p].id);
						}
						this._watchers[p].close();
					} else {
					}
					try {
						var stat = fs.statSync(p);
						var mtime = stat.mtime;
					} catch (err) {
						return setTimeout(reglob, 0);
					}
					this._watchers[p] = fs.watch(p, function (action) {
						if (this.getOption("debug")) {
							debugLog(clc.green("Fire")+" watcher: path="+clc.yellow(p)+" id="+this._watchers[p].id+" action="+action);
						}
						try {
							stat = fs.statSync(p);
						} catch (err) {
							if (err.code == "ENOENT") {
								return execCallback("remove");
							}
						}
						if (action == "rename") {
							setTimeout(rewatch, 0);
						}

						if (this.getOption("mtimeCheck")) {
							if (stat.mtime > mtime) {
								execCallback();
								mtime = stat.time;
							}
						} else {
							execCallback(action);
						}
					}.bind(this));
					if (this.getOption("debug")) {
						this._watchers[p].id = (++gid);
						debugLog(clc.green("Created")+" watcher: path="+clc.yellow(p)+" id="+this._watchers[p].id);
					}
				}.bind(this);

				rewatch();

				if (!firstTime) {
					execCallback("create");
				}
			}
		}.bind(this));

		Object.keys(this._watchers).forEach(function (p) {
			if (paths.indexOf(p) == -1) {
				if (this.getOption("debug")) {
					debugLog(clc.red("Deleted")+" watcher: path="+clc.yellow(p)+" id="+this._watchers[p].id);
				}
				this._watchers[p].close();
				delete this._watchers[p];
			}
		}.bind(this));

		if (firstTime && this._ruleOptions.type === "restart") {
			restart();
		}
		firstTime = false;
	}.bind(this);

	reglob();

	this._reglobInterval = setInterval(reglob, this.getOption("reglob"));
	return this;
};

Rule.prototype.getOption = function (name) {
	return [this._ruleOptions[name], this._watcher._globalOptions[name], this._watcher._defaultOptions[name]].find(function (value) {
		return value != null;
	});
};

Rule.prototype.stop = function () {
	if (this._childRunning) {
		this._childRunning.kill(this.getOption("stopSignal"));
		this._childRunning = null;
	}
	clearInterval(this._reglobInterval);
	this._reglobInterval = null;
	Object.keys(this._watchers).forEach(function (p) {
		this._watchers[p].close();
		delete this._watchers[p];
	}.bind(this));
};

function Watcher(globalOptions) {
	if (!(this instanceof Watcher)) { return new Watcher(globalOptions); }

	this._globalOptions = globalOptions || {};
	this._rules = [];
}

Watcher.prototype._defaultOptions = {
	debounce: 500, // exec/reload once in ms at max
	reglob: 2000, // perform reglob to watch added files
	//queue: true, // exec calback if it's already executing
	restartOnError: true, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	restartSignal: "SIGTERM",
	stopSignal: "SIGTERM",
	//cwd: "path for resolving",
	//persistLog: true, // save logs in files
	//logDir: "./logs",
	//logRotation: "5h", // s,m,h,d,M
	writeToConsole: true, // write logs to console
	mtimeCheck: true,
	debug: false
};

Watcher.prototype.addExecRule = function (globPatterns, ruleOptions, cmdOrFun) {
	if (arguments.length === 2) {
		cmdOrFun = ruleOptions;
		ruleOptions = {};
	}

	ruleOptions.globPatterns = globPatterns;
	ruleOptions.type = "exec";
	ruleOptions.cmdOrFun = cmdOrFun;

	this._rules.push(new Rule(ruleOptions, this));
};

Watcher.prototype.addRestartRule = function (globPatterns, ruleOptions, cmd) {
	if (arguments.length === 2) {
		cmd = ruleOptions;
		ruleOptions = {};
	}

	ruleOptions.globPatterns = globPatterns;
	ruleOptions.type = "restart";
	ruleOptions.cmdOrFun = cmd;

	this._rules.push(new Rule(ruleOptions, this));
};

Watcher.prototype.startAll = function () {
	this._rules.forEach(function (rule) {
		rule.start();
	});
};

Watcher.prototype.stopAll = function () {
	this._rules.forEach(function (rule) {
		rule.stop();
	});
};

module.exports = Watcher;
