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

function PM(globalOptions) {
	if (!(this instanceof PM)) { return new PM(globalOptions); }

	this._globalOptions = globalOptions || {};
	this._rules = [];

	this._rules.toJSON = rulesToJSON;
	this._ruleId = 0;
	this._watcherId = 0;
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

	if (callback) { return callback(null); }
};

PM.prototype.rules = function (callback) {
	if (callback) {
		var serializedRules = this._rules.map(function (rule) { return rule.toJSON(); });
		callback(null, serializedRules);
	} else {
		return this._rules;
	}
};

PM.prototype.getRuleById = function (id) {
	return this._rules.find(function (rule) {
		return rule.id === id;
	});
};

PM.prototype.startById = function (id, callback) {
	var rule = this.getRuleById(id);
	console.log(id);
	rule.start();
	if (callback) { return callback(null); }
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

PM.prototype.deleteById = function (id, callback) {
	var rule = this.getRuleById(id);
	rule.stop(function (err) {
		var index = this._rules.indexOf(rule);
		this._rules.splice(index, 1);

		if (callback) { return callback(null); }
	});
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

module.exports = PM;
