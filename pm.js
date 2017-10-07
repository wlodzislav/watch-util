var EventEmitter = require('events');

var chalk = require("chalk");
var async = require("async");

var utils = require("./utils");
var debugLog = utils.debugLog;
var genUID = utils.genUID;
var Watcher = require("./watcher");
var defaultOptions = require("./default-options");

function rulesToJSON() {
	return this.map(function (r) {
		return r.toJSON();
	});
}

function PM(options) {
	if (!(this instanceof PM)) { return new PM(options); }
	options = options || {};

	this._globalOptions = options.globalOptions || {};
	this._rules = [];
	this._rules.toJSON = rulesToJSON;

	if (options.rules) {
		options.rules.forEach(function (r) {
			this.createRule(r);
		}.bind(this));
	}

	this.ee = new EventEmitter();
	this.on = this.ee.on.bind(this.ee);
}

PM.prototype.getOption = function (name) {
	return [this._globalOptions[name], defaultOptions[name]].find(function (v) {
		return v != null;
	});
};

PM.prototype.createRule = function (ruleOptions, callback) {
	var rule = new Watcher(ruleOptions);
	if (this.getOption("debug")) {
		if (typeof(rule.options().cmdOrFun) === "function") {
			var ruleOptionsCopy = JSON.parse(JSON.stringify(rule.options()));
			ruleOptionsCopy.cmdOrFun = "<FUNCTION>";
		}
		debugLog(chalk.green(".addRule")+"("+JSON.stringify(ruleOptionsCopy || ruleOptions)+")");
	}

	rule._pm = this;
	this._rules.push(rule);
	rule.on("log", function (entry) {
		entry._id = rule.id;
		this.ee.emit("log", entry);
	}.bind(this));

	if (callback) { return callback(null); }
};

PM.prototype.overwriteRule = function (ruleOptions, callback) {
	var rule = this.getRuleById(ruleOptions.id);
	if (rule) {
		rule.update(ruleOptions, callback);
	} else {
		this.createRule(ruleOptions, callback);
	}
};

PM.prototype.patchRuleById = function (ruleId, ruleOptions, callback) {
	var rule = this.getRuleById(ruleId);
	rule.patch(ruleOptions, callback);
};

PM.prototype.rules = function (callback) {
	if (callback) {
		var serializedRules = this._rules.map(function (rule) { return rule.toJSON(); });
		callback(null, serializedRules);
	} else {
		return this._rules;
	}
};

PM.prototype.logs = function (callback) {
	var logs = {};
	this._rules.forEach(function (rule) {
		logs[rule.id] = rule.getLog();
	});
	if (callback) {
		callback(null, logs);
	} else {
		return logs;
	}
};

PM.prototype.toJSON = function () {
	return {
		rules: this._rules.map(function (rule) { return rule.toJSON(); })
	};
};

PM.prototype.getRuleById = function (id) {
	return this._rules.find(function (rule) {
		// generated ids are numbers, but parsed cmd args are strings
		return rule.id == id;
	});
};

PM.prototype.getLogById = function (id, callback) {
	var rule = this.getRuleById(id);
	var log = rule.getLog();
	callback(null, log);
};

PM.prototype.startById = function (id, callback) {
	var rule = this.getRuleById(id);
	rule.start(callback);
};

PM.prototype.restartById = function (id, callback) {
	var rule = this.getRuleById(id);
	rule.restart(function (err) {
		if (callback) { return callback(null); }
	});
};

PM.prototype.stopById = function (id, callback) {
	var rule = this.getRuleById(id);
	rule.stop(function (err) {
		if (callback) { return callback(null); }
	});
};

PM.prototype.pauseById = function (id, callback) {
	var rule = this.getRuleById(id);
	rule.pause(function (err) {
		if (callback) { return callback(null); }
	});
};

PM.prototype.deleteById = function (id, callback) {
	var rule = this.getRuleById(id);
	var index = this._rules.indexOf(rule);
	if (rule._runState === "running") {
		rule.stop(function (err) {
			this._rules.splice(index, 1);

			if (callback) { return callback(null); }
		}.bind(this));
	} else {
		this._rules.splice(index, 1);

		if (callback) { return callback(null); }
	}
};

PM.prototype.startAll = function (callback) {
	this._rules.forEach(function (rule) {
		rule.start();
	});

	if (callback) { return callback(null); }
};

PM.prototype.stopAll = function (callback) {
	async.forEach(this._rules, function (rule, callback) {
		rule.stop(callback)
	}, function (err) {
		if (callback) { return callback(null); }
	})
};

PM.prototype.restartAll = function (callback) {
	async.forEach(this._rules, function (rule, callback) {
		rule.restart(callback)
	}, function (err) {
		if (callback) { return callback(null); }
	})
};

PM.prototype.pauseAllRunning = function (callback) {
	async.forEach(this._rules, function (rule, callback) {
		if (rule.isRunning()) {
			rule.pause(callback);
		} else {
			callback(null);
		}
	}, function (err) {
		if (callback) { return callback(null); }
	});
};

PM.prototype.startAllPaused = function (callback) {
	async.forEach(this._rules, function (rule, callback) {
		if (rule.isPaused()) {
			rule.start(callback);
		} else {
			callback(null);
		}
	}, function (err) {
		if (callback) { return callback(null); }
	});
};

module.exports = PM;
