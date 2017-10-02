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

function debounce(fun, duration) {
	var timeout;
	var context;
	var args;
	var last;

	var check = function() {
		var elapsed = Date.now() - last;

		if (elapsed < duration) {
			timeout = setTimeout(check, duration - elapsed);
		} else {
			timeout = null;
			fun.apply(context, args);
		}
	};

	return function() {
		context = this;
		args = arguments;
		last = Date.now();
		if (!timeout) {
			timeout = setTimeout(check, duration);
		}
	};
};

function genUID() {
	return Date.now() + Math.floor(Math.random() * 1000);
}

module.exports.debugLog = debugLog;
module.exports.shallowCopyObj = shallowCopyObj;
module.exports.assign = assign;
module.exports.debounce = debounce;
module.exports.genUID = genUID;
