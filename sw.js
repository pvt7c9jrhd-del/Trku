/* Offline support: app shell + automatic map-tile cache */
var VER = "v2";
var SHELL = "shell-" + VER, TILES = "tiles-v1", MAXTILES = 14000, cancelled = {};
var SHELL_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"
];
var TILE_RE = /^https:\/\/([a-d]\.basemaps\.cartocdn\.com\/|tile\.openstreetmap\.org\/|[a-c]\.tile\.opentopomap\.org\/|[a-c]\.tile-cyclosm\.openstreetmap\.fr\/|server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/)/;
var BLANK = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e3d8"/></svg>';

function tileKey(url){
  return url.replace(/^https:\/\/[a-d]\.(basemaps\.cartocdn\.com|tile\.opentopomap\.org|tile-cyclosm\.openstreetmap\.fr)/, "https://a.$1");
}
self.addEventListener("install", function(e){
  e.waitUntil(caches.open(SHELL).then(function(c){
    return Promise.all(SHELL_URLS.map(function(u){ return c.add(u).catch(function(){}); }));
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k!==SHELL && k!==TILES; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
function trim(cache){
  cache.keys().then(function(ks){
    if(ks.length > MAXTILES) ks.slice(0, ks.length - MAXTILES).forEach(function(k){ cache.delete(k); });
  });
}
function fetchTile(url){
  return fetch(url, {mode:"cors"}).catch(function(){ return fetch(url); });
}
self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = req.url;
  if(TILE_RE.test(url)){
    e.respondWith(caches.open(TILES).then(function(cache){
      var key = tileKey(url);
      return cache.match(key).then(function(hit){
        if(hit) return hit;
        return fetchTile(url).then(function(res){
          if(res && (res.ok || res.type==="opaque")){ cache.put(key, res.clone()); if(Math.random()<0.02) trim(cache); }
          return res;
        }).catch(function(){
          return new Response(BLANK, {headers:{"Content-Type":"image/svg+xml"}});
        });
      });
    }));
    return;
  }
  var u = new URL(url);
  if(u.origin === self.location.origin || SHELL_URLS.indexOf(url) >= 0){
    e.respondWith(fetch(req).then(function(res){
      if(res && res.ok){ var cp = res.clone(); caches.open(SHELL).then(function(c){ c.put(req, cp); }); }
      return res;
    }).catch(function(){
      return caches.match(req, {ignoreSearch:true}).then(function(h){ return h || caches.match("./", {ignoreSearch:true}); });
    }));
  }
});
self.addEventListener("message", function(e){
  var d = e.data || {};
  if(d.type === "cancel"){ cancelled[d.job || ""] = true; return; }
  if(d.type !== "precache" || !d.urls) return;
  var job = d.job || "";
  cancelled[job] = false;
  var urls = d.urls.slice(), done = 0, total = urls.length;
  caches.open(TILES).then(function(cache){
    function worker(){
      var u = urls.pop();
      if(!u || cancelled[job]) return Promise.resolve();
      var key = tileKey(u);
      return cache.match(key).then(function(h){
        if(h) return;
        return fetchTile(u).then(function(res){ if(res && (res.ok || res.type==="opaque")) return cache.put(key, res); }).catch(function(){});
      }).then(function(){
        done++;
        if(done % 50 === 0 || done === total) self.clients.matchAll().then(function(cs){ cs.forEach(function(c){ c.postMessage({type:"precache-progress", job:job, done:done, total:total}); }); });
        return worker();
      });
    }
    return Promise.all([worker(),worker(),worker(),worker(),worker(),worker()]);
  });
});
