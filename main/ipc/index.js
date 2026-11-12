// Registry for main-process IPC channels.
//
// Every ipc module exports register(registry) and calls registry.handle/on.
// The registry gives one place to catch handler errors (an exception inside a
// handler otherwise disappears into Electron) and to reject two modules
// claiming the same channel.
const { ipcMain } = require('electron');

function createRegistry(ctx) {
  const handles = new Map();
  const listeners = new Map();

  return {
    // ipcMain.handle: renderer awaits a value. Receives (ctx, event, ...args).
    handle(channel, fn) {
      if (handles.has(channel)) throw new Error(`duplicate ipc handle: ${channel}`);
      if (listeners.has(channel)) throw new Error(`channel used as both handle and on: ${channel}`);
      handles.set(channel, fn);
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          return await fn(ctx, event, ...args);
        } catch (err) {
          console.error(`[ipc:${channel}]`, err);
          throw err;
        }
      });
    },

    // ipcMain.on: fire and forget. Receives (ctx, event, ...args).
    on(channel, fn) {
      if (listeners.has(channel)) throw new Error(`duplicate ipc on: ${channel}`);
      if (handles.has(channel)) throw new Error(`channel used as both handle and on: ${channel}`);
      listeners.set(channel, fn);
      ipcMain.on(channel, (event, ...args) => {
        try {
          fn(ctx, event, ...args);
        } catch (err) {
          console.error(`[ipc:${channel}]`, err);
        }
      });
    },

    channels() {
      return { handles: [...handles.keys()], listeners: [...listeners.keys()] };
    },
  };
}

module.exports = { createRegistry };
