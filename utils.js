function pad2(n) {
	return n < 10 ? "0" + n : n;
}

function timestamp() {
	var now = new Date();
	return pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());
}

function debugLog() {
	console.log(timestamp() + ": " + [].slice.call(arguments).join(" "));
}

function shallowCopyObj(obj) {
	var copy = {};
	for (var key in obj) {
		copy[key] = obj[key];
	}
	return copy;
}

function assign(/* sources... */) {
	var target = {};
	for (var i = 0; i < arguments.length; i++) {
		var source = arguments[i];
		for (var key in source) {
			target[key] = source[key];
		}
	}
	return target;
}

module.exports.debugLog = debugLog;
module.exports.shallowCopyObj = shallowCopyObj;
module.exports.assign = assign;
