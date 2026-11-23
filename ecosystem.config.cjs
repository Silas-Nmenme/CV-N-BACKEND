module.exports = { apps: [{ name: "cv-gadgets", script: "server/index.js", instances: 1, env: { NODE_ENV: "production" }, max_memory_restart: "400M" }] };
