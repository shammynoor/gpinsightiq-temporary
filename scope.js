// Executed before any legacy script reads a browser preference.
const iqBridge=window.parent!==window?window.parent.DarwinAnalytics:null;
const iqStorageScope=iqBridge?'darwin-mvp:'+encodeURIComponent(iqBridge.practice.id)+':'+encodeURIComponent(iqBridge.user.id)+':':'darwin-mvp:locked:';
function iqScopedStorage(storage){return {getItem:key=>storage.getItem(iqStorageScope+key),setItem:(key,value)=>storage.setItem(iqStorageScope+key,value),removeItem:key=>storage.removeItem(iqStorageScope+key)};}
const iqLocalStorage=iqScopedStorage(window.localStorage);
const iqSessionStorage=iqScopedStorage(window.sessionStorage);
