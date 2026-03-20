Function.prototype.bind = Function.prototype.bind || function (target) {
  var self = this;
  var slice = Array.prototype.slice;
  var args = slice.call(arguments, 1);

  // Return a function with correct bind semantics, including partial
  // application and constructor behavior.
  var bound = function () {
    var boundArgs = args.concat(slice.call(arguments));

    // If used with `new`, ignore the target and bind `this` to the new instance.
    if (this instanceof bound) {
      var result = self.apply(this, boundArgs);
      // If the original function returns an object, return it per spec.
      return (result && (typeof result === "object" || typeof result === "function")) ? result : this;
    }

    return self.apply(target, boundArgs);
  };

  return bound;
};
