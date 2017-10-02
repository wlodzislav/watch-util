var chalk = require("chalk");

var utils = require("./utils");
var debugLog = utils.debugLog;
var genUID = utils.genUID;
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

PM.prototype.addRule = function (/* globs, ruleOptions, cmdOrFun */) {
	var rule;
	if(ruleOptions instanceof Watcher){
		rule = arguments[0];
	}else{
		rule = Watcher.apply(null, arguments);
		if (this.getOption("debug")) {
			if (typeof(rule.options().cmdOrFun) === "function") {
				var ruleOptionsCopy = JSON.parse(JSON.stringify(rule.options()));
				ruleOptionsCopy.cmdOrFun = "<FUNCTION>";
			}
			debugLog(chalk.green(".addRule")+"("+JSON.stringify(ruleOptionsCopy || ruleOptions)+")");
		}
		rule.id = genUID();
	}

	rule._pm = this;
	this._rules.push(rule);
	return rule;
};

PM.prototype.rules = function () {
	return this._rules;
};

PM.prototype.getRuleById = function (id) {
	return this._rules.find(function (rule) {
		return rule.id === id;
	});
};

PM.prototype.startById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't start rule with id=" + id + ", there is no such rule" }
	}

	rule.start();
};

PM.prototype.restartById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't restart rule with id=" + id + ", there is no such rule" }
	}

	rule.restart();
};

PM.prototype.stopById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't stop rule with id=" + id + ", there is no such rule" }
	}

	rule.stop();
};

PM.prototype.deleteById = function (id) {
	var rule = this.getRuleById(id);
	if (!rule) {
		throw { code: "RULE_NOT_FOUND", id: id, message: "Can't delete rule with id=" + id + ", there is no such rule" }
	}

	rule.delete();
};

PM.prototype.startAll = function () {
	this._rules.forEach(function (rule) {
		rule.start();
	});
};

PM.prototype.stopAll = function () {
	this._rules.forEach(function (rule) {
		rule.stop();
	});
};

module.exports = PM;
