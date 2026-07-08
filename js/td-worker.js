// ===== T&D WEB WORKER =====
// Runs the torque & drag engine off the main thread. tdCompute() is a pure
// function (no DOM, no external-file dependencies), so the whole engine loads
// standalone here via importScripts. The client (td-worker-client.js) posts a
// plain {survey, bha, casingDesign, mudWeight, inputs} message and gets the
// result back — freeing the main thread during compute (e.g. slider drags).
//
// NOTE: Workers cannot be constructed from a file:// origin, so the client
// falls back to a synchronous main-thread tdCompute() when this Worker can't
// be created. This file is only reached when the app is served over http(s).

importScripts('td-engine.js');

self.onmessage = e => {
  const { id, survey, bha, casingDesign, mudWeight, inputs } = e.data || {};
  let result = null, error = null;
  try {
    result = tdCompute(survey, bha, casingDesign, mudWeight, inputs);
  } catch (err) {
    error = (err && err.message) ? err.message : String(err);
  }
  self.postMessage({ id, result, error });
};
