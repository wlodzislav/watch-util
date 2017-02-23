var fs = require("fs");
var globby = require("globby");
var underscore = require("underscore");
var child = require('child_process');
//var moment = require("moment");

function exec(cmd, options) {
	var childRunning = child.spawn('sh', ['-c', cmd], {});

	if (options.writeToConsole) {
		childRunning.stdout.on('data', function (data) {
			process.stdout.write(data);
		});

		childRunning.stderr.on('data', function (data) {
			process.stderr.write(data);
		});
	}

	return childRunning;
}

function Rule(ruleOptions, watcher) {
	if (!(this instanceof Rule)) { return new Rule(ruleOptions, watcher); }

	this._ruleOptions = ruleOptions || {};
	this._watcher = watcher;
}

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
		var paths = globby.sync(this._ruleOptions.globPatterns);
		paths.forEach(function (p) {
			if (!this._watchers[p]) {
				var execCallback = underscore.debounce(function (action) {
					if (this._ruleOptions.type === "exec") {
						if (this._ruleOptions.type === "exec" && typeof(this._ruleOptions.cmdOrFun) === "function") {
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
						console.log(moment().format("hh:mm:ss: ") + callback.name + "(\"" + p + "\");");
					}
					*/
				}.bind(this), this.getOption("debounce"));

				var rewatch = function () {
					if (this._watchers[p]) {
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
						try {
							stat = fs.statSync(p);
						} catch (err) {
							if (err.code == "ENOENT") {
								return execCallback("remove");
							}
						}
						if (action == "rename") {
							rewatch();
						}

						execCallback(action);
						mtime = stat.time;
					});
				}.bind(this);

				rewatch();

				if (!firstTime) {
					execCallback("create");
				}
			}
		}.bind(this));

		Object.keys(this._watchers).forEach(function (p) {
			if (paths.indexOf(p) == -1) {
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
	debounce: 200, // exec/reload once in ms at max
	reglob: 1000, // perform reglob to watch added files
	//queue: true, // exec calback if it's already executing
	restartOnError: true, // restart if exit code != 0
	restartOnSuccess: false, // restart if exit code == 0
	restartSignal: "SIGTERM",
	stopSignal: "SIGTERM",
	//cwd: "path for resolving",
	//persistLog: true, // save logs in files
	//logDir: "./logs",
	//logRotation: "5h", // s,m,h,d,M
	writeToConsole: true // write logs to console
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
