/* 资产装载：由 build.mjs 注入 BM_ART_SRC（key -> dataURL 或 dataURL[]），本文件负责解码与查询。 */
(function () {
  'use strict';
  var BM = window.BM = window.BM || {};
  var SRC = window.BM_ART_SRC || {};
  var keys = Object.keys(SRC);
  var imgs = {};
  var loaded = 0;

  function makeImg(url) {
    var im = new Image();
    im.decoding = 'sync';
    im.onload = function () { loaded++; };
    im.onerror = function () { im.__failed = true; };
    im.src = url;
    return im;
  }

  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = SRC[k];
    imgs[k] = Array.isArray(v) ? v.map(makeImg) : makeImg(v);
  }

  function list(key) {
    var v = imgs[key];
    if (!v) return [];
    if (!Array.isArray(v)) return v.complete && v.naturalWidth > 0 ? [v] : [];
    var out = [];
    for (var j = 0; j < v.length; j++) if (v[j].complete && v[j].naturalWidth > 0) out.push(v[j]);
    return out;
  }

  BM.ART = {
    keys: keys,
    total: keys.length,
    has: function (key) { return !!imgs[key]; },
    // 单张（多张时按 index 取模），不可用时返回 null，调用方回退程序化绘制
    one: function (key, index) {
      var v = imgs[key];
      if (!v) return null;
      if (!Array.isArray(v)) return (v.complete && v.naturalWidth > 0) ? v : null;
      var ok = [];
      for (var j = 0; j < v.length; j++) if (v[j].complete && v[j].naturalWidth > 0) ok.push(v[j]);
      if (!ok.length) return null;
      return ok[((index || 0) % ok.length + ok.length) % ok.length];
    },
    all: list,
    // 由 main 每帧读取，用于判断贴图是否已就绪
    progress: function () { return keys.length ? loaded / keys.length : 1; }
  };
})();
